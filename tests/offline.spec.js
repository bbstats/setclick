const { test, expect } = require("@playwright/test");
const { open } = require("./helpers");

test("service worker caches the app and it reloads offline", async ({ page, context }) => {
  await open(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () =>
    (await (await caches.open("setclick-v1")).keys()).map((r) => new URL(r.url).pathname).sort()))
    .toEqual(["/icons/icon-180.png", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest", "/metronome.html"]);
  await context.setOffline(true);
  await page.reload();
  await open(page);
  expect(await page.title()).toContain("SetClick");
});
