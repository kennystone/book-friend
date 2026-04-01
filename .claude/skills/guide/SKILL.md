---
name: guide
description: Scan a Kindle book into markdown. Guides the user through setup, capture, OCR, and assembly. Use when the user wants to scan, import, or add a new book.
---

# Scan a Book

## Check Environment

Before scanning, verify the environment is ready:

1. **Bun** — run `bun --version`. If missing, tell the user to install from https://bun.sh
2. **Dependencies** — check if `node_modules` exists. If not, run `bun install`
3. **Playwright** — check if Chromium is installed by running `bunx playwright install --dry-run chromium`. If not installed, run `bunx playwright install chromium`
4. **GCP (only if user picks GCP engine)**:
   - Check if `.gcloud/application_default_credentials.json` exists
   - If not, walk the user through GCP setup from `README.md` (create project, auth, deploy infra with Pulumi)
   - If it exists but OCR fails with auth errors, tell them to re-auth: `CLOUDSDK_CONFIG=.gcloud gcloud auth application-default login`

## Gather Info

Ask the user for:

1. **Book title** — the user just needs to tell you what book they want to scan
2. **OCR engine** — present the two options:
   - **Scribe** (default) — free, local, no setup, slower (~210s per 100 pages, your machine will get hot)
   - **GCP Vision** — 27x faster (~8s per 100 pages), requires GCP setup (see `README.md`), not free

### Find the ASIN

Once you have the title, look up the Kindle ASIN automatically:

1. Search the web for `<title> <author if known> Kindle ASIN site:amazon.com`
2. Extract the ASIN (starts with `B0`) from the Amazon product URL or page
3. Confirm the ASIN and title with the user before proceeding

If the user already provides an ASIN or Kindle URL, skip the lookup.

Page count is auto-detected from the Kindle reader. Only ask for `--pages` if auto-detection fails.

## Run the Scan

Run the full pipeline with `--agent` mode so you get structured, timestamped output:

```sh
bun run scan --book <asin-or-url> --title "<title>" --engine <scribe|gcp> --agent
```

The scan has three phases:
1. **Capture** — screenshots each page from the Kindle web reader (~160s per 100 pages)
2. **OCR** — extracts text from screenshots
3. **Assemble** — combines OCR text into `output/<asin>/book.md`

If the scan fails partway through, you can resume individual phases:
```sh
bun run scan --book <asin> --ocr-only --agent
bun run scan --book <asin> --assemble-only --title "<title>" --agent
```

## After the Scan

Once `book.md` is assembled, offer the user two options:

### Option A: Auto-detect chapters (recommended)

Read `output/<asin>/book.md` and analyze the text to identify chapter boundaries. The assembler already does basic detection (lines matching "Chapter X" or short all-caps headings), but it often misses or misidentifies chapters.

To improve chapters:

1. Read through the assembled `book.md`, focusing on `<!-- page N -->` markers and the text that follows them
2. Identify chapter/part/section breaks — look for:
   - "Chapter" / "Part" headings the heuristic missed
   - Numbered sections
   - Large whitespace gaps or scene breaks
   - Title pages for new sections
3. Write a `chapters.json` file to `output/<asin>/chapters.json`:
   ```json
   {
     "Part One": 1,
     "Chapter 1: The Beginning": 5,
     "Chapter 2: Arrival": 28
   }
   ```
   Keys are chapter names, values are page numbers (1-based, matching `<!-- page N -->` markers).
4. Re-run the assemble phase to apply:
   ```sh
   bun run scan --book <asin> --assemble-only --title "<title>" --agent
   ```

### Option B: Manual chapters

Tell the user they can create `output/<asin>/chapters.json` themselves and re-run assemble.

## Copy to Books Directory

After assembly is complete, copy the final markdown to the `books/` directory so the book-club skill can reference it:

```sh
mkdir -p books
cp output/<asin>/book.md books/<slugified-title>.md
```

Use a slugified version of the title (e.g. "The Great Gatsby" -> `the-great-gatsby.md`).

## GCP Auth Notes

GCP auth is directory-scoped. The `@google-cloud/vision` client library reads `GOOGLE_APPLICATION_CREDENTIALS`, not `CLOUDSDK_CONFIG`. The OCR module (`src/ocr-gcp.ts`) auto-sets this to `.gcloud/application_default_credentials.json` at startup.

If GCP OCR fails with auth errors (e.g. `invalid_rapt`), tell the user to refresh credentials:

```sh
CLOUDSDK_CONFIG=.gcloud gcloud auth application-default login
```
