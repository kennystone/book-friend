---
name: environment-setup
description: Set up the development environment for book scanning. Installs Bun, dependencies, Playwright, and configures GCP auth. Use when the user wants to set up, install, or fix their environment.
---

# Environment Setup

Walk the user through getting everything installed and configured.

## 1. Bun

Run `bun --version`. If missing, tell the user to install from https://bun.sh.

## 2. Dependencies

Check if `node_modules` exists. If not, run `bun install`.

## 3. Playwright

Check if Chromium is installed by running `bunx playwright install --dry-run chromium`. If not installed, run `bunx playwright install chromium`.

## 4. GCP Vision (optional)

Only needed if the user wants to use the GCP OCR engine (faster but not free).

- Check if `.gcloud/application_default_credentials.json` exists
- If not, walk the user through GCP setup from `README.md` (create project, enable Vision API, auth)
- To authenticate: `CLOUDSDK_CONFIG=.gcloud gcloud auth application-default login`

### GCP Auth Details

Auth is directory-scoped. The `@google-cloud/vision` client library reads `GOOGLE_APPLICATION_CREDENTIALS`, not `CLOUDSDK_CONFIG`. The OCR module (`src/ocr-gcp.ts`) auto-sets this to `.gcloud/application_default_credentials.json` at startup.

If GCP OCR fails with auth errors (e.g. `invalid_rapt`), tell the user to refresh credentials:

```sh
CLOUDSDK_CONFIG=.gcloud gcloud auth application-default login
```
