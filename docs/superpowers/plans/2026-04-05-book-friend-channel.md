# Book-Friend Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-message `claude --print` subprocess in `src/chat.ts` with a persistent MCP channel server so messages posted to a local HTTP port stream into a live Claude Code session without reloading the skill or losing conversation context.

**Architecture:** A single MCP server (`src/channel.ts`) runs as a Claude Code stdio subprocess AND binds a localhost HTTP listener on port 8789. POSTs to the HTTP listener are forwarded to the running session as `notifications/claude/channel` events. The book-friend skill is embedded into the MCP server's `instructions` field at startup so it's present in Claude's system prompt from the first message. A small `src/say.ts` CLI POSTs messages for convenience.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk`, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-04-05-book-friend-channel-design.md`

**File structure:**

- Create: `.mcp.json` — registers the channel as an MCP server for this project
- Create: `src/channel.ts` — MCP channel server + HTTP listener + testable `handleRequest` function
- Create: `src/channel.test.ts` — unit tests for `handleRequest`
- Create: `src/say.ts` — CLI wrapper that POSTs a message to the channel
- Modify: `package.json` — add SDK dep, add `say` script + bin, remove `book-friend` bin
- Delete: `src/chat.ts` — replaced by the channel + say CLI

---

## Task 1: Install MCP SDK and register the channel

**Files:**
- Create: `.mcp.json`
- Modify: `package.json` (dependencies added automatically by `bun add`)

- [ ] **Step 1: Install the MCP SDK**

Run: `bun add @modelcontextprotocol/sdk`
Expected: `package.json` gains `"@modelcontextprotocol/sdk": "^X.Y.Z"` under `dependencies`; `bun.lock` updates.

- [ ] **Step 2: Create `.mcp.json` at the project root**

Create `/Users/kennystone/dev/book-friend/.mcp.json` with:

```json
{
  "mcpServers": {
    "book-friend": { "command": "bun", "args": ["./src/channel.ts"] }
  }
}
```

This is project-local MCP config. Claude Code reads it on startup and spawns the channel as a stdio subprocess.

- [ ] **Step 3: Commit**

```bash
git add .mcp.json package.json bun.lock
git commit -m "Add MCP SDK dependency and project .mcp.json for book-friend channel"
```

---

## Task 2: `handleRequest` — POST / happy path (TDD)

The HTTP handler is factored as a pure function `handleRequest(req, notify)` so it can be unit-tested with a fake `notify` callback. In this task we add the first test, create the file, and implement the happy path.

**Files:**
- Create: `src/channel.test.ts`
- Create: `src/channel.ts`

- [ ] **Step 1: Write the failing test**

Create `src/channel.test.ts` with:

```ts
import { test, expect, describe, mock } from "bun:test";
import { handleRequest, type Notify } from "./channel.ts";

describe("handleRequest", () => {
  test("POST / with body forwards to notify and returns 200 ok", async () => {
    const notify = mock(async (_content: string) => {});
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "hello",
    });
    const res = await handleRequest(req, notify);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/channel.test.ts`
Expected: FAIL — `Cannot find module './channel.ts'` (or similar — the module doesn't exist yet).

- [ ] **Step 3: Create `src/channel.ts` with minimal `handleRequest`**

Create `src/channel.ts` with:

```ts
#!/usr/bin/env bun

export type Notify = (content: string) => Promise<void>;

export async function handleRequest(
  req: Request,
  notify: Notify,
): Promise<Response> {
  const body = await req.text();
  await notify(body);
  return new Response("ok", { status: 200 });
}
```

No MCP server, no Bun.serve yet — just the pure handler so the test can import it.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/channel.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/channel.ts src/channel.test.ts
git commit -m "Add handleRequest for channel HTTP forwarding (POST happy path)"
```

---

## Task 3: `handleRequest` — method and path rejection (TDD)

Add tests that exercise the four rejection branches: GET is 405, non-root paths are 404, empty body still forwards. Then expand `handleRequest` to handle them.

**Files:**
- Modify: `src/channel.test.ts`
- Modify: `src/channel.ts`

- [ ] **Step 1: Add failing tests**

Append the following tests inside the `describe("handleRequest", ...)` block in `src/channel.test.ts`:

```ts
  test("POST / with empty body still forwards", async () => {
    const notify = mock(async (_content: string) => {});
    const req = new Request("http://localhost/", { method: "POST", body: "" });
    const res = await handleRequest(req, notify);
    expect(res.status).toBe(200);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("");
  });

  test("GET / returns 405 and does not notify", async () => {
    const notify = mock(async (_content: string) => {});
    const req = new Request("http://localhost/", { method: "GET" });
    const res = await handleRequest(req, notify);
    expect(res.status).toBe(405);
    expect(notify).not.toHaveBeenCalled();
  });

  test("POST /other returns 404 and does not notify", async () => {
    const notify = mock(async (_content: string) => {});
    const req = new Request("http://localhost/other", {
      method: "POST",
      body: "hi",
    });
    const res = await handleRequest(req, notify);
    expect(res.status).toBe(404);
    expect(notify).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test src/channel.test.ts`
Expected: The empty-body test should PASS already (current impl forwards everything). GET and POST /other tests should FAIL — the current impl returns 200 for every request.

- [ ] **Step 3: Expand `handleRequest`**

Replace the body of `handleRequest` in `src/channel.ts` with:

```ts
export async function handleRequest(
  req: Request,
  notify: Notify,
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname !== "/") {
    return new Response("not found", { status: 404 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const body = await req.text();
  await notify(body);
  return new Response("ok", { status: 200 });
}
```

Order matters: path check first, then method, so `GET /other` → 404 rather than 405 (mirrors typical HTTP routing).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/channel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channel.ts src/channel.test.ts
git commit -m "Reject non-POST methods and non-root paths in channel handler"
```

---

## Task 4: `handleRequest` — notify error handling (TDD)

If `mcp.notification()` throws, the handler should return `500` with the error message and log to stderr, but NOT crash the process.

**Files:**
- Modify: `src/channel.test.ts`
- Modify: `src/channel.ts`

- [ ] **Step 1: Add failing test**

Append inside the `describe("handleRequest", ...)` block in `src/channel.test.ts`:

```ts
  test("POST / with throwing notify returns 500 with message", async () => {
    const notify = mock(async (_content: string) => {
      throw new Error("boom");
    });
    const req = new Request("http://localhost/", { method: "POST", body: "hi" });
    const res = await handleRequest(req, notify);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("boom");
    expect(notify).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/channel.test.ts`
Expected: FAIL — the uncaught throw propagates out of `handleRequest` as an unhandled rejection. The test will show an error, not a 500 response.

- [ ] **Step 3: Wrap `notify` call in try/catch**

Replace the tail of `handleRequest` in `src/channel.ts` (from `const body = ...` onward) with:

```ts
  const body = await req.text();

  try {
    await notify(body);
    return new Response("ok", { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[book-friend channel] notify failed: ${message}`);
    return new Response(message, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test src/channel.test.ts`
Expected: PASS (5 tests). You'll also see the stderr line `[book-friend channel] notify failed: boom` printed during the test run — that's expected.

- [ ] **Step 5: Commit**

```bash
git add src/channel.ts src/channel.test.ts
git commit -m "Return 500 when channel notify throws instead of crashing"
```

---

## Task 5: Wire MCP server and Bun.serve in the main block

`handleRequest` is tested. Now add the actual MCP server construction, skill loading, stdio transport, and HTTP listener. These side effects run only when `channel.ts` is invoked directly (not when imported by tests), guarded by `import.meta.main`.

**Files:**
- Modify: `src/channel.ts`

- [ ] **Step 1: Add imports at the top of `src/channel.ts`**

Insert three new import lines immediately after the shebang. The top of the file should look like this after the edit:

```ts
#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, join } from "path";

export type Notify = (content: string) => Promise<void>;
```

- [ ] **Step 2: Append the main block to `src/channel.ts`**

At the bottom of the file, after the `handleRequest` function, append:

```ts
if (import.meta.main) {
  const projectRoot = join(dirname(import.meta.path), "..");
  const skillPath = join(projectRoot, ".claude/skills/book-friend/SKILL.md");
  const skill = await Bun.file(skillPath).text();

  const instructions =
    skill +
    "\n\n---\n\n" +
    'Events arriving as <channel source="book-friend"> are the user\'s book-friend messages. ' +
    "Respond to each one following the skill rules above. " +
    "The user is watching this terminal — reply directly, no reply tool needed.";

  const mcp = new Server(
    { name: "book-friend", version: "0.0.1" },
    {
      capabilities: { experimental: { "claude/channel": {} } },
      instructions,
    },
  );

  await mcp.connect(new StdioServerTransport());

  const notify: Notify = async (content) => {
    await mcp.notification({
      method: "notifications/claude/channel",
      params: { content },
    });
  };

  Bun.serve({
    port: 8789,
    hostname: "127.0.0.1",
    fetch: (req) => handleRequest(req, notify),
  });
}
```

Why `import.meta.main`: when `bun:test` imports this file, `import.meta.main` is `false`, so the main block is skipped. That keeps tests fast and prevents the MCP stdio transport from trying to attach to the test runner's stdin.

- [ ] **Step 3: Run the unit tests to confirm they still pass**

Run: `bun test src/channel.test.ts`
Expected: PASS (5 tests). The main block must NOT execute during the test run — if it does, you'll see hangs or stdio errors. If that happens, verify the `if (import.meta.main)` guard wraps the entire main block including the top-level `await`.

- [ ] **Step 4: Commit**

```bash
git add src/channel.ts
git commit -m "Wire MCP server and HTTP listener in channel.ts main block"
```

---

## Task 6: Create `src/say.ts` CLI client

Tiny script: read argv, POST to `127.0.0.1:8789`, print a helpful hint on connection refused. No unit tests — the logic is a single `fetch` call and the interesting failure modes are already covered by manual verification in the next step.

**Files:**
- Create: `src/say.ts`

- [ ] **Step 1: Create `src/say.ts`**

```ts
#!/usr/bin/env bun

const message = process.argv.slice(2).join(" ");

if (!message) {
  console.error("Usage: say <message>");
  process.exit(1);
}

try {
  const res = await fetch("http://127.0.0.1:8789/", {
    method: "POST",
    body: message,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`say: ${res.status} ${text}`);
    process.exit(1);
  }
} catch (err) {
  if (err instanceof TypeError) {
    console.error(
      "book-friend channel not running. Start it in another terminal:",
    );
    console.error(
      "  claude --dangerously-load-development-channels server:book-friend",
    );
    process.exit(1);
  }
  throw err;
}
```

Why catch `TypeError`: Bun's `fetch` throws `TypeError` (with the underlying `ConnectionRefused` in `.cause`) when the target is not listening. Catching the broad `TypeError` class means we don't need fragile string matching on error messages. Any other exception type is re-thrown.

- [ ] **Step 2: Verify the no-args branch**

Run: `bun src/say.ts`
Expected: Prints `Usage: say <message>` to stderr and exits 1.

- [ ] **Step 3: Verify the connection-refused branch**

Run: `bun src/say.ts "hello"`
Expected: Prints:
```
book-friend channel not running. Start it in another terminal:
  claude --dangerously-load-development-channels server:book-friend
```
and exits 1. (No channel is running, so this is the expected error.)

If you instead see an uncaught error trace, Bun's fetch is throwing a different error class on your system — inspect the error and widen the catch.

- [ ] **Step 4: Commit**

```bash
git add src/say.ts
git commit -m "Add say.ts CLI that POSTs messages to the book-friend channel"
```

---

## Task 7: Update `package.json` and remove `chat.ts`

Add a `say` script so `bun run say "..."` works (matching the existing `scan` script convention). Add a `say` bin entry for future `bun link` ergonomics. Remove the stale `book-friend` bin entry and delete `src/chat.ts`.

**Files:**
- Modify: `package.json`
- Delete: `src/chat.ts`

- [ ] **Step 1: Edit `package.json`**

Replace the `bin` object:

```json
  "bin": {
    "say": "./src/say.ts",
    "book-scan": "./src/index.ts"
  },
```

(Remove `"book-friend": "./src/chat.ts"`, add `"say": "./src/say.ts"`.)

Replace the `scripts` object:

```json
  "scripts": {
    "scan": "bun run src/index.ts",
    "say": "bun run src/say.ts"
  },
```

(Add `"say": "bun run src/say.ts"`.)

- [ ] **Step 2: Delete the old CLI**

Run: `rm src/chat.ts`
Expected: `src/chat.ts` removed from the working tree.

(Note: in this branch's history, `chat.ts` was never committed to git — it existed only as a working-tree file from a prior session. Use plain `rm`, not `git rm`.)

- [ ] **Step 3: Verify `bun run say` works end-to-end (no channel running)**

Run: `bun run say "test"`
Expected: Same connection-refused hint as Task 6 Step 3. This confirms `bun run` forwards argv correctly and the scripts entry is wired up.

Also verify the tests still pass after the file deletions:

Run: `bun test`
Expected: `channel.test.ts` passes. Other existing test files (`assemble.test.ts`, `index.test.ts`) should be unaffected and still pass.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "Wire say CLI into package.json and remove old chat.ts"
```

Note: `chat.ts` was untracked, so the `rm` in Step 2 affects only the working tree — there's nothing about `chat.ts` to stage. The commit captures only the `package.json` edits, which conceptually replace the `chat.ts` bin entry with the `say.ts` one.

---

## Task 8: End-to-end smoke test

This is a manual verification checklist — there's no way to automate it without spawning Claude Code from a test harness, which is out of scope for a project this size. Run it once after Task 7 is committed to confirm everything is wired together.

**Files:** (none)

- [ ] **Step 1: Confirm `bun install` is clean**

Run: `bun install`
Expected: No errors. `@modelcontextprotocol/sdk` is present.

- [ ] **Step 2: Start Claude Code with the development channels flag**

Run (in project root): `claude --dangerously-load-development-channels server:book-friend`
Expected: Claude Code starts. A confirmation prompt about the development channel appears; approve it. Then `/mcp` inside Claude Code shows `book-friend` as **connected**, not "Failed to connect". If it says failed, check `~/.claude/debug/<session-id>.txt` for the stderr trace from `channel.ts`.

- [ ] **Step 3: Send the first message**

In a second terminal (project root): `bun run say "hi"`
Expected: `say` exits 0 silently. In the Claude Code window, a `<channel source="book-friend">hi</channel>` event arrives and Claude responds per the book-friend skill — likely by asking which book you're reading and where you are.

- [ ] **Step 4: Send a follow-up and verify context persists**

Run: `bun run say "school of night, chapter 4"`
Expected: Claude picks up from the previous turn without re-asking. If `memory/book_the-school-of-night.md` exists, Claude reads it now.

- [ ] **Step 5: Verify prior turns are in context**

Run: `bun run say "what did i just tell you my current chapter was?"`
Expected: Claude answers "4" (or similar) using conversation memory alone, without re-reading the memory file or re-initializing. This is the proof that the session kept prior turns in context — the whole point of the channel architecture.

- [ ] **Step 6: Verify the connection-refused path after shutdown**

Exit Claude Code (Ctrl+C or `/exit`). Then run: `bun run say "test"`
Expected: The connection-refused hint from Task 6 Step 3. This confirms the channel lifecycle is tied to Claude Code's lifecycle as designed.

- [ ] **Step 7: Commit (only if any issues were fixed)**

If Steps 1–6 all passed as expected, no commit is needed — the implementation is done. If you had to fix anything along the way, commit those fixes now:

```bash
git add <files>
git commit -m "Fix <specific issue> found during smoke test"
```
