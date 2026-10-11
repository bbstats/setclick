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

// The app page in the cache stands in for the version the open app is running.
async function cacheOldPage(page) {
  await page.evaluate(async () => {
    const c = await caches.open("setclick-v1");
    await c.put(new URL("metronome.html", location.href).href,
      new Response("<!doctype html><title>SetClick (old)</title>", { headers: { "content-type": "text/html" } }));
  });
}
const swReady = (page) => page.waitForFunction(() => !!navigator.serviceWorker.controller);

test("a new version shows the update bar; tapping it loads the new version", async ({ page }) => {
  await open(page);
  await page.reload(); await open(page); await swReady(page);  // now running under the service worker
  await page.waitForTimeout(1500);                              // the launch check found nothing new
  await expect(page.locator("#updateBar")).toBeHidden();
  await cacheOldPage(page);
  await page.evaluate(() => { lastUpdateCheck = 0; return checkForUpdate(); });
  await expect(page.locator("#updateBar")).toBeVisible();
  // the cache now holds the new page, so a reload opens it
  expect(await page.evaluate(async () => (await (await caches.match("metronome.html")).text()).includes("updateBar"))).toBe(true);
  await page.click("#updateBar");
  await open(page);
  expect(await page.title()).toContain("SetClick");
  await expect(page.locator("#updateBar")).toBeHidden();
});

test("the update bar stays hidden while playing and comes back on STOP", async ({ page }) => {
  await open(page);
  await page.reload(); await open(page); await swReady(page);
  await cacheOldPage(page);
  await page.evaluate(() => { lastUpdateCheck = 0; return checkForUpdate(); });
  await expect(page.locator("#updateBar")).toBeVisible();
  await page.click("#playBtn");
  await expect(page.locator("#updateBar")).toBeHidden();
  await page.click("#playBtn");
  await expect(page.locator("#updateBar")).toBeVisible();
});

test("launching the app serves the cached page without replacing it behind the app's back", async ({ page }) => {
  await open(page);
  await page.reload(); await open(page); await swReady(page);
  await cacheOldPage(page);
  const html = await page.evaluate(async () => (await fetch("metronome.html")).text());
  expect(html).toContain("SetClick (old)");                    // served from cache, untouched
  await page.waitForTimeout(300);
  expect(await page.evaluate(async () => (await (await caches.match("metronome.html")).text()))).toContain("SetClick (old)");
});
