# kindle-scanner

Screenshot Kindle web reader pages, OCR them with GCP Cloud Vision, and assemble structured markdown.

## Prerequisites

- [Bun](https://bun.sh) runtime
- Google Cloud Platform account with Cloud Vision API enabled

## Install

```bash
bun install
bunx playwright install chromium
```

## GCP Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or select an existing one)
3. Enable the **Cloud Vision API**: APIs & Services > Enable APIs > search "Cloud Vision API" > Enable
4. Create a service account: IAM & Admin > Service Accounts > Create
5. Grant the **Cloud Vision API User** role
6. Create a JSON key: Actions > Manage Keys > Add Key > JSON
7. Set the env var:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/key.json
   ```
   Or copy `.env.example` to `.env` and fill in the path.

## Usage

```bash
# Full pipeline: capture, OCR, and assemble
bun run src/index.ts --book B0XXXXXX --pages 300 --title "My Book"

# First run opens a browser for Amazon login (credentials are saved for next time)

# Run individual phases
bun run src/index.ts --book B0XXXXXX --capture-only --pages 300
bun run src/index.ts --book B0XXXXXX --ocr-only
bun run src/index.ts --book B0XXXXXX --assemble-only --title "My Book"
```

## Output

```
output/<asin>/
  screenshots/    # PNG screenshots of each page
  ocr/            # Extracted text per page (.txt)
  book.md         # Final assembled markdown
  chapters.json   # (optional) Manual chapter overrides
```

### Manual Chapter Overrides

Create `output/<asin>/chapters.json` to specify chapter boundaries:

```json
{
  "Chapter 1: Introduction": 1,
  "Chapter 2: Getting Started": 25
}
```
