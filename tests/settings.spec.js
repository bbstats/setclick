const { test, expect } = require("@playwright/test");
const { open, mockPco } = require("./helpers");

const PLAN = [["1", "Goodness of God", 126, "4/4"]];
const shown = (page, id) => page.evaluate((id) => document.getElementById(id).classList.contains("show"), id);

test.beforeEach(async ({ page }) => { await open(page); });

test("setting up Planning Center from the set sheet carries on to picking a service", async ({ page }) => {
  await mockPco(page, PLAN);
  await page.evaluate(() => { state.creds.relay = ""; });
  await page.click("#setPill");
  await page.click("#switchBtn");
  await page.click("#loadPcoBtn");
  expect(await shown(page, "settingsSheet")).toBe(true);
  await expect(page.locator("#pcoRelay")).toBeFocused();
  await expect(page.locator("#settingsBack")).toBeVisible();

  await page.click("#settingsBack");                       // Back returns to My sets
  expect(await shown(page, "setSheet")).toBe(true);
  await expect(page.locator("#setSheetTitle")).toHaveText("My sets");

  await page.click("#loadPcoBtn");
  await page.fill("#pcoRelay", "https://relay.test");
  await page.press("#pcoRelay", "Enter");                  // Enter connects
  await expect(page.locator("[data-st=st1]")).toBeVisible();
  expect(await shown(page, "settingsSheet")).toBe(false);
  await page.click("#setBack");
  await expect(page.locator("#setSheetTitle")).toHaveText("My sets");
});

test("Connect from the gear stays in Settings and reports inline", async ({ page }) => {
  await mockPco(page, PLAN);
  await page.click("#settingsBtn");
  await expect(page.locator("#settingsBack")).toBeHidden();
  await page.click("#testBtn");
  await expect(page.locator("#connStatus")).toHaveText(/Connected/);
  expect(await shown(page, "settingsSheet")).toBe(true);
  expect(await shown(page, "setSheet")).toBe(false);

  await page.evaluate(() => { window.pco = async () => { throw new Error("BLOCKED"); }; });
  await page.click("#testBtn");
  await expect(page.locator("#connStatus")).toHaveText(/Couldn't reach your relay/);
  await page.fill("#pcoRelay", "https://relay2.test");     // typing clears the old result
  await expect(page.locator("#connStatus")).toHaveText("");
});

test("Escape and a downward swipe close sheets", async ({ page }) => {
  await page.click("#settingsBtn");
  await page.keyboard.press("Escape");
  expect(await shown(page, "settingsSheet")).toBe(false);

  await page.click("#setPill");
  await page.waitForTimeout(350);
  const h = await page.locator("#setSheetTitle").boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2, h.y + 200, { steps: 6 });
  await page.mouse.up();
  expect(await shown(page, "setSheet")).toBe(false);
});

test("a relay URL typed without https:// still works", async ({ page }) => {
  expect(await page.evaluate(() => { state.creds.relay = " my-relay.workers.dev/ "; return apiBase(); }))
    .toBe("https://my-relay.workers.dev");
});

test("a relay that answers with the wrong thing gets a plain-English error", async ({ page }) => {
  let reply = { status: 200, body: "<html>Not a relay</html>" };
  await page.route("https://relay.test/**", (r) => r.fulfill({ ...reply, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.click("#settingsBtn");
  await page.fill("#pcoRelay", "https://relay.test");
  await page.click("#testBtn");
  await expect(page.locator("#connStatus")).toHaveText(/not with Planning Center data/);
  reply = { status: 401, body: "{}" };
  await page.click("#testBtn");
  await expect(page.locator("#connStatus")).toHaveText(/turned down the relay's credentials/);
});
