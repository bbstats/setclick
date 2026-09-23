const { test, expect } = require("@playwright/test");
const { open } = require("./helpers");

const VIEWPORTS = {
  "iPad landscape": { width: 1180, height: 820 },
  "iPad portrait": { width: 820, height: 1180 },
  "iPhone": { width: 390, height: 844 },
  "iPhone SE": { width: 375, height: 667 },
  "phone landscape": { width: 844, height: 390 },
};

for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  test.describe(name, () => {
    test.use({ viewport });

    test("layout fits: nothing off-screen, chips fit, 12/8 lamps clear the slider", async ({ page }) => {
      await open(page);
      const offscreen = await page.evaluate(() => [...document.querySelectorAll("body *")]
        .filter((e) => !e.closest(".sheet, #carousel, #toast"))
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.bottom > innerHeight + 1); })
        .map((e) => e.id || e.className));
      expect(offscreen).toEqual([]);
      const chipsFit = await page.evaluate(() => [...document.querySelectorAll(".btnrow .chip")]
        .every((c) => c.scrollWidth <= c.clientWidth + 1));
      expect(chipsFit).toBe(true);
      await page.selectOption("#sigSel", "12/8");
      const [lampsBottom, sliderTop] = await page.evaluate(() =>
        [document.querySelector("#lamps").getBoundingClientRect().bottom,
         document.querySelector(".sliderrow").getBoundingClientRect().top]);
      expect(lampsBottom).toBeLessThanOrEqual(sliderTop);
    });

    test("sheets scroll instead of spilling off-screen", async ({ page }) => {
      await open(page);
      await page.click("#settingsBtn");
      await page.waitForTimeout(350);
      const box = await page.locator("#settingsSheet").boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    });
  });
}

test("count-in shows COUNT IN instead of BPM", async ({ page }) => {
  await open(page);
  await page.click("#playBtn");
  await page.waitForFunction(() => document.querySelector("#bpmNum").classList.contains("count"));
  const after = await page.evaluate(() => getComputedStyle(document.querySelector(".bpm-label"), "::after").content);
  expect(after).toBe('"COUNT IN"');
});

test("Click is the default sound, and the chosen sound survives a reload", async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => state.sound)).toBe("click");
  await page.click("#settingsBtn");
  await page.click('.snd[data-snd="wood"]');
  await page.reload();
  await open(page);
  expect(await page.evaluate(() => state.sound)).toBe("wood");
});

test("WEAK and FEEL are saved per song", async ({ page }) => {
  await open(page);
  await page.click("#weakChip");
  await page.selectOption("#subSel", "2");
  await page.evaluate(() => loadSong(1, { instant: true }));
  expect(await page.textContent("#weakVal")).toBe("50%");
  await page.evaluate(() => loadSong(0, { instant: true }));
  await page.reload();
  await open(page);
  expect(await page.textContent("#weakVal")).toBe("100%");
  expect(await page.textContent("#subVal")).toBe("♪♪");
});
