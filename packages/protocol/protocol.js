// Endura pipe protocol v1 — the messages between a pipe (the local npm package,
// later the cloud relay) and the product's open browser tab. Product-neutral:
// Microtasks speaks it now, Trail later. The tab holds every tool; a pipe only
// carries these envelopes. Copied, not published: each package bundles this file
// and the app keeps the same definition (shared/tasks/75-agent.js, its header).
//
//   tab → pipe   {v:1, type:'hello', app, tools:[{name, description, inputSchema, annotations?}], readOnly, takeover?}
//   pipe → tab   {v:1, type:'welcome', pipe, version}
//            |   {v:1, type:'refused', reason:'paired_elsewhere'|'taken_over'|'version'}   then the pipe closes
//   pipe → tab   {v:1, type:'call', id, tool, input}
//   tab → pipe   {v:1, type:'result', id, ok:true, result:{text, data}}
//            |   {v:1, type:'result', id, ok:false, error:{code, message}}
//
// A call id is unique per pipe session (`<session>:<seq>`). The tab remembers its
// recent results by id, so a call re-sent after a reconnect never runs twice.
// No session, token or key is ever in a message.

export const V = 1;

export const ERR = Object.freeze({
  version: 'version',          // the other side speaks another protocol version
  bad_message: 'bad_message',  // not a v1 message
  unknown_tool: 'unknown_tool',
  invalid: 'invalid',          // the tool refused its input; the message says how to fix the call
  read_only: 'read_only',      // the user turned writes off for AI
  internal: 'internal',        // the tool failed inside the app
  no_tab: 'no_tab',            // pipe only: no tab paired
  timeout: 'timeout',          // pipe only: the tab never answered
});

export const REFUSED = Object.freeze({ paired_elsewhere: 'paired_elsewhere', taken_over: 'taken_over', version: 'version' });

const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);

/** Parse one frame's text into a v1 message, or say why not. */
export function parse(text) {
  let m;
  try { m = JSON.parse(text); } catch { return { ok: false, error: 'not JSON' }; }
  if (!isObj(m)) return { ok: false, error: 'not an object' };
  if (m.v !== V) return { ok: false, error: `protocol v${m.v}, expected v${V}`, version: true };
  if (typeof m.type !== 'string') return { ok: false, error: 'no type' };
  return { ok: true, msg: m };
}

export const isTool = t => isObj(t) && typeof t.name === 'string' && t.name && typeof t.description === 'string' && isObj(t.inputSchema);
export const isHello = m => isObj(m) && m.v === V && m.type === 'hello' && typeof m.app === 'string' && Array.isArray(m.tools) && m.tools.every(isTool);
export const isResult = m => isObj(m) && m.v === V && m.type === 'result' && (typeof m.id === 'string' || typeof m.id === 'number') && typeof m.ok === 'boolean'
  && (m.ok ? isObj(m.result) : isObj(m.error) && typeof m.error.message === 'string');

export const welcome = (pipe, version) => ({ v: V, type: 'welcome', pipe, version });
export const refused = reason => ({ v: V, type: 'refused', reason });
export const call = (id, tool, input) => ({ v: V, type: 'call', id, tool, input });
