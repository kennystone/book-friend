import { test, expect, describe } from "bun:test";
import { parseArgs, extractAsin } from "./index.ts";

describe("parseArgs", () => {
  test("parses --book and --pages", () => {
    const args = parseArgs(["--book", "B00ABC123", "--pages", "50"]);
    expect(args.book).toBe("B00ABC123");
    expect(args.pages).toBe("50");
  });

  test("parses --help flag", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
  });

  test("parses --capture-only flag", () => {
    const args = parseArgs(["--capture-only"]);
    expect(args.captureOnly).toBe(true);
  });

  test("parses --ocr-only flag", () => {
    const args = parseArgs(["--ocr-only"]);
    expect(args.ocrOnly).toBe(true);
  });

  test("parses --assemble-only flag", () => {
    const args = parseArgs(["--assemble-only"]);
    expect(args.assembleOnly).toBe(true);
  });

  test("converts kebab-case keys to camelCase", () => {
    const args = parseArgs(["--output-dir", "/tmp/out"]);
    expect(args.outputDir).toBe("/tmp/out");
  });

  test("parses --title", () => {
    const args = parseArgs(["--title", "My Book Title"]);
    expect(args.title).toBe("My Book Title");
  });

  test("handles all options together", () => {
    const args = parseArgs([
      "--book",
      "B123",
      "--pages",
      "100",
      "--title",
      "Test",
      "--output-dir",
      "/out",
    ]);
    expect(args.book).toBe("B123");
    expect(args.pages).toBe("100");
    expect(args.title).toBe("Test");
    expect(args.outputDir).toBe("/out");
  });

  test("parses --agent flag", () => {
    const args = parseArgs(["--agent", "--book", "B123", "--pages", "10"]);
    expect(args.agent).toBe(true);
    expect(args.book).toBe("B123");
  });

  test("returns empty object for no args", () => {
    expect(parseArgs([])).toEqual({});
  });
});

describe("extractAsin", () => {
  test("extracts ASIN from URL with asin parameter", () => {
    expect(extractAsin("https://read.amazon.com/?asin=B00ABC1234")).toBe(
      "B00ABC1234",
    );
  });

  test("returns plain ASIN as-is", () => {
    expect(extractAsin("B00ABC1234")).toBe("B00ABC1234");
  });

  test("handles lowercase asin in URL", () => {
    expect(extractAsin("https://read.amazon.com/?asin=b00abc1234")).toBe(
      "b00abc1234",
    );
  });

  test("returns non-ASIN string as-is", () => {
    expect(extractAsin("some-random-input")).toBe("some-random-input");
  });
});
