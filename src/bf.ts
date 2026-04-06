#!/usr/bin/env bun

const message = process.argv.slice(2).join(" ");

if (!message) {
  console.error("Usage: bf <message>");
  process.exit(1);
}

try {
  const res = await fetch("http://127.0.0.1:8789/", {
    method: "POST",
    body: message,
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`bf: ${res.status} ${text}`);
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
