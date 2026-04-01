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

async function openBook(asin: string): Promise<{
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  page: import("playwright").Page;
}> {
  console.log("Launching browser...");
  const context = await chromium.launchPersistentContext(AUTH_DIR, {
    headless: true,
    viewport: { width: 1280, height: 1800 },
  });

  const page = context.pages()[0] || (await context.newPage());

  // Navigate to Kindle web reader
  await page.goto(KINDLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(3000);

  // Check if we need to log in
  const currentUrl = page.url();
  if (!currentUrl.includes("read.amazon.com")) {
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

    return openBook(asin);
  }
  console.log("Auth OK — already logged in");

  // Navigate to the book
  const bookUrl = `${KINDLE_URL}/?asin=${asin}`;
  console.log(`Opening book: ${bookUrl}`);
  await page.goto(bookUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000);

  // Go to beginning of book
  console.log("Navigating to beginning of book...");
  await goToBeginning(page);
  await page.waitForTimeout(2000);

  return { context, page };
}

export async function detectPageCount(asin: string): Promise<{ pages: number; context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>; page: import("playwright").Page }> {
  const { context, page } = await openBook(asin);

  // Tap the center of the page to make the Kindle UI chrome appear
  const viewport = page.viewportSize()!;
  await page.mouse.click(viewport.width / 2, viewport.height / 2);
  await page.waitForTimeout(1500);

  // Try multiple selectors for the footer
  const selectors = [
    "div.footer-label-color-default",
    "#kr-footer-container",
    "[class*=footer]",
    "[class*=scrubber]",
  ];

  let footerText: string | null = null;
  for (const sel of selectors) {
    const el = page.locator(sel);
    const count = await el.count();
    for (let i = 0; i < count; i++) {
      const text = await el.nth(i).textContent({ timeout: 2000 }).catch(() => null);
      if (text && /(?:page|location)\s+\d+\s+of\s+\d+/i.test(text)) {
        footerText = text;
        break;
      }
    }
    if (footerText) break;
  }

  if (!footerText) {
    // Last resort: search the entire page text
    const bodyText = await page.locator("body").textContent().catch(() => "");
    const anyMatch = bodyText?.match(/((?:Page|Location)\s+\d+\s+of\s+\d+)/i);
    if (anyMatch) {
      footerText = anyMatch[1]!;
    }
  }

  if (!footerText) {
    await context.close();
    throw new Error("Could not find page count in any element");
  }

  // Match either "Page X of Y" or "Location X of Y"
  const match = footerText.match(/(?:Page|Location)\s+\d+\s+of\s+(\d+)/i);
  if (!match) {
    await context.close();
    throw new Error(`Could not parse page count from footer: "${footerText}"`);
  }

  const pages = parseInt(match[1]!, 10);
  console.log(`Detected ${pages} total pages`);
  return { pages, context, page };
}

export async function capture(
  asin: string,
  pages: number,
  outputDir: string,
  onProgress?: (current: number, total: number) => void,
  existingSession?: { context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>; page: import("playwright").Page },
) {
  const screenshotDir = join(outputDir, "screenshots");
  await mkdir(screenshotDir, { recursive: true });

  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>;
  let page: import("playwright").Page;

  if (existingSession) {
    context = existingSession.context;
    page = existingSession.page;
  } else {
    ({ context, page } = await openBook(asin));
  }

  // Hide Kindle UI chrome
  await hideKindleChrome(page);

  // Screenshot the content element directly
  const contentEl = await page.$("#kr-renderer");
  if (!contentEl) {
    console.error("Could not find book content element (#kr-renderer)");
    await context.close();
    process.exit(1);
  }
  for (let i = 1; i <= pages; i++) {
    const filename = `page_${String(i).padStart(4, "0")}.png`;
    const filepath = join(screenshotDir, filename);

    await contentEl.screenshot({ path: filepath });
    onProgress?.(i, pages);

    if (i < pages) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(PAGE_SETTLE_MS);
    }
  }

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
