## Skills

### environment-setup

Set up the development environment. Located at `.claude/skills/environment-setup/SKILL.md`.

- Installs Bun, dependencies, Playwright Chromium, and configures GCP auth
- Use when first setting up or when something is broken

### import-book

Scan a Kindle book into markdown. Located at `.claude/skills/import-book/SKILL.md`.

- Quick environment check (redirects to environment-setup if something is missing)
- Asks for book title, auto-looks up the Kindle ASIN
- Runs capture, OCR, and assembly via the CLI
- Auto-detects chapters and copies final markdown to `books/`

### book-friend

Spoiler-safe book discussion. Located at `.claude/skills/book-friend/SKILL.md`.

- Lists available books from `books/` directory
- User names a book and their current position; Claude confirms before discussing
- **Hard spoiler wall**: never reveal anything beyond the user's stated position
- **No hallucination**: every claim must cite book text (from `books/`) or a web search result with URL
- Maintains reading notes in `memory/book_<slugified-name>.md`
- Resumes from prior notes on subsequent conversations

---

See `README.md` for installation, CLI usage, GCP setup, and performance benchmarks.

## GCP Auth

Auth is directory-scoped via `CLOUDSDK_CONFIG=.gcloud`. Never use global gcloud auth.
- Application default credentials: `.gcloud/application_default_credentials.json`
- Service account key: `.gcloud/kindle-scanner-sa-key.json`
- Pulumi backend: local (`file://~/.pulumi-local`), stack: `dev`
- To re-authenticate: `CLOUDSDK_CONFIG=.gcloud gcloud auth application-default login`

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
