#!/usr/bin/env bun
import { capture, detectPageCount } from "./capture.ts";
import { ocr, type OcrEngine } from "./ocr.ts";
import { assemble } from "./assemble.ts";
import { join } from "path";
import { readdir } from "fs/promises";
import * as clack from "@clack/prompts";

function printUsage() {
  console.log(`
book-friend — Screenshot Kindle web reader pages, OCR them, and assemble markdown.

Usage:
  bun run scan --book <asin> --pages <count> [options]

Required:
  --book <asin>         Book ASIN or Kindle web reader URL
  --pages <count>       Number of pages to capture (auto-detected if omitted)

Options:
  --title <title>       Book title for the markdown heading (default: ASIN)
  --output-dir <dir>    Output directory (default: output/<asin>)
  --engine <engine>     OCR engine: scribe (default, local) or gcp (Cloud Vision)
  --concurrency <N>     Number of parallel OCR workers (default: auto-detected)
  --capture-only        Only run the capture phase
  --ocr-only            Only run the OCR phase
  --assemble-only       Only run the assemble phase
  --agent               Machine-readable output with timestamps and phase durations
  --debug               Verbose logging with timestamps (interactive mode)
  --help                Show this help message
`);
}

export function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help") {
      args.help = true;
    } else if (arg === "--capture-only") {
      args.captureOnly = true;
    } else if (arg === "--ocr-only") {
      args.ocrOnly = true;
    } else if (arg === "--assemble-only") {
      args.assembleOnly = true;
    } else if (arg === "--agent") {
      args.agent = true;
    } else if (arg === "--debug") {
      args.debug = true;
    } else if (arg.startsWith("--") && i + 1 < argv.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i]!;
    }
  }
  return args;
}

export function createDebugLogger(enabled: boolean) {
  const t0 = performance.now();
  return {
    log: (...args: unknown[]) => {
      if (!enabled) return;
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[${elapsed}s]`, ...args);
    },
    time: (label: string) => {
      const start = performance.now();
      return {
        end: () => {
          if (!enabled) return;
          const dur = ((performance.now() - start) / 1000).toFixed(1);
          const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
          console.log(`[${elapsed}s] ${label} completed in ${dur}s`);
        },
      };
    },
  };
}

export function extractAsin(bookArg: string): string {
  const urlMatch = bookArg.match(/asin=([A-Z0-9]+)/i);
  if (urlMatch) return urlMatch[1]!;
  if (/^[A-Z0-9]+$/i.test(bookArg)) return bookArg;
  return bookArg;
}

async function runInteractive(
  asin: string,
  pages: number | undefined,
  title: string,
  outputDir: string,
  engine: OcrEngine,
  concurrency: number | undefined,
  runCapture: boolean,
  runOcr: boolean,
  runAssemble: boolean,
  debug: boolean,
) {
  const dbg = createDebugLogger(debug);
  clack.intro("book-friend");

  if (runCapture) {
    let capturePages = pages;
    let existingSession: Parameters<typeof capture>[4];

    if (!capturePages) {
      const s = clack.spinner();
      s.start("Detecting page count...");
      const t = dbg.time("detect");
      try {
        const detected = await detectPageCount(asin);
        capturePages = detected.pages;
        existingSession = { context: detected.context, page: detected.page };
        t.end();
        s.stop(`Detected ${capturePages} pages`);
      } catch (e) {
        t.end();
        s.stop("Could not detect page count");
        const input = await clack.text({
          message: `Could not auto-detect page count. How many pages to capture?`,
          validate: (v) => {
            const n = parseInt(v, 10);
            if (isNaN(n) || n <= 0) return "Enter a positive number";
          },
        });
        if (clack.isCancel(input)) {
          clack.cancel("Cancelled");
          process.exit(0);
        }
        capturePages = parseInt(input as string, 10);
      }
    }

    const capTimer = dbg.time("capture");
    const bar = clack.progress({ max: capturePages, style: "heavy" });
    bar.start(`Capturing ${capturePages} pages (${asin})`);
    await capture(asin, capturePages, outputDir, (current, total) => {
      bar.advance(1, `Screenshotting page ${current}/${total}`);
      if (current % 10 === 0) dbg.log(`capture page=${current}/${total}`);
    }, existingSession);
    bar.stop("Capture complete");
    capTimer.end();
  }

  if (runOcr) {
    const ocrTimer = dbg.time("ocr");
    const screenshotDir = join(outputDir, "screenshots");
    const files = (await readdir(screenshotDir)).filter((f) =>
      f.endsWith(".png"),
    );
    const bar = clack.progress({ max: files.length, style: "heavy" });
    bar.start(`OCR-ing ${files.length} pages (${engine})`);
    await ocr(outputDir, engine, concurrency, (current, total) => {
      bar.advance(1, `OCR page ${current}/${total}`);
      if (current % 10 === 0) dbg.log(`ocr page=${current}/${total}`);
    });
    bar.stop("OCR complete");
    ocrTimer.end();
  }

  if (runAssemble) {
    const asmTimer = dbg.time("assemble");
    const s = clack.spinner();
    s.start("Assembling markdown...");
    await assemble(outputDir, title);
    s.stop("Assembled book.md");
    asmTimer.end();
  }

  clack.outro(`Done! Output in ${outputDir}`);
}

async function runAgent(
  asin: string,
  pages: number | undefined,
  title: string,
  outputDir: string,
  engine: OcrEngine,
  concurrency: number | undefined,
  runCapture: boolean,
  runOcr: boolean,
  runAssemble: boolean,
  debug: boolean,
) {
  const dbg = createDebugLogger(debug);

  if (runCapture) {
    let capturePages = pages;
    let existingSession: Parameters<typeof capture>[4];

    if (!capturePages) {
      console.log("detect:start");
      const t = dbg.time("detect");
      try {
        const detected = await detectPageCount(asin);
        capturePages = detected.pages;
        existingSession = { context: detected.context, page: detected.page };
        t.end();
        console.log(`detect:complete pages=${capturePages}`);
      } catch (e) {
        t.end();
        console.error(`error could not detect page count: ${(e as Error).message}. Pass --pages manually.`);
        process.exit(1);
      }
    }

    const capTimer = dbg.time("capture");
    console.log(`capture:start pages=${capturePages} asin=${asin}`);
    await capture(asin, capturePages, outputDir, (current, total) => {
      console.log(`capture:progress page=${current}/${total}`);
    }, existingSession);
    console.log("capture:complete");
    capTimer.end();
  }

  if (runOcr) {
    const ocrTimer = dbg.time("ocr");
    const screenshotDir = join(outputDir, "screenshots");
    const files = (await readdir(screenshotDir)).filter((f) =>
      f.endsWith(".png"),
    );
    console.log(`ocr:start pages=${files.length} engine=${engine}`);
    await ocr(outputDir, engine, concurrency, (current, total) => {
      console.log(`ocr:progress page=${current}/${total}`);
    });
    console.log("ocr:complete");
    ocrTimer.end();
  }

  if (runAssemble) {
    const asmTimer = dbg.time("assemble");
    console.log("assemble:start");
    await assemble(outputDir, title);
    console.log(`assemble:complete path=${join(outputDir, "book.md")}`);
    asmTimer.end();
  }

  console.log("done");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const bookArg = args.book as string | undefined;
  const pagesArg = args.pages as string | undefined;
  const agentMode = !!args.agent;

  if (!bookArg) {
    console.error("Error: --book is required");
    printUsage();
    process.exit(1);
  }

  const asin = extractAsin(bookArg);
  const pages = pagesArg ? parseInt(pagesArg, 10) : undefined;
  const title = (args.title as string) || asin;
  const outputDir = (args.outputDir as string) || join("output", asin);
  const engine = (args.engine as OcrEngine) || "scribe";
  const concurrency = args.concurrency
    ? parseInt(args.concurrency as string, 10)
    : undefined;

  const runCapture = !args.ocrOnly && !args.assembleOnly;
  const runOcr = !args.captureOnly && !args.assembleOnly;
  const runAssemble = !args.captureOnly && !args.ocrOnly;

  if (agentMode) {
    await runAgent(
      asin, pages, title, outputDir, engine, concurrency,
      runCapture, runOcr, runAssemble, true,
    );
  } else {
    await runInteractive(
      asin, pages, title, outputDir, engine, concurrency,
      runCapture, runOcr, runAssemble, !!args.debug,
    );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
