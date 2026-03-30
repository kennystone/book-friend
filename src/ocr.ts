import vision from "@google-cloud/vision";
import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";

export async function ocr(outputDir: string) {
  const screenshotDir = join(outputDir, "screenshots");
  const ocrDir = join(outputDir, "ocr");
  await mkdir(ocrDir, { recursive: true });

  // List and sort screenshot files
  const files = (await readdir(screenshotDir))
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (files.length === 0) {
    console.error(`No screenshots found in ${screenshotDir}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} screenshots to OCR`);

  const client = new vision.ImageAnnotatorClient();

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const baseName = file.replace(".png", "");
    const imagePath = join(screenshotDir, file);

    const text = await ocrWithRetry(client, imagePath);

    // Save full extracted text
    await writeFile(join(ocrDir, `${baseName}.txt`), text);

    console.log(`  OCR page ${i + 1}/${files.length}: ${text.length} chars`);
  }

  console.log(`OCR results saved to ${ocrDir}`);
}

async function ocrWithRetry(
  client: vision.ImageAnnotatorClient,
  imagePath: string,
  retries = 1,
): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const imageBuffer = await readFile(imagePath);
      const [result] = await client.documentTextDetection({
        image: { content: imageBuffer },
      });
      return result?.fullTextAnnotation?.text ?? "";
    } catch (err) {
      if (attempt < retries) {
        console.warn(`  OCR failed for ${imagePath}, retrying in 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        throw err;
      }
    }
  }
  return "";
}
