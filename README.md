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

Two OCR modes:

- **Scribe** (default, recommended) — easy setup, great results for text-only books, free, slower (your computer will get hot!)
- **GCP Vision** — 27x faster, requires some advanced setup, not free

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

1. Install [Pulumi](https://www.pulumi.com/docs/install/) and [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)

2. Create a GCP project and authenticate:

```bash
gcloud projects create my-book-scanner --name="Book Scanner"
gcloud auth application-default login
```

3. Deploy the infrastructure (enables Vision API, creates service account):

```bash
cd infra
bun install
pulumi config set gcp:project my-book-scanner
pulumi up
cd ..
```

4. Save the service account key for OCR requests:

```bash
pulumi -C infra stack output serviceAccountKey --show-secrets | base64 -d > .gcloud/kindle-scanner-sa-key.json
```

### Usage

```bash
# Full pipeline — page count auto-detected
bun run scan --book B0XXXXXX --title "My Book"

# Use GCP Cloud Vision instead of local Scribe
bun run scan --book B0XXXXXX --title "My Book" --engine gcp

# Explicit page count
bun run scan --book B0XXXXXX --pages 300 --title "My Book"

# First run opens a browser for Amazon login (credentials are saved for next time)

# Run individual phases
bun run scan --book B0XXXXXX --capture-only
bun run scan --book B0XXXXXX --ocr-only
bun run scan --book B0XXXXXX --ocr-only --engine gcp
bun run scan --book B0XXXXXX --assemble-only --title "My Book"
```

### Performance

Per 100 pages (benchmarked on M-series Mac):

| Phase | Time |
|-------|------|
| **Capture** (screenshots) | ~160s |
| **OCR** — GCP Vision | ~8s |
| **OCR** — Scribe (local) | ~210s |
| **Assemble** | <1s |

GCP Vision is ~27x faster than Scribe with equivalent accuracy on Kindle screenshots. Scribe is free and fully offline.

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
