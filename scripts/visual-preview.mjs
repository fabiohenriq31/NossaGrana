import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
await mkdir("docs/screenshots", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => console.log(e.message));
await page.goto("http://127.0.0.1:5173");
await page.waitForTimeout(1000);
await page.screenshot({
  path: "docs/screenshots/desktop-initial.png",
  fullPage: true,
});
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({
  path: "docs/screenshots/mobile-initial.png",
  fullPage: true,
});
console.log(await page.title());
await browser.close();
