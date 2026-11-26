# MCP for Microtasks & Trail

The pipes that connect AI apps to Endura's browser apps. **The open browser tab is the MCP server**: it holds every tool and does all the work against its own local data. A pipe only carries messages, and it knows no tools and stores no data.

| Path | What | Status |
|---|---|---|
| `packages/protocol` | The tab ⇄ pipe message format, v1. Bundled into each package; not published | v1 |
| `packages/microtasks-mcp` | [`@endura.works/microtasks-mcp`](https://www.npmjs.com/package/@endura.works/microtasks-mcp): stdio MCP ⇄ `ws://127.0.0.1:47321` ⇄ the Microtasks tab | 1.0 |
| `packages/trail-mcp` | `@endura.works/trail-mcp` | later |
| `relay/` | Cloudflare Worker at `mcp.endura.works/<product>`, for chat apps that only take a remote MCP URL | later |

No runtime dependencies. Plain ES modules, no build step beyond copying the protocol in (`npm run build`).

## Develop

```sh
npm test                     # build + node --test (WebSocket framing, pairing, retries, stdio MCP)
node packages/microtasks-mcp/dist/cli.js --url http://127.0.0.1:8391/chrome/tasks.html
claude mcp add microtasks-dev -- node "$PWD/packages/microtasks-mcp/dist/cli.js"
```

Run the app locally (`python3 -m http.server 8391` in the Microtasks repo) and open `http://127.0.0.1:8391/chrome/tasks.html#mcp`.

**Tool snapshot:** `tools/list` must answer before a tab connects, so the package ships `src/tools.snapshot.json`, a copy of the tab's `hello`. After a tool changes in the app, refresh it: in the app with `localStorage['microtasks.agent']='1'`, run `copy(JSON.stringify(await microtasksAgent.hello()))`, save it as `hello.json`, then run `npm run snapshot -- hello.json`. Once a tab connects, its own list replaces the snapshot (`notifications/tools/list_changed`).

## Release (`microtasks-mcp`)

1. Bump `version` in `package.json`, `manifest.json` and `server.json` (both places). `npm run build` refuses a mismatch.
2. Tag and push: `git tag microtasks-mcp@1.0.1 && git push --tags`.
3. `.github/workflows/release.yml` does the rest:
   - `npm publish` through trusted publishing, so provenance is attached and no token is stored;
   - builds `microtasks.mcpb` and attaches it to the GitHub release;
   - publishes `works.endura/microtasks` to the MCP Registry with DNS auth.

## Privacy

The local pipe never leaves your computer. The future cloud relay will pass messages through Endura's Worker without storing them.

## License

MIT. Anyone may run or self-host these pipes.
