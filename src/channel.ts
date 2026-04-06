#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { dirname, join } from "path";

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
