import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFrames, encodeFrame, listen, acceptKey } from '../src/ws.js';
import { allowOrigin } from '../src/config.js';
import { connect, maskedFrame } from './client.mjs';

test('accept key matches RFC 6455 §1.3 example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('masked frames decode at every length form (7-bit, 16-bit, 64-bit)', () => {
  for (const n of [0, 5, 125, 126, 1000, 65535, 65536, 200000]) {
    const payload = Buffer.alloc(n, 'x');
    const r = decodeFrames(maskedFrame(1, payload));
    assert.equal(r.frames.length, 1, `n=${n}`);
    assert.equal(r.frames[0].data.length, n);
    assert.equal(r.rest.length, 0);
  }
});

test('a partial frame waits for more bytes', () => {
  const f = maskedFrame(1, Buffer.from('hello world'));
  const r = decodeFrames(f.subarray(0, 7));
  assert.equal(r.frames.length, 0);
  assert.equal(r.rest.length, 7);
});

test('unmasked client frames and oversized payloads are refused', () => {
  assert.equal(decodeFrames(encodeFrame(1, Buffer.from('hi'))).error, 1002);
  assert.equal(decodeFrames(maskedFrame(1, Buffer.alloc(300)), 100).error, 1009);
});

test('origin allowlist: the live site and local dev only', () => {
  for (const o of ['https://microtasks.endura.works', 'http://127.0.0.1:8391', 'http://localhost:8392', 'http://localhost']) assert.ok(allowOrigin(o), o);
  for (const o of ['', 'null', 'https://evil.example', 'https://microtasks.endura.works.evil.example', 'http://microtasks.endura.works', 'https://endura.works', 'http://127.0.0.1.evil.example']) assert.ok(!allowOrigin(o), o);
});

test('server: wrong origin → 403; right origin → text echo, ping → pong, fragments join', async () => {
  const conns = [];
  const server = await listen({ port: 0, allowOrigin, onConn: c => { conns.push(c); c.on('message', t => c.send('echo:' + t)); }, pingMs: 0 });
  const port = server.address().port;
  try {
    assert.equal((await connect(port, 'https://evil.example')).status, 403);
    const c = await connect(port);
    assert.equal(c.status, 101);
    c.send({ a: 1 });
    await new Promise(r => setTimeout(r, 50));
    assert.equal(c.frames.at(-1).data.toString(), 'echo:{"a":1}');
    c.raw(maskedFrame(9, Buffer.from('p')));
    c.raw(Buffer.concat([maskedFrame(1, Buffer.from('{"b"'), false), maskedFrame(0, Buffer.from(':2}'))]));
    await new Promise(r => setTimeout(r, 50));
    assert.ok(c.frames.some(f => f.op === 10 && f.data.toString() === 'p'), 'pong');
    assert.equal(c.frames.at(-1).data.toString(), 'echo:{"b":2}');
    c.raw(maskedFrame(2, Buffer.from([1, 2])));   // binary: refused
    await c.closed;
    assert.ok(conns[0].closed);
  } finally { server.close(); }
});
