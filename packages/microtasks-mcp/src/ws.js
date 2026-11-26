// A minimal WebSocket server (RFC 6455) on node:http — text frames, ping/pong,
// close, fragmentation, a payload cap. Enough for one browser tab on 127.0.0.1;
// no dependency to keep alive for years. Binary frames and extensions are refused.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const MAX_PAYLOAD = 16 * 1024 * 1024;

export const acceptKey = key => createHash('sha1').update(key + GUID).digest('base64');

/** One frame, server → client (never masked). */
export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | opcode; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, payload]);
}

/**
 * Frames out of a byte stream. Returns { frames, rest } or { error: closeCode }.
 * Client frames must be masked (§5.1).
 */
export function decodeFrames(buf, maxPayload = MAX_PAYLOAD) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off], b1 = buf[off + 1];
    if (b0 & 0x70) return { error: 1002 };                 // RSV bits: no extensions negotiated
    const fin = !!(b0 & 0x80), opcode = b0 & 0x0f, masked = !!(b1 & 0x80);
    if (!masked) return { error: 1002 };
    let len = b1 & 0x7f, p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) {
      if (buf.length < p + 8) break;
      const big = buf.readBigUInt64BE(p); p += 8;
      if (big > BigInt(maxPayload)) return { error: 1009 };
      len = Number(big);
    }
    if (len > maxPayload) return { error: 1009 };
    if (opcode >= 8 && (len > 125 || !fin)) return { error: 1002 };   // control frames: short, never fragmented
    if (buf.length < p + 4 + len) break;
    const mask = buf.subarray(p, p + 4); p += 4;
    const data = Buffer.from(buf.subarray(p, p + len));
    for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
    frames.push({ fin, opcode, data });
    off = p + len;
  }
  return { frames, rest: buf.subarray(off) };
}

/** A live connection: 'message' (text), 'close' (code). */
export class Conn extends EventEmitter {
  constructor(socket, { origin = '', maxPayload = MAX_PAYLOAD, pingMs = 20000 } = {}) {
    super();
    this.socket = socket; this.origin = origin; this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0); this.parts = null; this.closed = false; this.alive = true;
    socket.setNoDelay(true);
    socket.on('data', d => this._data(d));
    socket.on('end', () => this.terminate());   // http's sockets are half-open: a tab gone without a close frame ends here
    socket.on('close', () => this._gone(1006));
    socket.on('error', () => this._gone(1006));
    this.timer = pingMs > 0 ? setInterval(() => {
      if (!this.alive) { this.terminate(); return; }   // no pong since the last ping: a dead tab
      this.alive = false; this._raw(9);
    }, pingMs) : null;
    this.timer?.unref?.();
  }
  send(text) { if (!this.closed) this._raw(1, Buffer.from(text, 'utf8')); }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const r = Buffer.from(reason, 'utf8').subarray(0, 120), b = Buffer.alloc(2 + r.length);
    b.writeUInt16BE(code, 0); r.copy(b, 2);
    this._raw(8, b);
    this.socket.end();
    this._gone(code);
  }
  terminate() { this.socket.destroy(); this._gone(1006); }
  _raw(op, payload) { try { this.socket.write(encodeFrame(op, payload)); } catch { /* socket gone */ } }
  _gone(code) {
    if (this.closed) return;
    this.closed = true; clearInterval(this.timer);
    this.emit('close', code);
  }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    const r = decodeFrames(this.buf, this.maxPayload);
    if (r.error) { this.close(r.error); return; }
    this.buf = r.rest;
    for (const f of r.frames) {
      if (this.closed) return;
      if (f.opcode === 8) { this.close(1000); return; }
      if (f.opcode === 9) { this._raw(10, f.data); continue; }
      if (f.opcode === 10) { this.alive = true; continue; }
      if (f.opcode === 2 || (f.opcode === 0 && !this.parts) || (f.opcode === 1 && this.parts)) { this.close(f.opcode === 2 ? 1003 : 1002); return; }
      if (f.opcode === 1) this.parts = [];
      if (f.opcode === 1 || f.opcode === 0) {
        this.parts.push(f.data);
        const size = this.parts.reduce((n, p) => n + p.length, 0);
        if (size > this.maxPayload) { this.close(1009); return; }
        if (f.fin) { const text = Buffer.concat(this.parts).toString('utf8'); this.parts = null; this.alive = true; this.emit('message', text); }
        continue;
      }
      this.close(1002); return;
    }
  }
}

/**
 * Listen on host:port. `allowOrigin(origin)` decides every upgrade (403 otherwise).
 * Resolves with the http server; `onConn(conn)` gets each accepted connection.
 */
export function listen({ host = '127.0.0.1', port, allowOrigin, onConn, pingMs }) {
  const server = createServer((req, res) => {
    res.writeHead(426, { 'content-type': 'text/plain' });
    res.end('microtasks-mcp: a WebSocket endpoint for the Microtasks tab\n');
  });
  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin || '';
    const key = req.headers['sec-websocket-key'];
    const deny = (code, text) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };
    if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') return deny(400, 'Bad Request');
    if (!allowOrigin(origin)) return deny(403, 'Forbidden');
    socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${acceptKey(key)}`, '', ''].join('\r\n'));
    onConn(new Conn(socket, { origin, pingMs }));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
}
