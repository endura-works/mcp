// A raw WebSocket client for tests: masks its frames as a browser does, so the
// server's decoding (and the 126/127 length forms) is exercised for real.
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';

export function maskedFrame(opcode, payload, fin = true) {
  const n = payload.length, mask = randomBytes(4);
  const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | n])
    : n < 65536 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 0x80 | 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = (fin ? 0x80 : 0) | opcode; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  const body = Buffer.from(payload);
  for (let i = 0; i < n; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([head, mask, body]);
}

/** Server frames (unmasked) out of a buffer. */
function serverFrames(buf) {
  const out = []; let off = 0;
  while (buf.length - off >= 2) {
    const op = buf[off] & 15; let len = buf[off + 1] & 127, p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    if (buf.length < p + len) break;
    out.push({ op, data: buf.subarray(p, p + len) }); off = p + len;
  }
  return { out, rest: buf.subarray(off) };
}

/** Connect; resolves { status } on refusal or a client { send, next, frames, close, closed }. */
export function connect(port, origin = 'https://microtasks.endura.works') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13', Origin: origin } });
    req.on('response', res => resolve({ status: res.statusCode }));
    req.on('error', reject);
    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0); const queue = [], waiters = [], frames = [];
      let closedResolve; const closed = new Promise(r => { closedResolve = r; });
      socket.on('data', d => {
        buf = Buffer.concat([buf, d]);
        const r = serverFrames(buf); buf = r.rest;
        for (const f of r.out) {
          frames.push(f);
          if (f.op === 1) { let m; try { m = JSON.parse(f.data.toString('utf8')); } catch { continue; } const w = waiters.shift(); if (w) w(m); else queue.push(m); }
          if (f.op === 9) socket.write(maskedFrame(10, f.data));
        }
      });
      socket.on('close', () => { closedResolve(); for (const w of waiters.splice(0)) w({ type: 'closed' }); });
      resolve({
        status: 101, socket, frames, closed,
        send: obj => socket.write(maskedFrame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))),
        raw: b => socket.write(b),
        next: (ms = 2000) => new Promise((res2, rej2) => {
          if (queue.length) return res2(queue.shift());
          const t = setTimeout(() => rej2(new Error('no message')), ms); t.unref();
          waiters.push(m => { clearTimeout(t); res2(m); });
        }),
        close: () => { socket.write(maskedFrame(8, Buffer.from([3, 232]))); socket.end(); },
        kill: () => socket.destroy(),
      });
    });
    req.end();
  });
}

export const TOOLS = [
  { name: 'get_board', description: 'Read the board.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'put_task', description: 'Create or edit a task.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
];
export const hello = (extra = {}) => ({ v: 1, type: 'hello', app: 'microtasks', tools: TOOLS, readOnly: false, ...extra });

/** A fake tab: answers calls, remembers results by id (as the real tab does), counts runs.
 *  `page` is shared across reconnects of the same page: { seen, runs }. */
export async function fakeTab(port, { takeover = false, origin, page = { seen: new Map(), runs: 0 } } = {}) {
  const c = await connect(port, origin);
  if (c.status !== 101) return c;
  c.send(hello(takeover ? { takeover: true } : {}));
  c.first = await c.next();
  c.page = page; c.calls = [];
  // mode: 'answer' | 'hold' (never answers) | 'drop' (runs it, dies before answering)
  c.serve = (mode = 'answer') => {
    (async () => {
      for (;;) {
        let m; try { m = await c.next(60000); } catch { return; }
        if (m.type === 'closed') return;
        if (m.type !== 'call') continue;
        c.calls.push(m);
        if (mode === 'hold') continue;
        let r = page.seen.get(m.id);
        if (!r) { page.runs++; r = { v: 1, type: 'result', id: m.id, ok: true, result: { text: `ran ${m.tool}`, data: { n: page.runs } } }; page.seen.set(m.id, r); }
        if (mode === 'drop') { c.kill(); return; }
        c.send(r);
      }
    })();
    return c;
  };
  return c;
}
