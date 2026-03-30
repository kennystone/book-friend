import { chromium } from "playwright";
import { join } from "path";
import { mkdir } from "fs/promises";

const AUTH_DIR = join(import.meta.dir, "..", "auth");
const KINDLE_URL = "https://read.amazon.com";
const PAGE_SETTLE_MS = 1500;

// Kindle web reader UI elements to hide before screenshotting
const KINDLE_CHROME_SELECTORS = [
  "ion-header#reader-header",             // Top toolbar (title, buttons)
  "div.footer-label-color-default",        // Bottom bar (scrubber, page info)
  "div.kr-chevron-container-left",         // Left nav arrow
  "div.kr-chevron-container-right",        // Right nav arrow
  ".bookmark.desktop",                     // Bookmark button
];

export async function capture(
  asin: string,
  pages: number,
  outputDir: string,
) {
  const screenshotDir = join(outputDir, "screenshots");
  await mkdir(screenshotDir, { recursive: true });

  console.log("Launching browser...");
  // Tall headless browser — more content per screenshot
  const context = await chromium.launchPersistentContext(AUTH_DIR, {
    headless: true,
    viewport: { width: 1280, height: 1800 },
  });

  const page = context.pages()[0] || (await context.newPage());

  // Navigate to Kindle web reader
  await page.goto(KINDLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Wait a moment for any redirects to settle
  await page.waitForTimeout(3000);

  // Check if we need to log in — did we get redirected away from read.amazon.com?
  const currentUrl = page.url();
  const needsLogin = !currentUrl.includes("read.amazon.com");
  if (needsLogin) {
    // Need to log in — relaunch headed so user can interact
    await context.close();
    console.log("Login required — opening visible browser...");

    const loginContext = await chromium.launchPersistentContext(AUTH_DIR, {
      headless: false,
      viewport: { width: 1280, height: 900 },
    });
    const loginPage = loginContext.pages()[0] || (await loginContext.newPage());
    await loginPage.goto(KINDLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

    console.log("\n*** Please log in to your Amazon account in the browser window. ***");
    console.log("Waiting for you to reach the Kindle library...\n");
    await loginPage.waitForURL("**/read.amazon.com/**", { timeout: 300_000 });
    await loginPage.waitForTimeout(2000);
    console.log("Logged in successfully! Closing login browser...");
    await loginContext.close();

    // Re-launch headless with saved auth
    return capture(asin, pages, outputDir);
  }
  console.log("Auth OK — already logged in");

  // Navigate to the book
  const bookUrl = `${KINDLE_URL}/?asin=${asin}`;
  console.log(`Opening book: ${bookUrl}`);
  await page.goto(bookUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000); // Wait for book to render

  // Go to beginning of book
  console.log("Navigating to beginning of book...");
  await goToBeginning(page);
  await page.waitForTimeout(2000);

  // Hide Kindle UI chrome
  await hideKindleChrome(page);

  // Screenshot the content element directly
  const contentEl = await page.$("#kr-renderer");
  if (!contentEl) {
    console.error("Could not find book content element (#kr-renderer)");
    await context.close();
    process.exit(1);
  }
  console.log("Found content element: #kr-renderer");

  console.log(`Capturing ${pages} pages...`);
  for (let i = 1; i <= pages; i++) {
    const filename = `page_${String(i).padStart(4, "0")}.png`;
    const filepath = join(screenshotDir, filename);

    await contentEl.screenshot({ path: filepath });
    console.log(`  Captured page ${i}/${pages}`);

    if (i < pages) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(PAGE_SETTLE_MS);
    }
  }

  console.log(`Screenshots saved to ${screenshotDir}`);
  await context.close();
}

async function goToBeginning(page: import("playwright").Page) {
  // Dismiss any "Most Recent Page Read" dialog first
  const noButton = page.locator('button.alert-button.secondary');
  if (await noButton.isVisible({ timeout: 3000 }).catch(() => false)) {
    await noButton.click();
    console.log("  Dismissed 'Most Recent Page Read' dialog");
    await page.waitForTimeout(2000);
  }

  // Use the scrubber bar to navigate to the very beginning
  const scrubber = page.locator('#kr-scrubber-bar');
  if (await scrubber.isVisible({ timeout: 3000 }).catch(() => false)) {
    const box = await scrubber.boundingBox();
    if (box) {
      // Click at the very start of the scrubber track
      await page.mouse.click(box.x + 2, box.y + box.height / 2);
      console.log("  Clicked scrubber to beginning");
      await page.waitForTimeout(3000);
    }
  }
}

async function hideKindleChrome(page: import("playwright").Page) {
  await page.evaluate((selectors) => {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      els.forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
    }
  }, KINDLE_CHROME_SELECTORS);
  console.log("Hidden Kindle UI chrome");
}
