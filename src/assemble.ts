import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

const CHAPTER_PATTERN =
  /^(chapter\s+\d+|chapter\s+[ivxlc]+|part\s+\d+|part\s+[ivxlc]+)\b/im;

const UPPER_HEADING_MAX_LEN = 60;

interface ChapterMap {
  [chapterName: string]: number; // page number (1-based)
}

export async function assemble(outputDir: string, bookTitle: string) {
  const ocrDir = join(outputDir, "ocr");

  const files = (await readdir(ocrDir))
    .filter((f) => f.endsWith(".txt"))
    .sort();

  if (files.length === 0) {
    console.error(`No OCR text files found in ${ocrDir}`);
    process.exit(1);
  }

  console.log(`Assembling ${files.length} pages into markdown`);

  // Read all page texts
  const pages: string[] = [];
  for (const file of files) {
    const text = await readFile(join(ocrDir, file), "utf-8");
    pages.push(text);
  }

  // Load manual chapter config if present
  const chaptersPath = join(outputDir, "chapters.json");
  let manualChapters: ChapterMap = {};
  if (existsSync(chaptersPath)) {
    const raw = await readFile(chaptersPath, "utf-8");
    manualChapters = JSON.parse(raw) as ChapterMap;
    console.log(
      `  Loaded ${Object.keys(manualChapters).length} manual chapter markers`,
    );
  }

  // Build chapter map: page number (1-based) → chapter name
  const chapterStarts = new Map<number, string>();

  // Manual chapters first (they take precedence)
  for (const [name, pageNum] of Object.entries(manualChapters)) {
    chapterStarts.set(pageNum, name);
  }

  // Heuristic chapter detection for pages without manual assignment
  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    if (chapterStarts.has(pageNum)) continue;

    const heading = detectChapterHeading(pages[i]!);
    if (heading) {
      chapterStarts.set(pageNum, heading);
    }
  }

  // Trim duplicate trailing pages (end-of-book / back matter)
  const trimmedPages = trimDuplicateTrailingPages(pages);
  console.log(`  Trimmed to ${trimmedPages.length} pages (removed ${pages.length - trimmedPages.length} duplicate trailing pages)`);

  // Clean pages and detect repeated headers/footers
  const cleanedPages = trimmedPages.map(cleanPage);
  removeRepeatedHeadersFooters(cleanedPages);

  // Assemble markdown
  const lines: string[] = [`# ${bookTitle}`, ""];

  for (let i = 0; i < cleanedPages.length; i++) {
    const pageNum = i + 1;
    const chapter = chapterStarts.get(pageNum);
    if (chapter) {
      lines.push(`## ${chapter}`, "");
    }
    lines.push(`<!-- page ${pageNum} -->`);
    lines.push(cleanedPages[i]!);
    lines.push("");
  }

  // Remove trailing empty pages
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
    lines.pop();
  }

  const markdown = lines.join("\n");
  const outputPath = join(outputDir, "book.md");
  await writeFile(outputPath, markdown);
  console.log(`  Wrote ${outputPath} (${markdown.length} chars)`);
}

function detectChapterHeading(text: string): string | null {
  const firstLines = text.split("\n").slice(0, 5);

  for (const line of firstLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match "Chapter X" or "Part X" patterns
    const match = trimmed.match(CHAPTER_PATTERN);
    if (match) return trimmed;

    // Short all-caps lines likely a heading
    if (
      trimmed.length <= UPPER_HEADING_MAX_LEN &&
      trimmed === trimmed.toUpperCase() &&
      /[A-Z]/.test(trimmed)
    ) {
      return trimmed;
    }
  }

  return null;
}

function cleanPage(text: string): string {
  let cleaned = text;

  // Join hyphenated line breaks
  cleaned = cleaned.replace(/(\w)-\n(\w)/g, "$1$2");

  // Collapse 3+ consecutive blank lines to 2
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

function trimDuplicateTrailingPages(pages: string[]): string[] {
  if (pages.length < 3) return pages;

  // Find where consecutive duplicate pages start from the end
  const lastPage = pages[pages.length - 1]!.trim();
  let cutoff = pages.length;
  for (let i = pages.length - 2; i >= 0; i--) {
    if (pages[i]!.trim() === lastPage) {
      cutoff = i;
    } else {
      break;
    }
  }

  // Only trim if we found at least 3 consecutive duplicates
  if (pages.length - cutoff >= 3) {
    return pages.slice(0, cutoff);
  }
  return pages;
}

function removeRepeatedHeadersFooters(pages: string[]) {
  if (pages.length < 5) return;

  // Check first line of each page for repeated header
  const firstLines = pages.map((p) => p.split("\n")[0]?.trim() ?? "");
  removeRepeatedLine(pages, firstLines, "first");

  // Check last line of each page for repeated footer
  const lastLines = pages.map((p) => {
    const lines = p.split("\n");
    return lines[lines.length - 1]?.trim() ?? "";
  });
  removeRepeatedLine(pages, lastLines, "last");
}

function removeRepeatedLine(
  pages: string[],
  lines: string[],
  position: "first" | "last",
) {
  // Count consecutive occurrences of each line
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line) counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  for (const [line, count] of counts) {
    if (count >= 5) {
      for (let i = 0; i < pages.length; i++) {
        const pageLines = pages[i]!.split("\n");
        if (position === "first" && pageLines[0]?.trim() === line) {
          pageLines.shift();
          pages[i] = pageLines.join("\n").trim();
        } else if (
          position === "last" &&
          pageLines[pageLines.length - 1]?.trim() === line
        ) {
          pageLines.pop();
          pages[i] = pageLines.join("\n").trim();
        }
      }
    }
  }
}
