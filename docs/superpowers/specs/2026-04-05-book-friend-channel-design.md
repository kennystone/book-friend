# Book-Friend Channel — Design

## Problem

`src/chat.ts` spawns a fresh `claude --print` subprocess for every message. Each invocation reloads the book-friend skill, re-reads `memory/book_<slug>.md`, and starts with no memory of prior turns in the conversation. The user wants to post messages and interact with the book-friend skill without paying that reload cost every time.

## Solution

Build a project-local MCP [channel server](https://code.claude.com/docs/en/channels-reference) that pushes HTTP POST bodies into a persistent, interactive Claude Code session as `<channel>` notification events. The Claude Code session is started once with the book-friend skill pre-loaded into the system prompt; each subsequent message arrives as an event in that session's existing context.

This is a **one-way** channel: the user watches replies in the Claude Code terminal window. No reply tool, no permission relay, no web UI.

## Runtime topology

```
┌────────────────┐  stdio   ┌──────────────────┐  HTTP POST  ┌──────────┐
│ Claude Code    │◄────────►│ src/channel.ts   │◄────────────│ src/say  │
│ (interactive)  │          │ (MCP + :8789)    │             │ (CLI)    │
└────────────────┘          └──────────────────┘             └──────────┘
```

Claude Code spawns `channel.ts` as an MCP subprocess over stdio. The same process also binds a local HTTP listener on `127.0.0.1:8789`. When `say` POSTs a message, the HTTP handler calls `mcp.notification()` to push a `notifications/claude/channel` event into the running session. Claude reads the event, responds in the terminal, and the conversation context is preserved for the next message.

## Usage

Start the session once, from the project root:

```bash
claude --dangerously-load-development-channels server:book-friend
```

(The `--dangerously-load-development-channels` flag is required during the Channels research preview because custom channels aren't on the approved allowlist. Source: [Channels reference](https://code.claude.com/docs/en/channels-reference#test-during-the-research-preview).)

Then, from any other terminal:

```bash
bun run say "school of night, let's start at chapter 4"
bun run say "who is marlowe hanging out with at this point?"
```

Replies appear in the Claude Code window.

## Components

### `.mcp.json` (new, at project root)

```json
{
  "mcpServers": {
    "book-friend": { "command": "bun", "args": ["./src/channel.ts"] }
  }
}
```

Project-local MCP config. Claude Code reads this on startup and spawns the channel as a subprocess.

### `src/channel.ts` (new, ~60 lines)

**Responsibilities:**
1. Read `.claude/skills/book-friend/SKILL.md` at startup.
2. Construct the `instructions` string by concatenating the skill content with one trailing line:
   > Events arriving as `<channel source="book-friend">` are the user's book-friend messages. Respond to each one following the skill rules above. The user is watching this terminal — reply directly, no reply tool needed.
3. Construct an MCP `Server` with:
   - `name: "book-friend"`, `version: "0.0.1"`
   - `capabilities.experimental: { "claude/channel": {} }` — registers the channel listener
   - `instructions` from step 2 (appended to Claude's system prompt)
   - No `tools` capability (one-way)
   - No `claude/channel/permission` capability
4. Connect over `StdioServerTransport()`.
5. Start `Bun.serve({ port: 8789, hostname: "127.0.0.1" })`.
6. Expose a single HTTP handler function `handleRequest(req, notify)` where `notify` is a callback `(content: string) => Promise<void>`. The handler is factored this way so unit tests can pass a fake `notify`.

**HTTP behavior:**
- `POST /` → read body as text → call `notify(body)` → return `200 "ok"`.
- Other methods → `405`.
- Other paths → `404`.
- If `notify` throws → `500` with the error message in the body, log to stderr, do not crash the process.
- Empty POST body → still forward to Claude as an empty `<channel>` event (let Claude decide how to respond).

**No `meta` on notifications.** Single-user, single-conversation — there's nothing to route on.

### `src/say.ts` (new, ~15 lines)

**Responsibilities:**
1. Read `process.argv.slice(2).join(" ")` as the message.
2. If empty: print usage (`"Usage: say <message>"`) and `exit 1`.
3. `fetch("http://127.0.0.1:8789/", { method: "POST", body: message })`.
4. On success: exit 0 silently (replies land in the Claude Code window, not here).
5. On connection-refused: print
   > book-friend channel not running. Start it in another terminal:
   > `claude --dangerously-load-development-channels server:book-friend`
   and exit 1.
6. On any other non-OK response: print status + body and exit 1.

### `package.json` edits

- Add `"@modelcontextprotocol/sdk"` to `dependencies`.
- Add `"say": "./src/say.ts"` to `bin`.
- Remove `"book-friend": "./src/chat.ts"` from `bin`.
- Delete `src/chat.ts`.

## Error handling

| Failure | Where | Behavior |
| :-- | :-- | :-- |
| `SKILL.md` not readable at startup | `channel.ts` | Throw. MCP server fails to start. Claude Code's `/mcp` shows "Failed to connect"; stderr trace lands in `~/.claude/debug/<session-id>.txt`. |
| Port 8789 already bound | `channel.ts` | `Bun.serve` throws `EADDRINUSE`, same failure path as above. |
| `mcp.notification()` throws inside HTTP handler | `channel.ts` | Catch, return `500` with the error message, log to stderr. Process stays up. |
| Claude Code session dies | everywhere | MCP subprocess is killed by Claude Code. User restarts the session and they're back. No recovery code needed. |
| `say` invoked with no argument | `say.ts` | Usage message, exit 1. |
| `say` can't reach the channel | `say.ts` | Friendly "start the session" hint, exit 1. |

## What's deliberately NOT handled

- **Authentication / sender gating.** The [Channels reference](https://code.claude.com/docs/en/channels-reference#gate-inbound-messages) warns about prompt injection on public endpoints, but this server binds to `127.0.0.1` only. Anyone who can reach the port can already run commands as the user.
- **Rate limiting.** Single user, single terminal.
- **Message queuing / ordering.** MCP runtime handles events sequentially; not our problem.
- **Reconnection or process supervision.** Channel lifetime equals session lifetime, by design.
- **Per-book or per-session routing via `meta`.** Only one conversation at a time on this machine.

## Testing

### Unit test — `src/channel.test.ts`

Exercises `handleRequest(req, notify)` in isolation with a fake `notify`:

- `POST /` with body `"hello"` → `notify` called once with `"hello"`, response status 200, body `"ok"`.
- `GET /` → response status 405, `notify` not called.
- `POST /other` → response status 404, `notify` not called.
- `POST /` with empty body → `notify` called with `""`, response status 200.
- `POST /` where `notify` throws → response status 500 with the error message in the body, stderr line logged.

Run with `bun test`.

### Manual end-to-end smoke test

Documented as a checklist (in the implementation plan, not automated — spawning Claude Code from a test harness is out of scope for a project this size):

1. Run `bun install` to pick up `@modelcontextprotocol/sdk`.
2. Start Claude Code: `claude --dangerously-load-development-channels server:book-friend` from project root. Confirm no "Failed to connect" in `/mcp`.
3. In a second terminal: `bun run say "hi"`. Confirm `say` exits 0.
4. Observe the Claude Code window: a `<channel source="book-friend">hi</channel>` event arrives and Claude responds per the book-friend skill (probably asking which book and where the user is).
5. `bun run say "school of night, chapter 4"`. Claude should pick up from step 4's question without re-asking and engage with the conversation. If `memory/book_the-school-of-night.md` exists, Claude reads it now.
6. `bun run say "what did i just tell you my current chapter was?"`. Claude should answer "4" without needing the memory file or re-reading anything — this is the proof that the session kept prior turns in context.
7. Exit Claude Code. Confirm `say` now errors with the "start it in another terminal" hint.

## Open questions

None. All three design choices (one-way, CLI wrapper, embed SKILL.md in instructions) are settled.
