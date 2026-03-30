import { capture } from "./capture.ts";
import { ocr } from "./ocr.ts";
import { assemble } from "./assemble.ts";
import { join } from "path";

function printUsage() {
  console.log(`
kindle-scanner — Screenshot Kindle web reader pages, OCR them, and assemble markdown.

Usage:
  bun run src/index.ts --book <asin> --pages <count> [options]

Required:
  --book <asin>         Book ASIN or Kindle web reader URL
  --pages <count>       Number of pages to capture

Options:
  --title <title>       Book title for the markdown heading (default: ASIN)
  --output-dir <dir>    Output directory (default: output/<asin>)
  --capture-only        Only run the capture phase
  --ocr-only            Only run the OCR phase
  --assemble-only       Only run the assemble phase
  --help                Show this help message
`);
}

function parseArgs(argv: string[]) {
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
    } else if (arg.startsWith("--") && i + 1 < argv.length) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++i]!;
    }
  }
  return args;
}

function extractAsin(bookArg: string): string {
  const urlMatch = bookArg.match(/asin=([A-Z0-9]+)/i);
  if (urlMatch) return urlMatch[1]!;
  if (/^[A-Z0-9]+$/i.test(bookArg)) return bookArg;
  return bookArg;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const bookArg = args.book as string | undefined;
  const pagesArg = args.pages as string | undefined;

  if (!bookArg) {
    console.error("Error: --book is required");
    printUsage();
    process.exit(1);
  }

  const asin = extractAsin(bookArg);
  const pages = pagesArg ? parseInt(pagesArg, 10) : undefined;
  const title = (args.title as string) || asin;
  const outputDir = (args.outputDir as string) || join("output", asin);

  const runCapture = !args.ocrOnly && !args.assembleOnly;
  const runOcr = !args.captureOnly && !args.assembleOnly;
  const runAssemble = !args.captureOnly && !args.ocrOnly;

  if (runCapture) {
    if (!pages) {
      console.error("Error: --pages is required for capture phase");
      process.exit(1);
    }
    console.log(`\n=== Capture Phase ===`);
    console.log(`Book: ${asin}, Pages: ${pages}, Output: ${outputDir}`);
    await capture(asin, pages, outputDir);
  }

  if (runOcr) {
    console.log(`\n=== OCR Phase ===`);
    await ocr(outputDir);
  }

  if (runAssemble) {
    console.log(`\n=== Assemble Phase ===`);
    await assemble(outputDir, title);
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
