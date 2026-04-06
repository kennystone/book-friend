# Book-Friend Channel — Two-Way Upgrade Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the book-friend channel from one-way (Claude replies in its own terminal) to two-way (Claude's reply is returned as the HTTP response body, so `say` can print it). Builds on top of the work in [`2026-04-05-book-friend-channel.md`](2026-04-05-book-friend-channel.md).

**Architecture:** Add a `reply` MCP tool that Claude calls with a `request_id` and the reply text. The HTTP handler holds the POST connection open, awaits a Promise keyed by that `request_id`, and returns the reply text as the response body. A small `ReplyRegistry` helper owns the pending-request map, the per-request timeout, and the abort-signal cleanup. `handleRequest` is refactored to depend on the registry via dependency injection, keeping it unit-testable.

**Tech Stack:** Bun, TypeScript, `@modelcontextprotocol/sdk`, `bun:test`. (No new deps.)

**Spec:** `docs/superpowers/specs/2026-04-05-book-friend-channel-design.md` (with two-way addendum added in Task F).

---

## File structure

- Modify: `src/channel.ts` — add `createReplyRegistry`, refactor `handleRequest` signature to take `ChannelDeps`, wire reply tool + registry in main block, update `instructions`
- Modify: `src/channel.test.ts` — add registry tests, update handler tests for new signature, add timeout test
- Modify: `src/say.ts` — print response body
- Modify: `docs/superpowers/specs/2026-04-05-book-friend-channel-design.md` — add two-way addendum

---

## Task A: ReplyRegistry helper (TDD)

The registry owns the pending-request map. It exposes `register(id, signal, timeoutMs)` returning a Promise that resolves when `fulfill(id, text)` is called or rejects on timeout/abort/cancel.

**Files:**
- Modify: `src/channel.ts` (add helper alongside existing exports)
- Modify: `src/channel.test.ts` (add new `describe("createReplyRegistry", ...)` block)

- [ ] **Step 1: Write failing tests for the registry**

Add to the bottom of `src/channel.test.ts` (after the existing `describe("handleRequest", ...)` block):

```ts
import { createReplyRegistry } from "./channel.ts";

describe("createReplyRegistry", () => {
  test("register + fulfill resolves with the text", async () => {
    const reg = createReplyRegistry();
    const ctrl = new AbortController();
    const promise = reg.register("1", ctrl.signal, 5000);
    expect(reg.size()).toBe(1);
    expect(reg.fulfill("1", "hello back")).toBe(true);
    await expect(promise).resolves.toBe("hello back");
    expect(reg.size()).toBe(0);
  });

  test("fulfill with unknown id returns false", () => {
    const reg = createReplyRegistry();
    expect(reg.fulfill("nope", "anything")).toBe(false);
  });

  test("second fulfill on same id returns false", async () => {
    const reg = createReplyRegistry();
    const ctrl = new AbortController();
    const promise = reg.register("1", ctrl.signal, 5000);
    expect(reg.fulfill("1", "first")).toBe(true);
    expect(reg.fulfill("1", "second")).toBe(false);
    await expect(promise).resolves.toBe("first");
  });

  test("register with already-aborted signal rejects immediately", async () => {
    const reg = createReplyRegistry();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(reg.register("1", ctrl.signal, 5000)).rejects.toThrow(
      /aborted/,
    );
    expect(reg.size()).toBe(0);
  });

  test("aborting after register rejects and cleans up", async () => {
    const reg = createReplyRegistry();
    const ctrl = new AbortController();
    const promise = reg.register("1", ctrl.signal, 5000);
    expect(reg.size()).toBe(1);
    ctrl.abort();
    await expect(promise).rejects.toThrow(/aborted/);
    expect(reg.size()).toBe(0);
  });

  test("timeout rejects and cleans up", async () => {
    const reg = createReplyRegistry();
    const ctrl = new AbortController();
    const promise = reg.register("1", ctrl.signal, 20);
    await expect(promise).rejects.toThrow(/timeout/);
    expect(reg.size()).toBe(0);
  });

  test("cancel rejects and cleans up", async () => {
    const reg = createReplyRegistry();
    const ctrl = new AbortController();
    const promise = reg.register("1", ctrl.signal, 5000);
    reg.cancel("1", "notify failed");
    await expect(promise).rejects.toThrow(/notify failed/);
    expect(reg.size()).toBe(0);
  });

  test("cancel on unknown id is a no-op", () => {
    const reg = createReplyRegistry();
    expect(() => reg.cancel("nope", "any")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/channel.test.ts`
Expected: Many failures — `createReplyRegistry is not exported` (or similar). The existing 5 `handleRequest` tests should still pass.

- [ ] **Step 3: Implement `createReplyRegistry` in `src/channel.ts`**

Add these exports to `src/channel.ts`, between the existing `Notify` type and the existing `handleRequest` function:

```ts
export type Pending = {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
};

export type ReplyRegistry = {
  register: (
    request_id: string,
    signal: AbortSignal,
    timeoutMs: number,
  ) => Promise<string>;
  fulfill: (request_id: string, text: string) => boolean;
  cancel: (request_id: string, reason: string) => void;
  size: () => number;
};

export function createReplyRegistry(): ReplyRegistry {
  const pending = new Map<string, Pending>();

  return {
    register(request_id, signal, timeoutMs) {
      return new Promise<string>((resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("client aborted"));
          return;
        }

        const cleanup = () => {
          pending.delete(request_id);
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
        };

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(`timeout waiting for reply to ${request_id}`));
        }, timeoutMs);

        const onAbort = () => {
          cleanup();
          reject(new Error("client aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });

        pending.set(request_id, {
          resolve: (text) => {
            cleanup();
            resolve(text);
          },
          reject: (err) => {
            cleanup();
            reject(err);
          },
        });
      });
    },

    fulfill(request_id, text) {
      const entry = pending.get(request_id);
      if (!entry) return false;
      entry.resolve(text);
      return true;
    },

    cancel(request_id, reason) {
      const entry = pending.get(request_id);
      if (!entry) return;
      entry.reject(new Error(reason));
    },

    size() {
      return pending.size;
    },
  };
}
```

Note: `cleanup()` deletes from the map AND clears the timer AND removes the abort listener. Both `resolve` and `reject` paths run cleanup, so `cancel`-via-reject also cleans up. `cancel` on an unknown id is a no-op because `pending.get` returns undefined.

- [ ] **Step 4: Run tests to verify all pass**

Run: `bun test src/channel.test.ts`
Expected: PASS (5 existing handler tests + 8 new registry tests = 13 tests).

- [ ] **Step 5: Commit**

```bash
git add src/channel.ts src/channel.test.ts
git commit -m "Add ReplyRegistry helper for pending request lifecycle"
```

---

## Task B: Refactor `handleRequest` to use the registry

Change the handler signature from `(req, notify)` to `(req, deps)` where `deps` carries the notify callback, the registry, a request-id generator, and the reply timeout. Update the existing 5 tests for the new signature, add a happy-path test that exercises the full register-fulfill round trip, and add a timeout test.

**Files:**
- Modify: `src/channel.ts` (replace `handleRequest`)
- Modify: `src/channel.test.ts` (rewrite the `handleRequest` describe block)

- [ ] **Step 1: Add the new `ChannelDeps` type and rewrite `handleRequest`**

In `src/channel.ts`, replace the existing `handleRequest` function (and the `Notify` type alias above it, if you want — `Notify` becomes part of `ChannelDeps`) with:

```ts
export type ChannelDeps = {
  notify: (
    content: string,
    meta: { request_id: string },
  ) => Promise<void>;
  registry: ReplyRegistry;
  nextRequestId: () => string;
  replyTimeoutMs: number;
};

export async function handleRequest(
  req: Request,
  deps: ChannelDeps,
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname !== "/") {
    return new Response("not found", { status: 404 });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const body = await req.text();
  const request_id = deps.nextRequestId();

  // Register first so a fast Claude can't reply before we're listening.
  const replyPromise = deps.registry.register(
    request_id,
    req.signal,
    deps.replyTimeoutMs,
  );

  try {
    await deps.notify(body, { request_id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[book-friend channel] notify failed: ${message}`);
    deps.registry.cancel(request_id, "notify failed");
    // Swallow the rejection from the cancelled promise so it isn't unhandled.
    replyPromise.catch(() => {});
    return new Response(message, { status: 500 });
  }

  try {
    const reply = await replyPromise;
    return new Response(reply, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(message, { status: 504 });
  }
}
```

Also delete the standalone `Notify` type alias if it's still in the file — it's been absorbed into `ChannelDeps`. Search for `export type Notify` and remove that line.

- [ ] **Step 2: Rewrite the `handleRequest` describe block in `src/channel.test.ts`**

Replace the entire existing `describe("handleRequest", ...)` block with:

```ts
import { handleRequest, type ChannelDeps, createReplyRegistry } from "./channel.ts";

function makeDeps(overrides: Partial<ChannelDeps> = {}): ChannelDeps {
  let counter = 0;
  return {
    notify: mock(async (_content: string, _meta: { request_id: string }) => {}),
    registry: createReplyRegistry(),
    nextRequestId: () => String(++counter),
    replyTimeoutMs: 5000,
    ...overrides,
  };
}

describe("handleRequest", () => {
  test("POST / forwards to notify with request_id and returns Claude's reply", async () => {
    const deps = makeDeps();
    const req = new Request("http://localhost/", { method: "POST", body: "hello" });

    // Kick off the handler — it will block on registry.register until we fulfill.
    const handlerPromise = handleRequest(req, deps);

    // Give the handler a tick to call notify and register.
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.notify).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledWith("hello", { request_id: "1" });
    expect(deps.registry.size()).toBe(1);

    // Simulate Claude calling the reply tool.
    expect(deps.registry.fulfill("1", "hi from claude")).toBe(true);

    const res = await handlerPromise;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi from claude");
  });

  test("POST / with empty body still forwards", async () => {
    const deps = makeDeps();
    const req = new Request("http://localhost/", { method: "POST", body: "" });

    const handlerPromise = handleRequest(req, deps);
    await new Promise((r) => setTimeout(r, 10));
    expect(deps.notify).toHaveBeenCalledWith("", { request_id: "1" });
    deps.registry.fulfill("1", "ok");

    const res = await handlerPromise;
    expect(res.status).toBe(200);
  });

  test("GET / returns 405 and does not notify or register", async () => {
    const deps = makeDeps();
    const req = new Request("http://localhost/", { method: "GET" });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(405);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.registry.size()).toBe(0);
  });

  test("POST /other returns 404 and does not notify or register", async () => {
    const deps = makeDeps();
    const req = new Request("http://localhost/other", {
      method: "POST",
      body: "hi",
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(404);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.registry.size()).toBe(0);
  });

  test("notify throwing returns 500 and cancels the registry entry", async () => {
    const deps = makeDeps({
      notify: mock(async () => {
        throw new Error("boom");
      }),
    });
    const req = new Request("http://localhost/", { method: "POST", body: "hi" });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("boom");
    expect(deps.registry.size()).toBe(0);
  });

  test("reply timeout returns 504", async () => {
    const deps = makeDeps({ replyTimeoutMs: 20 });
    const req = new Request("http://localhost/", { method: "POST", body: "hi" });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(504);
    expect(await res.text()).toMatch(/timeout/);
    expect(deps.registry.size()).toBe(0);
  });
});
```

Note: the top of the file still has `import { test, expect, describe, mock } from "bun:test";` from before. The two import lines (`handleRequest`/`createReplyRegistry`) will now be duplicated — Task A added a separate `import { createReplyRegistry } from "./channel.ts";` line. Consolidate them by removing the standalone Task A import line; the new `handleRequest` import line above already imports `createReplyRegistry` too.

- [ ] **Step 3: Run tests to verify all pass**

Run: `bun test src/channel.test.ts`
Expected: PASS — 6 handler tests + 8 registry tests = 14 tests. The "reply timeout returns 504" test takes about 20ms because of the actual setTimeout; that's fine.

If you see TypeScript complaints about removed `Notify` references, search the file and remove any leftovers.

- [ ] **Step 4: Commit**

```bash
git add src/channel.ts src/channel.test.ts
git commit -m "Refactor handleRequest to await reply via registry"
```

---

## Task C: Wire reply tool and registry in the main block

Add the `tools` capability, register the `reply` MCP tool, instantiate the registry, and update the `instructions` string to tell Claude to always reply via the tool.

**Files:**
- Modify: `src/channel.ts` (the `if (import.meta.main)` block + add tools handler imports)

- [ ] **Step 1: Add the tools schema imports**

In `src/channel.ts`, alongside the existing MCP imports at the top of the file:

```ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { dirname, join } from "path";
```

(Add the `import { ListToolsRequestSchema, CallToolRequestSchema }` line — leave the others alone.)

- [ ] **Step 2: Replace the `if (import.meta.main)` block**

Replace the entire existing `if (import.meta.main) { ... }` block at the bottom of `src/channel.ts` with:

```ts
if (import.meta.main) {
  const projectRoot = join(dirname(import.meta.path), "..");
  const skillPath = join(projectRoot, ".claude/skills/book-friend/SKILL.md");
  const skill = await Bun.file(skillPath).text();

  const instructions =
    skill +
    "\n\n---\n\n" +
    'Events arriving as <channel source="book-friend" request_id="..."> are the user\'s book-friend messages, sent from a CLI that is waiting for your reply. ' +
    "Respond to each one by calling the `reply` tool with the `request_id` from the event tag and your full response text. " +
    "Do NOT address the user by writing to this terminal — they are not watching it; the CLI shows them only what you pass to `reply`. " +
    "Use other tools (Read, WebSearch, etc.) freely as needed; only the final user-facing response goes through `reply`.";

  const mcp = new Server(
    { name: "book-friend", version: "0.0.1" },
    {
      capabilities: {
        experimental: { "claude/channel": {} },
        tools: {},
      },
      instructions,
    },
  );

  const registry = createReplyRegistry();
  let nextId = 1;

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "reply",
        description:
          "Send your reply to the user back through the book-friend channel. Call this exactly once per channel event with the request_id from the <channel> tag and your full response text.",
        inputSchema: {
          type: "object",
          properties: {
            request_id: {
              type: "string",
              description:
                "The request_id attribute from the inbound <channel> tag",
            },
            text: {
              type: "string",
              description: "Your full reply to show the user",
            },
          },
          required: ["request_id", "text"],
        },
      },
    ],
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== "reply") {
      throw new Error(`unknown tool: ${req.params.name}`);
    }
    const { request_id, text } = req.params.arguments as {
      request_id: string;
      text: string;
    };
    const ok = registry.fulfill(request_id, text);
    if (!ok) {
      return {
        content: [
          {
            type: "text",
            text: `no pending request with id ${request_id} (already replied, timed out, or aborted)`,
          },
        ],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: "sent" }] };
  });

  await mcp.connect(new StdioServerTransport());

  const deps: ChannelDeps = {
    notify: async (content, meta) => {
      await mcp.notification({
        method: "notifications/claude/channel",
        params: { content, meta },
      });
    },
    registry,
    nextRequestId: () => String(nextId++),
    replyTimeoutMs: 5 * 60 * 1000, // 5 minutes
  };

  Bun.serve({
    port: 8789,
    hostname: "127.0.0.1",
    idleTimeout: 0, // don't close long-poll connections waiting for Claude
    fetch: (req) => handleRequest(req, deps),
  });
}
```

Three notable changes from the previous main block:
- `tools: {}` added to capabilities, plus the two `setRequestHandler` calls for tool list and tool invocation.
- `idleTimeout: 0` on `Bun.serve` — without this, Bun will close a connection that hasn't sent data for the default idle timeout (~10s), and the long-poll will fail before Claude can reply. The reply timeout in `replyTimeoutMs` (5min) is the real upper bound.
- `instructions` rewritten to direct Claude to always use the `reply` tool.

- [ ] **Step 3: Run tests to verify they still pass**

Run: `bun test src/channel.test.ts`
Expected: PASS (14 tests). The main block doesn't run during tests.

- [ ] **Step 4: Commit**

```bash
git add src/channel.ts
git commit -m "Wire reply tool and registry into channel main block"
```

---

## Task D: Update `say.ts` to print the reply

Tiny edit: read the response body and `console.log` it on success.

**Files:**
- Modify: `src/say.ts`

- [ ] **Step 1: Edit `src/say.ts`**

Replace the `try { ... } catch ...` block (everything from the `try {` line through the `} catch (err) {` line's `}`) with:

```ts
try {
  const res = await fetch("http://127.0.0.1:8789/", {
    method: "POST",
    body: message,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`say: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(text);
} catch (err) {
  const code =
    err && typeof err === "object" && "code" in err
      ? (err as { code: unknown }).code
      : undefined;
  if (code === "ConnectionRefused") {
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

The only functional change inside the `try` block is reading `res.text()` always (not just on error) and `console.log(text)` on success. The catch block is unchanged.

- [ ] **Step 2: Smoke-verify connection-refused branch still works**

Run: `bun src/say.ts "test"`
Expected: Same connection-refused hint as before, exit 1. (Channel still not running.)

- [ ] **Step 3: Commit**

```bash
git add src/say.ts
git commit -m "Print Claude's reply from say.ts on successful POST"
```

---

## Task E: End-to-end smoke test (manual)

The unit tests cover the registry and the handler in isolation; this step verifies the whole MCP wiring works against a real Claude Code session.

**Files:** (none — manual verification)

- [ ] **Step 1: Restart Claude Code with the channel**

If the existing one-way Claude Code session is still running, exit it (`/exit` or Ctrl+C). Then in the project root:

```bash
claude --dangerously-load-development-channels server:book-friend
```

Expected: Starts cleanly. `/mcp` shows `book-friend` as connected. Claude Code's tool list (run `/tools` or look at `/mcp` details) should now include the `reply` tool from the book-friend server.

- [ ] **Step 2: Send a message and watch the reply land in `say`**

In a second terminal:

```bash
bun run say "school of night, chapter 4"
```

Expected: `say` blocks for a few seconds while Claude processes the event, then prints Claude's response to stdout and exits 0. The Claude Code window may show tool calls (Read, WebSearch, the `reply` invocation), but the user-facing text should NOT appear there — it goes through `reply`.

If `say` hangs longer than ~15 seconds without printing anything, switch to the Claude Code window and check whether Claude is actually doing work (tool calls visible) or stuck. A common gotcha: Claude wrote the reply to its own terminal instead of calling `reply` because the instructions weren't loaded. Fix: confirm the channel restarted after the Task C edits and check `/mcp` for the updated capabilities.

- [ ] **Step 3: Send a follow-up to confirm context still persists**

```bash
bun run say "what did i just tell you my current chapter was?"
```

Expected: Claude's reply (printed by `say`) says "4" or similar, demonstrating that turn-to-turn context still works through the two-way path.

- [ ] **Step 4: Confirm the timeout doesn't trigger in normal usage**

Send a couple more `say` calls with longer questions (e.g. "tell me about marlowe at this point in the story"). Each should return within a minute or two — well under the 5-minute timeout.

- [ ] **Step 5: Confirm Ctrl+C cleanup works**

Run a `say` call and immediately Ctrl+C it. In the Claude Code window, you should see the original event arrive and Claude attempt to call `reply`, but the reply tool returns "no pending request with id N (already replied, timed out, or aborted)". Confirm that subsequent `say` calls still work (no leaked state, no port conflict).

- [ ] **Step 6: Commit only if any fixes were needed**

If everything in Steps 1–5 worked, no commit. If you fixed a typo or timing issue, commit it now.

---

## Task F: Spec addendum

Add a brief addendum to the original spec doc noting the upgrade and rationale.

**Files:**
- Modify: `docs/superpowers/specs/2026-04-05-book-friend-channel-design.md`

- [ ] **Step 1: Append the addendum**

Add the following to the bottom of `docs/superpowers/specs/2026-04-05-book-friend-channel-design.md`:

```markdown

---

## Addendum (2026-04-06): Upgraded to two-way

After running the one-way design end-to-end, the user wanted `say` to print Claude's reply directly instead of having to switch terminal windows. The channel was upgraded to two-way:

- A `reply` MCP tool is exposed by the channel server. Claude calls it with `{ request_id, text }`.
- Each inbound notification carries `meta.request_id` so Claude can pair its reply with the originating POST.
- A `ReplyRegistry` helper owns the pending-request map, the per-request timeout (5 minutes), and the abort-signal cleanup.
- `handleRequest` now blocks on `registry.register(...)` until the matching `reply` arrives, then returns the reply text as the HTTP response body.
- `say.ts` reads the response body and prints it.
- The `instructions` string was rewritten to tell Claude to always reply via the tool and never address the user in the terminal directly.

The original sender-gating, port number, and project-local scope all stand. The spoiler-wall behavior is unchanged because it lives in the skill rules (which are still in the system prompt), not in the transport.

Implementation plan: [`docs/superpowers/plans/2026-04-06-book-friend-channel-two-way.md`](../plans/2026-04-06-book-friend-channel-two-way.md)
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-04-05-book-friend-channel-design.md
git commit -m "Spec addendum: book-friend channel upgraded to two-way"
```
