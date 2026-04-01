---
name: import-book
description: Scan a Kindle book into markdown. Handles capture, OCR, chapter detection, and assembly. Use when the user wants to scan, import, or add a new book.
---

# Import Book

## Quick Environment Check

Before scanning, verify the basics are in place:

1. Run `bun --version` — if missing, tell the user to run `/environment-setup`
2. Check `node_modules` exists — if not, run `bun install`
3. Check Playwright Chromium is installed — if not, run `bunx playwright install chromium`
4. If user picks GCP engine, check `.gcloud/application_default_credentials.json` exists — if not, tell them to run `/environment-setup`

Don't walk through full setup here — just verify and redirect to the environment-setup skill if something is missing.

## Gather Info

Ask the user for:

1. **Book title** — the user just needs to tell you what book they want to scan
2. **OCR engine** — present the two options:
   - **Scribe** (default) — free, local, no setup, slower (~210s per 100 pages, your machine will get hot)
   - **GCP Vision** — 27x faster (~8s per 100 pages), requires GCP setup, not free

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

After assembly is complete, copy the final markdown to the `books/` directory so the book-friend skill can reference it:

```sh
mkdir -p books
cp output/<asin>/book.md books/<slugified-title>.md
```

Use a slugified version of the title (e.g. "The Great Gatsby" -> `the-great-gatsby.md`).
