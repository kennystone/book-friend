import vision from "@google-cloud/vision";
import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { runPool } from "./pool";

export async function ocrPages(screenshotDir: string, ocrDir: string, concurrency?: number) {
  const files = (await readdir(screenshotDir))
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (files.length === 0) {
    console.error(`No screenshots found in ${screenshotDir}`);
    process.exit(1);
  }

  const workers = concurrency ?? 10;
  console.log(`Found ${files.length} screenshots to OCR (engine: gcp, concurrency: ${workers})`);

  const client = new vision.ImageAnnotatorClient();
  let completed = 0;

  await runPool(files, workers, async (file) => {
    const baseName = file.replace(".png", "");
    const imagePath = join(screenshotDir, file);

    const text = await ocrWithRetry(client, imagePath);

    await writeFile(join(ocrDir, `${baseName}.txt`), text);
    completed++;
    console.log(`  OCR page ${completed}/${files.length}: ${text.length} chars`);
  });

  console.log(`OCR results saved to ${ocrDir}`);
}

async function ocrWithRetry(
  client: InstanceType<typeof vision.ImageAnnotatorClient>,
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
