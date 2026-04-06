import { test, expect, describe, mock } from "bun:test";
import {
  handleRequest,
  type ChannelDeps,
  createReplyRegistry,
} from "./channel.ts";

function makeDeps(overrides: Partial<ChannelDeps> = {}): ChannelDeps {
  let counter = 0;
  return {
    notify: mock(
      async (_content: string, _meta: { request_id: string }) => {},
    ),
    registry: createReplyRegistry(),
    nextRequestId: () => String(++counter),
    replyTimeoutMs: 5000,
    ...overrides,
  };
}

describe("handleRequest", () => {
  test("POST / forwards to notify with request_id and returns Claude's reply", async () => {
    const deps = makeDeps();
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "hello",
    });

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
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "hi",
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("boom");
    expect(deps.registry.size()).toBe(0);
  });

  test("reply timeout returns 504", async () => {
    const deps = makeDeps({ replyTimeoutMs: 20 });
    const req = new Request("http://localhost/", {
      method: "POST",
      body: "hi",
    });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(504);
    expect(await res.text()).toMatch(/timeout/);
    expect(deps.registry.size()).toBe(0);
  });
});

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
