import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listen } from '../src/ws.js';
import { Bridge } from '../src/bridge.js';
import { allowOrigin } from '../src/config.js';
import { fakeTab, connect } from './client.mjs';

async function setup(opts = {}) {
  const bridge = new Bridge({ pairUrl: 'https://microtasks.endura.works/#mcp=1', version: '9.9.9', ...opts });
  const server = await listen({ port: 0, allowOrigin, onConn: c => bridge.accept(c), pingMs: 0 });
  return { bridge, server, port: server.address().port, done: () => { bridge.close(); server.close(); } };
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('no tab: a call fails at once with the pairing link', async () => {
  const s = await setup();
  try {
    const t0 = Date.now(), r = await s.bridge.call('get_board', {});
    assert.ok(Date.now() - t0 < 100);
    assert.equal(r.ok, false); assert.equal(r.error.code, 'no_tab');
    assert.match(r.error.message, /#mcp=1/);
  } finally { s.done(); }
});

test('pair: welcome, tools from hello, a call round trip', async () => {
  const s = await setup();
  let changed = 0; s.bridge.on('tools', () => changed++);
  try {
    const tab = (await fakeTab(s.port)).serve();
    assert.deepEqual(tab.first, { v: 1, type: 'welcome', pipe: 'microtasks-mcp', version: '9.9.9' });
    assert.equal(s.bridge.tools.length, 2); assert.equal(changed, 1);
    const r = await s.bridge.call('put_task', { text: 'x' });
    assert.deepEqual(r, { ok: true, result: { text: 'ran put_task', data: { n: 1 } } });
    assert.match(tab.calls[0].id, /^[0-9a-f]{8}:1$/);
  } finally { s.done(); }
});

test('a second tab is refused "paired elsewhere"; takeover moves the pipe', async () => {
  const s = await setup();
  try {
    const a = (await fakeTab(s.port)).serve();
    const b = await fakeTab(s.port);
    assert.deepEqual(b.first, { v: 1, type: 'refused', reason: 'paired_elsewhere' });
    await b.closed;
    const c = (await fakeTab(s.port, { takeover: true })).serve();
    assert.equal(c.first.type, 'welcome');
    await a.closed;
    assert.ok(a.frames.some(f => f.op === 1 && f.data.toString().includes('taken_over')));
    const r = await s.bridge.call('get_board', {});
    assert.equal(r.ok, true); assert.equal(c.calls.length, 1); assert.equal(a.calls.length, 0);
  } finally { s.done(); }
});

test('a dropped tab: the call is re-sent on reconnect with the same id and runs once', async () => {
  const s = await setup();
  try {
    const page = { seen: new Map(), runs: 0 };
    (await fakeTab(s.port, { page })).serve('drop');   // runs it, dies before answering
    const pending = s.bridge.call('put_task', { text: 'once' });
    await wait(100);
    assert.equal(s.bridge.tab, null);
    const again = (await fakeTab(s.port, { page })).serve();   // the same page reconnects
    const r = await pending;
    assert.equal(r.ok, true);
    assert.equal(page.runs, 1, 'ran exactly once');
    assert.equal(again.calls.length, 1);
  } finally { s.done(); }
});

test('a call during the grace period waits for the tab; after it, fails with the link', async () => {
  const s = await setup({ graceMs: 300 });
  try {
    const a = (await fakeTab(s.port)).serve();
    a.kill(); await wait(50);
    const early = s.bridge.call('get_board', {});
    const tab = (await fakeTab(s.port)).serve();
    assert.equal((await early).ok, true);
    tab.kill(); await wait(50);
    const late = s.bridge.call('get_board', {});   // nobody comes back
    const r = await late;
    assert.equal(r.ok, false); assert.equal(r.error.code, 'no_tab');
    await wait(350);
    const after = await s.bridge.call('get_board', {});
    assert.equal(after.error.code, 'no_tab');
  } finally { s.done(); }
});

test('a tab that never answers times out; one that never says hello is closed', async () => {
  const s = await setup({ callMs: 200, helloMs: 150 });
  try {
    (await fakeTab(s.port)).serve('hold');
    const r = await s.bridge.call('get_board', {});
    assert.equal(r.error.code, 'timeout');
    const mute = await connect(s.port);
    await mute.closed;
  } finally { s.done(); }
});

test('wrong protocol version is refused', async () => {
  const s = await setup();
  try {
    const c = await connect(s.port);
    c.send({ v: 2, type: 'hello', app: 'microtasks', tools: [] });
    assert.deepEqual(await c.next(), { v: 1, type: 'refused', reason: 'version' });
    await c.closed;
  } finally { s.done(); }
});
