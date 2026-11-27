# Developing

The open browser tab is the MCP server: it holds every tool and does all the work against its own local data. A pipe only carries messages, and it knows no tools and stores no data.

| Path | What |
|---|---|
| `packages/protocol` | The tab ⇄ pipe message format, v1. Bundled into each package; not published |
| `packages/microtasks-mcp` | `@endura.works/microtasks-mcp`: stdio MCP ⇄ `ws://127.0.0.1:47321` ⇄ the Microtasks tab |
| `packages/trail-mcp` | later |
| `relay/` | later: Cloudflare Worker at `mcp.endura.works/<product>` for chat apps that only take a remote MCP URL |

No runtime dependencies, plain ES modules. `npm run build` copies `src/` and the protocol into `dist/`.

```sh
npm test                     # build + node --test
node packages/microtasks-mcp/dist/cli.js --url http://127.0.0.1:8391/chrome/tasks.html
claude mcp add microtasks-dev -- node "$PWD/packages/microtasks-mcp/dist/cli.js"
```

Run the app locally (`python3 -m http.server 8391` in the Microtasks repo) and open `http://127.0.0.1:8391/chrome/tasks.html#mcp`.

**Tool snapshot.** `tools/list` must answer before a tab connects, so the package ships `src/tools.snapshot.json`, a copy of the tab's `hello`. After a tool changes in the app, refresh it: in the app with `localStorage['microtasks.agent']='1'`, run `copy(JSON.stringify(await microtasksAgent.hello()))`, save it as `hello.json`, then run `npm run snapshot -- hello.json`.

## Release

1. Bump `version` in `packages/microtasks-mcp/package.json`, `manifest.json` and `server.json` (both places). `npm run build` refuses a mismatch.
2. Commit, then `git tag microtasks-mcp@<version> && git push origin main --tags`.
3. `.github/workflows/release.yml` publishes to npm (trusted publishing, with provenance), attaches `microtasks.mcpb` to a GitHub release, and lists `works.endura/microtasks` on the MCP Registry.
