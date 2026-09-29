# local-env-mcp

A stateless [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server built with TypeScript. It exposes your local machine — filesystem, git, shell, network, databases, and system — to any MCP-compatible LLM client over HTTP with OAuth 2.0 authentication.

Built on [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) with Express, Zod schemas, and a layered architecture.

---

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd local-mcp
bun install

# 2. Configure environment
cp .env.example .env
# Edit .env — set MCP_AUTH_TOKEN and PUBLIC_URL (see Environment Variables)

# 3. Build
bun run build

# 4. Start
bun start
```

---

## Connecting via claude.ai Web

claude.ai connects using the standard MCP OAuth 2.0 flow. The server must be reachable over HTTPS from the internet.

**Step 1 — expose port 3000 publicly:**

```bash
# Option A: ngrok (temporary URL, free)
ngrok http 3000

# Option B: Cloudflare Tunnel (stable, no account needed)
cloudflared tunnel --url http://localhost:3000
```

**Step 2 — set `PUBLIC_URL` in `.env` to the HTTPS URL you got:**

```
PUBLIC_URL=https://abc123.ngrok-free.app
```

**Step 3 — restart and add to claude.ai:**

```
Settings -> Integrations -> Add MCP Server
URL: https://abc123.ngrok-free.app
```

claude.ai will open an approval page in your browser on the first connection. Click **Approve** to complete the OAuth handshake.

> Without `PUBLIC_URL` set to a public HTTPS address, claude.ai cannot complete OAuth registration and will show "Couldn't register with sign-in service."

---

## Table of Contents

- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Transport & Session Model](#transport--session-model)
- [Tool Reference](#tool-reference)
  - [Filesystem](#-filesystem)
  - [Git](#-git)
  - [Network](#-network)
  - [Shell](#-shell)
  - [System](#%EF%B8%8F-system)
  - [Postgres](#-postgres)
- [Environment Variables](#environment-variables)
- [Extending with New Tools](#extending-with-new-tools)
- [Security Model](#security-model)

---

## Architecture

```
LLM Client (claude.ai / Cursor / API)
        │  HTTPS
        ▼
   OAuth Auth Router (mcpAuthRouter)
        │  /.well-known/oauth-authorization-server
        │  /oauth/register, /oauth/authorize, /oauth/token
        ▼
   Bearer Auth Middleware
        │
        ▼
   Express Routing Layer (src/app.ts)
        │
        ├── GET  /health    → System checks
        ├── POST /mcp       → Create / resume session
        ├── GET  /mcp       → SSE stream
        └── DELETE /mcp     → Terminate session
               │
               ▼
   Layered Tool Registry (src/tools/registry.ts)
               │
 ┌─────────┬───┴─────┬─────────┬─────────┬─────────┐
 ▼         ▼         ▼         ▼         ▼         ▼
 FS       Git      Network   Shell     System    Postgres
(9)      (11)       (8)       (9)       (8)       (3)
```

Each POST request gets a fresh McpServer instance managed by a singleton Session Manager.

---

## Project Structure

```
local-mcp/
├── src/
│   ├── server.ts               # Listener & bootstrap
│   ├── app.ts                  # Express routing & middleware wiring
│   ├── config.ts               # Zod-validated env loader
│   ├── logger.ts               # Winston configuration
│   ├── auth/
│   │   └── oauthProvider.ts    # OAuth 2.0 provider (dynamic client reg, PKCE)
│   ├── routes/                 # Controllers (health.ts, mcp.ts)
│   ├── services/               # Core logic (processManager, sessionManager)
│   ├── types/                  # Shared TS definitions
│   └── tools/                  # 48 MCP tools by domain
│       ├── filesystem/
│       ├── git/
│       ├── network/
│       ├── postgres/
│       ├── shell/
│       ├── system/
│       └── registry.ts         # Injects toolsets into active MCP sessions
```

---

## Transport & Session Model

Uses **Streamable HTTP** transport.

| Route | Purpose |
|---|---|
| `POST /mcp` | Initiates tool requests (tools/list, tools/call) |
| `GET /mcp` | Streams Server-Sent Events (SSE) for persistent clients |
| `DELETE /mcp` | Gracefully terminates an active session |

---

## Tool Reference

**48 tools** across 6 domains.

### Filesystem
*Paths resolved relative to `FS_ROOT`, protected against traversal*

`read_file`, `write_file`, `list_dir`, `make_dir`, `delete_path`, `copy_path`, `move_path`, `search_files`, `file_info`

### Git
*Powered by simple-git, targets directories relative to `FS_ROOT`*

`git_status`, `git_diff`, `git_log`, `git_branch`, `git_add`, `git_commit`, `git_push`, `git_pull`, `git_clone`, `git_stash`, `git_show`

### Network

`http_request`, `ping`, `dns_lookup`, `port_scan`, `whois`, `traceroute`, `download_file`, `check_connectivity`

### Shell
*Managed by `ProcessManager`, spawn logs isolated in memory*

`run_command`, `spawn_process`, `list_processes`, `get_process_logs`, `kill_process`, `system_info`, `get_env`, `which`, `ps`

### System

`cron_list`, `disk_usage`, `open`, `notify`, `clipboard_write`, `clipboard_read`, `screenshot`, `list_installed`

### Postgres
*Connects on-the-fly — no persistent credentials in env*

- `pg_query` — parameterized raw SQL
- `pg_list_tables` — enumerate tables, skipping system schemas
- `pg_describe_table` — column types, nullability, defaults

Pass a `connectionString` argument per call; the server holds no DB credentials.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PUBLIC_URL` | **Yes (OAuth)** | `http://localhost:3000` | Public HTTPS URL of the server. Must be reachable from the internet for claude.ai web OAuth to work. |
| `MCP_AUTH_TOKEN` | **Yes (prod)** | _(none)_ | Static bearer token for non-OAuth clients. Omitting warns heavily in dev mode. |
| `PORT` | No | `3000` | HTTP port the server binds to. |
| `FS_ROOT` | No | `/host-home` | Root directory for filesystem operations. |
| `NODE_ENV` | No | `development` | Set to `production` to enforce auth checks. |
| `LOG_LEVEL` | No | `debug` | Winston log level. |
| `LOG_DIR` | No | `./logs` | Directory for log files. |

---

## Extending with New Tools

1. Create a typed definition in the target domain (e.g. `src/tools/custom/myTool.ts`):

```typescript
import { z } from "zod";
import type { ToolDefinition } from "../../types/index.js";
import { ok } from "../../utils/response.js";

export const myCustomTool: ToolDefinition = {
  name: "custom_tool",
  description: "Does something specific",
  schema: {
    target: z.string().describe("What to target"),
  },
  handler: async ({ target }) => {
    return ok(`Executed on ${target}`);
  },
};
```

2. Import and add it to `registerAllTools` in `src/tools/registry.ts`.

---

## Security Model

| Concern | Mitigation |
|---|---|
| Authentication | OAuth 2.0 with PKCE for claude.ai web; static bearer token for other clients |
| Path traversal | `safePath()` anchors all filesystem ops to `FS_ROOT` |
| Secret leakage | `get_env` redacts keys matching common secret patterns (password, api_key, secret, etc.) |
| DB credentials | Postgres connects per-call via caller-supplied `connectionString`, never stored in env |
| Docker isolation | Runs as unprivileged `mcpuser` with only the home directory mounted |
