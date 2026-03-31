import { test, expect, describe } from "bun:test";
import {
  detectChapterHeading,
  cleanPage,
  trimDuplicateTrailingPages,
  removeRepeatedHeadersFooters,
} from "./assemble.ts";

describe("detectChapterHeading", () => {
  test("detects 'Chapter N' pattern", () => {
    expect(detectChapterHeading("Chapter 1\nSome text here")).toBe("Chapter 1");
  });

  test("detects 'Chapter' with roman numerals", () => {
    expect(detectChapterHeading("Chapter IV\nBody text")).toBe("Chapter IV");
  });

  test("detects 'Part N' pattern", () => {
    expect(detectChapterHeading("Part 2\nIntroduction")).toBe("Part 2");
  });

  test("detects 'Part' with roman numerals", () => {
    expect(detectChapterHeading("Part III\nThe Return")).toBe("Part III");
  });

  test("case insensitive matching", () => {
    expect(detectChapterHeading("CHAPTER 5\nText")).toBe("CHAPTER 5");
    expect(detectChapterHeading("chapter 5\nText")).toBe("chapter 5");
  });

  test("detects short all-caps headings", () => {
    expect(detectChapterHeading("THE BEGINNING\nOnce upon a time")).toBe(
      "THE BEGINNING",
    );
  });

  test("ignores all-caps lines longer than 60 chars", () => {
    const longCaps = "A".repeat(61);
    expect(detectChapterHeading(`${longCaps}\nSome text`)).toBeNull();
  });

  test("skips blank lines before detecting heading", () => {
    expect(detectChapterHeading("\n\nChapter 3\nBody")).toBe("Chapter 3");
  });

  test("only checks first 5 lines", () => {
    const text = "line1\nline2\nline3\nline4\nline5\nChapter 6\nBody";
    expect(detectChapterHeading(text)).toBeNull();
  });

  test("returns null for normal body text", () => {
    expect(
      detectChapterHeading("The sun was setting over the hills.\nBirds sang."),
    ).toBeNull();
  });

  test("all-caps must contain at least one letter", () => {
    expect(detectChapterHeading("123\nBody text")).toBeNull();
  });
});

describe("cleanPage", () => {
  test("joins hyphenated line breaks", () => {
    expect(cleanPage("hyph-\nenated")).toBe("hyphenated");
  });

  test("preserves non-hyphenated line breaks", () => {
    expect(cleanPage("line one\nline two")).toBe("line one\nline two");
  });

  test("collapses 3+ blank lines to 2", () => {
    expect(cleanPage("a\n\n\n\nb")).toBe("a\n\nb");
  });

  test("leaves 2 blank lines as-is", () => {
    expect(cleanPage("a\n\nb")).toBe("a\n\nb");
  });

  test("trims leading and trailing whitespace", () => {
    expect(cleanPage("  hello  \n  world  \n")).toBe("hello  \n  world");
  });

  test("handles multiple hyphenated breaks", () => {
    expect(cleanPage("con-\ntinue read-\ning")).toBe("continue reading");
  });
});

describe("trimDuplicateTrailingPages", () => {
  test("removes 3+ consecutive duplicate trailing pages", () => {
    const pages = ["a", "b", "c", "dup", "dup", "dup", "dup"];
    expect(trimDuplicateTrailingPages(pages)).toEqual(["a", "b", "c"]);
  });

  test("keeps pages when fewer than 3 duplicates at end", () => {
    const pages = ["a", "b", "c", "dup", "dup"];
    expect(trimDuplicateTrailingPages(pages)).toEqual([
      "a",
      "b",
      "c",
      "dup",
      "dup",
    ]);
  });

  test("returns input for fewer than 3 pages", () => {
    expect(trimDuplicateTrailingPages(["a", "b"])).toEqual(["a", "b"]);
  });

  test("handles all identical pages", () => {
    const pages = ["x", "x", "x", "x", "x"];
    expect(trimDuplicateTrailingPages(pages)).toEqual([]);
  });

  test("trims whitespace when comparing", () => {
    const pages = ["a", "b", "dup ", " dup", "dup"];
    expect(trimDuplicateTrailingPages(pages)).toEqual(["a", "b"]);
  });

  test("no trailing duplicates returns unchanged", () => {
    const pages = ["a", "b", "c", "d"];
    expect(trimDuplicateTrailingPages(pages)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("removeRepeatedHeadersFooters", () => {
  test("removes header appearing 5+ times", () => {
    const pages = [
      "HEADER\nContent 1",
      "HEADER\nContent 2",
      "HEADER\nContent 3",
      "HEADER\nContent 4",
      "HEADER\nContent 5",
    ];
    removeRepeatedHeadersFooters(pages);
    expect(pages).toEqual([
      "Content 1",
      "Content 2",
      "Content 3",
      "Content 4",
      "Content 5",
    ]);
  });

  test("removes footer appearing 5+ times", () => {
    const pages = [
      "Content 1\nFOOTER",
      "Content 2\nFOOTER",
      "Content 3\nFOOTER",
      "Content 4\nFOOTER",
      "Content 5\nFOOTER",
    ];
    removeRepeatedHeadersFooters(pages);
    expect(pages).toEqual([
      "Content 1",
      "Content 2",
      "Content 3",
      "Content 4",
      "Content 5",
    ]);
  });

  test("keeps header appearing fewer than 5 times", () => {
    const pages = [
      "HEADER\nContent 1",
      "HEADER\nContent 2",
      "HEADER\nContent 3",
      "Different\nContent 4",
      "Different\nContent 5",
    ];
    removeRepeatedHeadersFooters(pages);
    expect(pages).toEqual([
      "HEADER\nContent 1",
      "HEADER\nContent 2",
      "HEADER\nContent 3",
      "Different\nContent 4",
      "Different\nContent 5",
    ]);
  });

  test("no-op for fewer than 5 pages", () => {
    const pages = ["HEADER\nA", "HEADER\nB", "HEADER\nC", "HEADER\nD"];
    const original = [...pages];
    removeRepeatedHeadersFooters(pages);
    expect(pages).toEqual(original);
  });

  test("removes both header and footer", () => {
    const pages = [
      "H\nContent 1\nF",
      "H\nContent 2\nF",
      "H\nContent 3\nF",
      "H\nContent 4\nF",
      "H\nContent 5\nF",
    ];
    removeRepeatedHeadersFooters(pages);
    expect(pages).toEqual([
      "Content 1",
      "Content 2",
      "Content 3",
      "Content 4",
      "Content 5",
    ]);
  });
});
