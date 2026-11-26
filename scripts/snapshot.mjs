// Refresh the tool snapshot from the app's own hello (the tab is the source of truth).
// In the app's page, with the dev harness on:  copy(JSON.stringify(await microtasksAgent.hello()))
// then:  node scripts/snapshot.mjs hello.json   (or pipe the JSON on stdin)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHello } from '../packages/protocol/protocol.js';

const text = readFileSync(process.argv[2] || 0, 'utf8');
const hello = JSON.parse(text);
if (!isHello(hello) || hello.app !== 'microtasks') { console.error('snapshot: not a Microtasks v1 hello'); process.exit(1); }
const out = join(dirname(fileURLToPath(import.meta.url)), '../packages/microtasks-mcp/src/tools.snapshot.json');
writeFileSync(out, JSON.stringify({ app: hello.app, tools: hello.tools }, null, 2) + '\n');
console.log(`snapshot: ${hello.tools.length} tools → ${out}`);
