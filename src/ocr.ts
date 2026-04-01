import { ocrPages as gcpOcr } from "./ocr-gcp";
import { ocrPages as scribeOcr } from "./ocr-scribe";
import { mkdir } from "fs/promises";
import { join } from "path";

export type OcrEngine = "gcp" | "scribe";

export async function ocr(outputDir: string, engine: OcrEngine = "scribe", concurrency?: number) {
  const screenshotDir = join(outputDir, "screenshots");
  const ocrDir = join(outputDir, "ocr");
  await mkdir(ocrDir, { recursive: true });

  if (engine === "gcp") {
    await gcpOcr(screenshotDir, ocrDir, concurrency);
  } else {
    await scribeOcr(screenshotDir, ocrDir, concurrency);
  }
}
