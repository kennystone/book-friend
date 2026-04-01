# book-friend

Talk about the book you're reading with an AI that won't spoil it.

book-friend is a Claude Code project that gives you a reading companion. Tell it what book you're on and where you are — it discusses characters, themes, and context without ever revealing what happens next. It cites everything: direct quotes from the text or web sources with URLs. No hallucination, no guessing.

Between conversations, it keeps notes on characters, events, and your open questions so you can pick up where you left off.

## How it works

1. Scan your Kindle book into markdown (screenshots + OCR)
2. Open Claude Code in this project and start talking about what you've read
3. The `/book-club` skill activates — it reads only up to your stated position and searches the web for literary context

## Scanning a Book

Screenshots pages from Kindle's web reader, OCRs them, and assembles structured markdown.

Two OCR engines are available:

- **Scribe.js** (default) — runs locally, no cloud setup needed
- **GCP Cloud Vision** — requires GCP project with Pulumi

### Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai/claude-code)
- For GCP engine only: [Pulumi](https://www.pulumi.com/docs/install/) and [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)

### Install

```bash
bun install
bunx playwright install chromium
```

### GCP Setup (only if using `--engine gcp`)

```bash
cd infra && pulumi up
```

### Usage

```bash
# Full pipeline with local OCR (default)
bun run src/index.ts --book B0XXXXXX --pages 300 --title "My Book"

# Use GCP Cloud Vision instead
bun run src/index.ts --book B0XXXXXX --pages 300 --title "My Book" --engine gcp

# First run opens a browser for Amazon login (credentials are saved for next time)

# Run individual phases
bun run src/index.ts --book B0XXXXXX --capture-only --pages 300
bun run src/index.ts --book B0XXXXXX --ocr-only
bun run src/index.ts --book B0XXXXXX --ocr-only --engine gcp
bun run src/index.ts --book B0XXXXXX --assemble-only --title "My Book"
```

### Output

```
output/<asin>/
  screenshots/    # PNG screenshots of each page
  ocr/            # Extracted text per page (.txt)
  book.md         # Final assembled markdown
  chapters.json   # (optional) Manual chapter overrides
```

Create `output/<asin>/chapters.json` to manually specify chapter boundaries:

```json
{
  "Chapter 1: Introduction": 1,
  "Chapter 2: Getting Started": 25
}
```

## Discussing a Book

Open Claude Code in this project, say what you're reading and where you are. The book-club skill activates automatically (or invoke it with `/book-club`).

- **No spoilers** — nothing beyond your stated position, no hints, no "keep reading"
- **No hallucination** — every claim cites the book text or a web source with URL
- **No assumptions** — if it can't verify something, it says so
- **Memory** — tracks characters, events, and themes between conversations
