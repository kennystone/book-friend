import scribe from "scribe.js-ocr";

const [imagePath, outputPath] = process.argv.slice(2);

if (!imagePath || !outputPath) {
  console.error("Usage: bun src/ocr-worker.ts <imagePath> <outputPath>");
  process.exit(1);
}

const text = await scribe.extractText([imagePath]);
await Bun.write(outputPath, text);
await scribe.terminate();
