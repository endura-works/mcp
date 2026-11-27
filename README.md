# Microtasks for AI apps

Let your AI app work on your [Microtasks](https://microtasks.endura.works) board. Ask it to break a big job into tasks and "push it to Microtasks", and the tasks show up on your board with notes. It can also read, edit, group and tidy your tasks.

Everything stays on your computer.

## Install

**Claude Code**
```sh
claude mcp add microtasks -- npx -y @endura.works/microtasks-mcp
```

**Codex**
```sh
codex mcp add microtasks -- npx -y @endura.works/microtasks-mcp
```

**Gemini CLI, Cursor, VS Code, LM Studio and other apps**
```json
{
  "mcpServers": {
    "microtasks": { "command": "npx", "args": ["-y", "@endura.works/microtasks-mcp"] }
  }
}
```

**Claude Desktop:** download `microtasks.mcpb` from [Releases](https://github.com/endura-works/mcp/releases) and double-click it.

You need [Node.js](https://nodejs.org) 20 or newer (Claude Desktop already includes it).

## Connect

Open **https://microtasks.endura.works/#mcp** in Chrome, Edge or Firefox. If the browser asks to allow local network access, allow it. The **Connect AI** panel then says *Connected*.

Keep that tab open while you work with your AI app.

## License

MIT
