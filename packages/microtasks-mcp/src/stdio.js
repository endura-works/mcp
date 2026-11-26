// MCP over stdio: newline-delimited JSON-RPC 2.0. stdout carries protocol only;
// every log line goes to stderr. Tools come from the bridge (the tab's hello).
export const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];   // newest first

const INSTRUCTIONS = 'Microtasks is a task board: tasks break down into microtasks and nanotasks (three levels), '
  + 'shown as boxes joined by arrows, in spaces (Essential and projects). Read with get_board before changing; '
  + 'create a whole breakdown in one put_task with children; titles are at most 20 words, so put detail in note. '
  + 'Deletes go to the Recycle bin (restore_task brings them back). Results carry ids for the next call.';

/** Map one tab result to an MCP CallToolResult. */
export function toolResult(out) {
  if (out.ok) {
    const r = out.result || {};
    return { content: [{ type: 'text', text: String(r.text ?? '') }], ...(r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? { structuredContent: r.data } : null) };
  }
  return { content: [{ type: 'text', text: out.error.message }], isError: true };
}

/**
 * Serve MCP on (input, output) streams. Returns { notifyToolsChanged, done }.
 * `bridge`: { tools, call(name, input) }.
 */
export function serve({ input, output, bridge, name, title, version, log = () => {} }) {
  let initialized = false, buf = '';
  const write = obj => output.write(JSON.stringify(obj) + '\n');
  const reply = (id, result) => write({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  const listTools = () => bridge.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : null) }));

  async function handle(m) {
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') { if (m && m.id != null) fail(m.id, -32600, 'Invalid Request'); return; }
    const has = Object.prototype.hasOwnProperty.call(m, 'id') && m.id !== null;
    if (!m.method) return;   // a response to something we never send
    if (!has) { if (m.method === 'notifications/initialized') initialized = true; return; }
    switch (m.method) {
      case 'initialize': {
        const want = m.params && m.params.protocolVersion;
        reply(m.id, {
          protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name, title, version },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'ping': reply(m.id, {}); return;
      case 'tools/list': reply(m.id, { tools: listTools() }); return;
      case 'tools/call': {
        const p = m.params || {};
        if (typeof p.name !== 'string') { fail(m.id, -32602, 'params.name must be a tool name'); return; }
        if (!bridge.tools.some(t => t.name === p.name)) { fail(m.id, -32602, `Unknown tool: ${p.name}`); return; }
        reply(m.id, toolResult(await bridge.call(p.name, p.arguments || {})));
        return;
      }
      default: fail(m.id, -32601, `Method not found: ${m.method}`);
    }
  }

  const done = new Promise(resolve => {
    input.setEncoding?.('utf8');
    input.on('data', chunk => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
        for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch(e => { log(`error: ${e && e.message}`); if (m && m.id != null) fail(m.id, -32603, 'Internal error'); });
      }
    });
    input.on('end', resolve);
    input.on('close', resolve);
  });

  return {
    notifyToolsChanged() { if (initialized) write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }); },
    done,
  };
}
