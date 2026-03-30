# Kindle Scanner — Design Spec

## Context

We want to extract the full text of Kindle books into structured markdown. Kindle doesn't offer text export, so we'll automate the web reader (read.amazon.com) with Playwright to screenshot each page, OCR the screenshots with GCP Cloud Vision API, and assemble the results into markdown organized by chapters and pages.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Browser automation:** Playwright
- **OCR:** Google Cloud Vision API (`@google-cloud/vision`)
- **No Python, no macOS GUI scripting**

## Architecture: Sequential Pipeline

Three phases run in order. Each phase produces intermediate files for debugging and re-running.

```
[Capture] → screenshots/page_NNN.png
[OCR]     → ocr/page_NNN.json + ocr/page_NNN.txt
[Assemble] → book.md
```

All output goes to `output/<book-name>/`.

## Phase 1: Capture

1. Launch Chromium via Playwright, navigate to `read.amazon.com`
2. **Auth:** On first run, the browser opens in headed mode for the user to log in manually. Playwright persists the browser context (cookies/storage) to a local `auth/` directory so subsequent runs skip login.
3. **Book selection:** User provides the book URL or ASIN as a CLI argument.
4. **Page loop** (user specifies page count via `--pages N`):
   - Screenshot the reading area with `page.screenshot()`
   - Save to `output/<book>/screenshots/page_001.png` (zero-padded)
   - Press right arrow key to advance
   - Wait for DOM to stabilize (Playwright `waitForLoadState('networkidle')` or a short fixed delay like 1s)
5. **Crop consideration:** If the Kindle web reader has chrome (headers, sidebars), we may need to screenshot only the content element rather than the full page. This will be determined during implementation by inspecting the DOM.

### CLI Usage

```bash
bun run scan --book <asin-or-url> --pages 300
```

First run opens a browser for login. Subsequent runs reuse saved auth.

## Phase 2: OCR

1. Iterate over `output/<book>/screenshots/` in filename order
2. For each image, call Cloud Vision `documentTextDetection`
3. Save full API response as `output/<book>/ocr/page_001.json`
4. Extract `fullTextAnnotation.text` and save as `output/<book>/ocr/page_001.txt`
5. Simple retry with backoff on transient API errors
6. Progress logging: "OCR page 42/300"

### Authentication

Uses Application Default Credentials:
- Set `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to a service account JSON key, OR
- Run `gcloud auth application-default login`

## Phase 3: Assemble

1. Read all `ocr/page_NNN.txt` files in order
2. **Chapter detection** (two methods, both active):
   - **OCR heuristic:** Regex patterns for chapter headings — `Chapter \d+`, `CHAPTER`, short all-caps lines followed by blank lines
   - **Manual override:** Optional `chapters.json` in the book's output directory: `{"Chapter 1": 1, "Chapter 2": 25}` (chapter name → starting page number). Manual entries take precedence over heuristic detection.
3. **Generate `book.md`:**
   ```markdown
   # Book Title

   ## Chapter 1

   <!-- page 1 -->
   Text from page 1...

   <!-- page 2 -->
   Text from page 2...

   ## Chapter 2

   <!-- page 25 -->
   Text from page 25...
   ```
4. **Text cleanup:**
   - Join words split by hyphenation across lines (`word-\n` → `word`)
   - Normalize whitespace (collapse multiple blank lines)
   - Remove repeated headers/footers (detect strings that appear identically on many consecutive pages)

## Project Structure

```
kindle-scanner/
  src/
    index.ts          # CLI entry point, arg parsing
    capture.ts        # Playwright capture phase
    ocr.ts            # Cloud Vision OCR phase
    assemble.ts       # Markdown assembly phase
  auth/               # Playwright browser context (gitignored)
  output/             # Scan results (gitignored)
    <book-name>/
      screenshots/
      ocr/
      chapters.json   # Optional manual chapter map
      book.md         # Final output
  package.json
  tsconfig.json
  .env.example        # GOOGLE_APPLICATION_CREDENTIALS path
  .gitignore
```

## Dependencies

- `playwright` — browser automation
- `@google-cloud/vision` — OCR API client
- No other runtime dependencies anticipated

## GCP Setup (for reference)

1. Create a GCP project (or use existing)
2. Enable the Cloud Vision API
3. Create a service account with Vision API permissions
4. Download the JSON key
5. Set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`

## Verification Plan

1. **Capture:** Run `bun run scan --book <test-book> --pages 5`, verify 5 PNGs appear in `output/` and contain readable page content
2. **OCR:** Verify `.json` and `.txt` files are generated, text matches visible page content
3. **Assemble:** Verify `book.md` has correct structure, chapter breaks, and page markers
4. **End-to-end:** Scan a short book (or a few chapters) and manually compare markdown output against the original
