#!/usr/bin/env node
// microtasks-mcp — let an AI app use the Microtasks board open in your browser.
// stdio MCP on one side, ws://127.0.0.1:<port> to the tab on the other. Nothing
// leaves this machine; the tab does all the work against its own local board.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listen } from './ws.js';
import { Bridge } from './bridge.js';
import { serve } from './stdio.js';
import { DEFAULT_PORT, APP_URL, allowOrigin, pairUrlFor } from './config.js';
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const readJson = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };

const HELP = `microtasks-mcp ${pkg.version} — MCP server for Microtasks (https://microtasks.endura.works)

Usage: npx -y @endura.works/microtasks-mcp [--port <n>] [--url <app url>]

  --port <n>   WebSocket port on 127.0.0.1 (default ${DEFAULT_PORT}; env MICROTASKS_MCP_PORT)
  --url <u>    the app address printed for pairing (default ${APP_URL})
  --version    print the version
  --help       this text

Add it to an AI app, e.g.  claude mcp add microtasks -- npx -y @endura.works/microtasks-mcp
then open ${APP_URL}#mcp in your browser to connect the board.
`;

function args(argv) {
  const o = { port: Number(process.env.MICROTASKS_MCP_PORT) || DEFAULT_PORT, url: APP_URL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) o.port = Number(a.slice(7));
    else if (a === '--url') o.url = argv[++i];
    else if (a.startsWith('--url=')) o.url = a.slice(6);
    else { o.bad = a; }
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) o.bad = `--port ${o.port}`;
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return; }
  if (o.version) { process.stdout.write(pkg.version + '\n'); return; }
  if (o.bad) { process.stderr.write(`microtasks-mcp: unknown argument ${o.bad}\n\n${HELP}`); process.exit(2); }

  const log = s => process.stderr.write(`[microtasks-mcp] ${s}\n`);
  const pairUrl = pairUrlFor(o.url, o.port);
  const snapshot = readJson(join(here, 'tools.snapshot.json'), { tools: [] });
  const bridge = new Bridge({ version: pkg.version, pairUrl, tools: snapshot.tools, log });
  const mcp = serve({ input: process.stdin, output: process.stdout, bridge, name: 'microtasks', title: 'Microtasks', version: pkg.version, log });
  bridge.on('tools', () => mcp.notifyToolsChanged());

  let server = null;
  try {
    server = await listen({ port: o.port, allowOrigin, onConn: c => bridge.accept(c) });
    log(`v${pkg.version} on ws://127.0.0.1:${o.port} — open ${pairUrl} to connect your board`);
  } catch (e) {
    bridge.blocked = e && e.code === 'EADDRINUSE'
      ? `Port ${o.port} is taken, most likely by microtasks-mcp started by another AI app. Close that app, or start this one with --port <n> and open ${o.url.replace(/#.*$/, '')}#mcp=<n>.`
      : `microtasks-mcp could not listen on 127.0.0.1:${o.port} (${e && e.message}).`;
    log(bridge.blocked);
  }
  await mcp.done;   // the AI app closed stdin: shut down
  bridge.close();
  server?.close();
  process.exit(0);
}

main().catch(e => { process.stderr.write(`[microtasks-mcp] fatal: ${e && e.stack || e}\n`); process.exit(1); });
