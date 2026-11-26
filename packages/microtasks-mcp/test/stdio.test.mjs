// End to end through the built CLI: MCP JSON-RPC on stdio, a fake tab on the WebSocket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { fakeTab } from './client.mjs';

const CLI = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const freePort = () => new Promise(r => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

function start(port) {
  const p = spawn(process.execPath, [CLI, '--port', String(port)], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; const lines = [], waiters = [];
  p.stdout.on('data', d => {
    out += d;
    let i; while ((i = out.indexOf('\n')) >= 0) { const l = out.slice(0, i); out = out.slice(i + 1); const m = JSON.parse(l); lines.push(m); const w = waiters.shift(); if (w) w(m); }
  });
  p.stderr.on('data', d => { err += d; });
  let id = 0;
  const rpc = (method, params) => { const m = { jsonrpc: '2.0', id: ++id, method, params }; p.stdin.write(JSON.stringify(m) + '\n'); return next(x => x.id === m.id); };
  const next = (pred = () => true, ms = 3000) => new Promise((res, rej) => {
    const hit = lines.findIndex(pred); if (hit >= 0) return res(lines.splice(hit, 1)[0]);
    const t = setTimeout(() => rej(new Error('timeout; stderr: ' + err)), ms); t.unref();
    const check = m => { if (pred(m)) { clearTimeout(t); lines.splice(lines.indexOf(m), 1); res(m); } else waiters.push(check); };
    waiters.push(check);
  });
  let exited = false; p.on('exit', () => { exited = true; });
  const ready = new Promise(r => { const f = () => (err.includes('ws://127.0.0.1') || exited ? r() : setTimeout(f, 20).unref()); f(); });
  return { p, rpc, next, notify: method => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'), ready, stderr: () => err, stop: () => { p.stdin.end(); return new Promise(r => p.on('exit', r)); } };
}

test('--version and --help print and exit', () => {
  assert.match(execFileSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' }), /^\d+\.\d+\.\d+\n$/);
  assert.match(execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' }), /claude mcp add microtasks/);
});

test('initialize, tools/list from the snapshot, no-tab error, then a paired call', async () => {
  const port = await freePort(), s = start(port);
  try {
    await s.ready;
    assert.match(s.stderr(), new RegExp(`#mcp=${port}`));
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: true } });
    assert.equal(init.result.serverInfo.name, 'microtasks');
    const odd = await s.rpc('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(odd.result.protocolVersion, '2025-11-25');
    s.notify('notifications/initialized');
    const list = await s.rpc('tools/list', {});
    assert.ok(list.result.tools.some(t => t.name === 'put_task'), 'snapshot tools before pairing');
    const lonely = await s.rpc('tools/call', { name: 'get_board', arguments: {} });
    assert.equal(lonely.result.isError, true);
    assert.match(lonely.result.content[0].text, new RegExp(`#mcp=${port}`));
    const tab = (await fakeTab(port)).serve();
    await s.next(m => m.method === 'notifications/tools/list_changed');
    const list2 = await s.rpc('tools/list', {});
    assert.deepEqual(list2.result.tools.map(t => t.name), ['get_board', 'put_task']);
    assert.deepEqual(list2.result.tools[0].annotations, { readOnlyHint: true });
    const ok = await s.rpc('tools/call', { name: 'put_task', arguments: { text: 'hi' } });
    assert.deepEqual(ok.result, { content: [{ type: 'text', text: 'ran put_task' }], structuredContent: { n: 1 } });
    assert.equal(tab.calls[0].input.text, 'hi');
    const bad = await s.rpc('tools/call', { name: 'nope', arguments: {} });
    assert.equal(bad.error.code, -32602);
    const none = await s.rpc('resources/list', {});
    assert.equal(none.error.code, -32601);
    assert.deepEqual((await s.rpc('ping')).result, {});
  } finally { await s.stop(); }
});

test('a port already taken: tools/call explains instead of crashing', async () => {
  const port = await freePort(), a = start(port);
  await a.ready;
  const b = start(port);
  try {
    await new Promise(r => setTimeout(r, 300));
    assert.match(b.stderr(), /is taken/);
    const r = await b.rpc('tools/call', { name: 'get_board', arguments: {} });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /--port/);
  } finally { await b.stop(); await a.stop(); }
});
