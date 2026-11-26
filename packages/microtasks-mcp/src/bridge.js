// The pipe's one job: carry calls to the one paired tab and results back. It
// knows no tools (the tab sends them in `hello`) and stores no tasks.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { parse, isHello, isResult, welcome, refused, call as callMsg, ERR, REFUSED } from '../../protocol/protocol.js';

export const GRACE_MS = 15000;    // after a paired tab drops: calls wait this long for it to come back
export const CALL_MS = 60000;     // a paired tab that never answers
export const HELLO_MS = 5000;     // a socket that never says hello

/**
 * Events: 'paired' (hello), 'unpaired', 'tools' (tools changed).
 * `pairUrl` goes into every "no tab" error, so the AI tells the user what to open.
 */
export class Bridge extends EventEmitter {
  constructor({ pipe = 'microtasks-mcp', version = '0.0.0', pairUrl, tools = [], graceMs = GRACE_MS, callMs = CALL_MS, helloMs = HELLO_MS, log = () => {} } = {}) {
    super();
    Object.assign(this, { pipe, version, pairUrl, graceMs, callMs, helloMs, log });
    this.tools = tools; this.readOnly = false;
    this.tab = null; this.droppedAt = 0;   // 0: never paired, or gone past the grace
    this.session = randomUUID().slice(0, 8); this.seq = 0;
    this.pending = new Map();              // id -> { msg, resolve, timer }
    this.blocked = null;                   // a reason every call fails with (port taken)
  }

  noTab(extra = '') {
    return { ok: false, error: { code: ERR.no_tab, message: `Microtasks isn't connected${extra}. Ask the user to open ${this.pairUrl} in their browser (Chrome asks once to allow local network access), then try again.` } };
  }

  /** A new socket from the browser: it pairs on hello, unless another tab holds the pipe. */
  accept(conn) {
    let said = false;
    const t = setTimeout(() => { if (!said) conn.close(1008, 'no hello'); }, this.helloMs);
    t.unref?.();
    conn.on('message', text => {
      const p = parse(text);
      if (!p.ok) {
        if (p.version) { conn.send(JSON.stringify(refused(REFUSED.version))); conn.close(1002, 'version'); }
        return;
      }
      const m = p.msg;
      if (conn !== this.tab) {
        if (said || !isHello(m)) return;
        said = true; clearTimeout(t);
        if (this.tab && !m.takeover) { conn.send(JSON.stringify(refused(REFUSED.paired_elsewhere))); conn.close(1000, 'paired elsewhere'); return; }
        if (this.tab) { const old = this.tab; this.tab = null; old.send(JSON.stringify(refused(REFUSED.taken_over))); old.close(1000, 'taken over'); }
        this._pair(conn, m);
        return;
      }
      if (isHello(m)) { this._hello(m); return; }   // a re-sent hello: tools or read-only changed
      if (isResult(m)) this._result(m);
    });
    conn.on('close', () => { clearTimeout(t); if (conn === this.tab) this._drop(); });
  }

  _pair(conn, hello) {
    this.tab = conn; this.droppedAt = 0;
    conn.send(JSON.stringify(welcome(this.pipe, this.version)));
    this._hello(hello);
    this.log(`paired (${conn.origin})`);
    this.emit('paired');
    for (const [, p] of this.pending) { clearTimeout(p.timer); this._send(p); }   // in flight or queued: same id, the tab runs it once
  }
  _hello(m) {
    this.readOnly = !!m.readOnly;
    const was = JSON.stringify(this.tools), now = JSON.stringify(m.tools);
    this.tools = m.tools;
    if (was !== now) this.emit('tools');
  }
  _drop() {
    this.tab = null; this.droppedAt = Date.now();
    this.log('tab disconnected; waiting for it to come back');
    this.emit('unpaired');
    for (const [, p] of this.pending) this._wait(p);
  }
  _wait(p) {
    clearTimeout(p.timer);
    const left = Math.max(0, this.droppedAt + this.graceMs - Date.now());
    p.timer = setTimeout(() => this._finish(p.msg.id, this.noTab(' (the tab closed or lost its connection)')), left);
    p.timer.unref?.();
  }
  _send(p) {
    this.tab.send(JSON.stringify(p.msg));
    p.timer = setTimeout(() => this._finish(p.msg.id, { ok: false, error: { code: ERR.timeout, message: 'Microtasks did not answer in time; the tab may be busy or asleep. Try again.' } }), this.callMs);
    p.timer.unref?.();
  }
  _result(m) { this._finish(m.id, m.ok ? { ok: true, result: m.result } : { ok: false, error: m.error }); }
  _finish(id, out) {
    const p = this.pending.get(id); if (!p) return;
    clearTimeout(p.timer); this.pending.delete(id);
    p.resolve(out);
  }

  /** One tool call → { ok, result } | { ok:false, error }. Never throws. */
  call(tool, input) {
    if (this.blocked) return Promise.resolve({ ok: false, error: { code: ERR.no_tab, message: this.blocked } });
    if (!this.tab && (!this.droppedAt || Date.now() - this.droppedAt > this.graceMs)) return Promise.resolve(this.noTab());
    const msg = callMsg(`${this.session}:${++this.seq}`, tool, input || {});
    return new Promise(resolve => {
      const p = { msg, resolve, timer: null };
      this.pending.set(msg.id, p);
      if (this.tab) this._send(p); else this._wait(p);
    });
  }

  close() {
    for (const [id] of this.pending) this._finish(id, this.noTab(' (the pipe is shutting down)'));
    if (this.tab) this.tab.close(1001, 'pipe closing');
  }
}
