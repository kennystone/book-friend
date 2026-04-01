import { ocrPages as gcpOcr } from "./ocr-gcp";
import { ocrPages as scribeOcr } from "./ocr-scribe";
import { mkdir } from "fs/promises";
import { join } from "path";

export type OcrEngine = "gcp" | "scribe";

export async function ocr(
  outputDir: string,
  engine: OcrEngine = "scribe",
  concurrency?: number,
  onProgress?: (current: number, total: number) => void,
) {
  const screenshotDir = join(outputDir, "screenshots");
  const ocrDir = join(outputDir, "ocr");
  await mkdir(ocrDir, { recursive: true });

  if (engine === "gcp") {
    await gcpOcr(screenshotDir, ocrDir, concurrency, onProgress);
  } else {
    await scribeOcr(screenshotDir, ocrDir, concurrency, onProgress);
  }
}
