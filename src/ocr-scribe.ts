import { readdir } from "fs/promises";
import { join, resolve } from "path";
import { cpus, totalmem } from "os";
import { runPool } from "./pool";

function defaultConcurrency(): number {
  const cores = cpus().length;
  const ramGB = totalmem() / 1024 / 1024 / 1024;
  return Math.max(1, Math.min(cores - 2, Math.floor(ramGB / 1.5)));
}

export async function ocrPages(screenshotDir: string, ocrDir: string, concurrency?: number) {
  const files = (await readdir(screenshotDir))
    .filter((f) => f.endsWith(".png"))
    .sort();

  if (files.length === 0) {
    console.error(`No screenshots found in ${screenshotDir}`);
    process.exit(1);
  }

  const workers = concurrency ?? defaultConcurrency();
  console.log(`Found ${files.length} screenshots to OCR (engine: scribe, workers: ${workers})`);

  const workerScript = resolve(import.meta.dir, "ocr-worker.ts");
  let completed = 0;

  await runPool(files, workers, async (file) => {
    const baseName = file.replace(".png", "");
    const imagePath = join(screenshotDir, file);
    const outputPath = join(ocrDir, `${baseName}.txt`);

    for (let attempt = 0; attempt <= 1; attempt++) {
      const proc = Bun.spawn(["bun", workerScript, imagePath, outputPath], {
        stdout: "ignore",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        completed++;
        const text = await Bun.file(outputPath).text();
        console.log(`  OCR page ${completed}/${files.length}: ${text.length} chars`);
        return;
      }

      if (attempt === 0) {
        const stderr = await new Response(proc.stderr).text();
        console.warn(`  OCR failed for ${file}, retrying... (${stderr.trim()})`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`OCR failed for ${file}: ${stderr.trim()}`);
      }
    }
  });

  console.log(`OCR results saved to ${ocrDir}`);
}
