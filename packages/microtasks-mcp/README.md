# @endura.works/microtasks-mcp

Let an AI app use your [Microtasks](https://microtasks.endura.works) board. Ask it to break a big piece of work down and "push it to Microtasks". The tasks land on your board as a real tree, with notes, ready to work through. The AI can do what you can do on the board: read, create, break down, edit, group, move and bin.

**Private by design.** This package runs on your computer and talks only to the Microtasks tab in your own browser, over `127.0.0.1`. Nothing leaves your machine. The tab does all the work against its own board; if you use Cloud sync, your changes sync exactly as if you had made them by hand.

## Install

**Claude Code**
```sh
claude mcp add microtasks -- npx -y @endura.works/microtasks-mcp
```

**Codex**
```sh
codex mcp add microtasks -- npx -y @endura.works/microtasks-mcp
```

**Gemini CLI, Cursor, VS Code, LM Studio, and other apps with an `mcpServers` config**
```json
{
  "mcpServers": {
    "microtasks": { "command": "npx", "args": ["-y", "@endura.works/microtasks-mcp"] }
  }
}
```

**Claude Desktop:** download `microtasks.mcpb` from the [latest release](https://github.com/endura-works/mcp/releases) and double-click it.

Requires Node.js 20 or newer (Claude Desktop brings its own).

## Connect your board

Open **https://microtasks.endura.works/#mcp** in Chrome, Edge or Firefox. The first time, Chrome asks to allow access to devices on your local network: allow it. This permission is only for this connection. The **Connect AI** panel (in the right rail) then says *Connected*.

- One tab at a time. Another Microtasks tab shows "Paired elsewhere" with a **Use this tab** button.
- **Read-only** in the panel lets the AI read but refuses every change.
- If the tab is closed, the AI gets a message telling you which link to open.
- Safari can't reach a local server from a secure page; use another browser.

## Tools

| Tool | What it does |
|---|---|
| `get_board` | Spaces, channels, one space's task trees and groups (no notes) |
| `get_task` | One task with its note, status, due date, parent and children |
| `put_task` | Create or edit a task; `children` adds a whole breakdown in one call |
| `delete_task` / `restore_task` | To the Recycle bin and back, never a hard delete |
| `put_group` / `delete_group` | Group root tasks; ungroup |
| `put_channel` / `delete_channel` | File groups into channels |
| `put_project` | Create or rename a project space |

The tools are defined by the app itself. This package only carries messages and knows no tasks.

## Options

```
--port <n>   WebSocket port on 127.0.0.1 (default 47321; env MICROTASKS_MCP_PORT)
             then open https://microtasks.endura.works/#mcp=<n>
--url <u>    the app address printed for pairing
```

If two AI apps both start the server, the second finds the port taken and tells the AI to use `--port`.

## License

MIT. Source: https://github.com/endura-works/mcp
