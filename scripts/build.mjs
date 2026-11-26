// packages/microtasks-mcp/src → dist: the sources as they are, the protocol
// bundled beside them (its import rewritten), the tool snapshot. No bundler.
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, chmodSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages/microtasks-mcp'), src = join(pkg, 'src'), dist = join(pkg, 'dist');
// One version everywhere, one name: npm, the .mcpb manifest and the registry entry must agree.
const read = f => JSON.parse(readFileSync(join(pkg, f), 'utf8'));
const P = read('package.json'), M = read('manifest.json'), R = read('server.json');
const vs = { 'package.json': P.version, 'manifest.json': M.version, 'server.json': R.version, 'server.json packages[0]': R.packages[0].version };
if (new Set(Object.values(vs)).size !== 1) { console.error('build: versions differ', vs); process.exit(1); }
if (R.name !== P.mcpName) { console.error(`build: server.json name ${R.name} != mcpName ${P.mcpName}`); process.exit(1); }
if (R.packages[0].identifier !== P.name) { console.error('build: server.json identifier != package name'); process.exit(1); }
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const f of readdirSync(src)) {
  if (f.endsWith('.js')) writeFileSync(join(dist, f), readFileSync(join(src, f), 'utf8').replaceAll("'../../protocol/protocol.js'", "'./protocol.js'"));
  else if (f.endsWith('.json')) copyFileSync(join(src, f), join(dist, f));
}
copyFileSync(join(root, 'packages/protocol/protocol.js'), join(dist, 'protocol.js'));
chmodSync(join(dist, 'cli.js'), 0o755);
console.log(`build: ${readdirSync(dist).length} files in packages/microtasks-mcp/dist`);
