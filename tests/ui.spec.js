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

    test("layout fits: nothing off-screen, chips fit, 12/8 lamps sit between the slider and the chips", async ({ page }) => {
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
      const [numBottom, slider, lamps, chipsTop] = await page.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        return [r("#bpmNum").bottom, r(".sliderrow"), r("#lamps"), r(".btnrow").top];
      });
      expect(numBottom).toBeLessThanOrEqual(slider.top);
      expect(slider.bottom).toBeLessThanOrEqual(lamps.top);
      expect(lamps.bottom).toBeLessThanOrEqual(chipsTop);
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
  expect(await page.textContent("#weakVal")).toBe("100%");                 // the default
  await page.evaluate(() => loadSong(0, { instant: true }));
  await page.reload();
  await open(page);
  expect(await page.textContent("#weakVal")).toBe("50%");
  expect(await page.textContent("#subVal")).toBe("♪♪");
});

test("damaged saved data falls back to the demo set instead of breaking", async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    localStorage.setItem("setclick:setCache", JSON.stringify({ name: "Bad", songs: [null] }));
    localStorage.setItem("setclick:sets", JSON.stringify([{ id: "x", songs: "nope" }]));
    localStorage.setItem("setclick:settings", JSON.stringify({ sound: "kazoo" }));
  });
  await page.reload();
  await open(page);
  expect(await page.evaluate(() => [state.set.demo, library.length, state.sound])).toEqual([true, 0, "click"]);
});

test("a one-song set says 1 song", async ({ page }) => {
  await open(page);
  await page.evaluate(() => useSet({ id: "manual:1", name: "Solo", songs: parseManual("Way Maker 68") }));
  await expect(page.locator("#setPillText")).toHaveText("Solo · 1 song");
});

test("both volume bars are labelled", async ({ page }) => {
  await open(page);
  await expect(page.locator("#volRow .eyebrow")).toHaveText("CLICK");
  await expect(page.locator("#voiceRow .eyebrow")).toHaveText("VOICE");
});

test("tap the BPM to type a tempo: Enter or tapping away sets it; nothing typed or Escape keeps it", async ({ page }) => {
  await open(page);
  const sliderTop = () => page.evaluate(() => document.querySelector(".sliderrow").getBoundingClientRect().top);
  const before = await sliderTop();
  await page.click("#bpmNum");
  await expect(page.locator("#bpmEdit")).toBeFocused();
  await expect(page.locator("#bpmEdit")).toHaveValue("");
  await expect(page.locator("#bpmEdit")).toHaveAttribute("placeholder", "126");
  expect(Math.abs((await sliderTop()) - before)).toBeLessThanOrEqual(1);   // the layout doesn't jump
  await page.keyboard.type("92");
  await page.keyboard.press("Enter");
  await expect(page.locator("#bpmNum")).toHaveText("92");
  expect(await page.evaluate(() => [state.bpm, +document.querySelector("#slider").value, state.set.songs[0].bpm]))
    .toEqual([92, 92, 92]);

  await page.click("#bpmNum");
  await page.keyboard.type("5x00");                                        // letters dropped, too fast clamps
  await page.click(".lamps-hint");                                         // tap away
  await expect(page.locator("#bpmNum")).toHaveText("280");

  await page.click("#bpmNum");
  await page.keyboard.type("100");
  await page.keyboard.press("Escape");
  await expect(page.locator("#bpmNum")).toHaveText("280");
  await expect(page.locator("#bpmEdit")).toBeHidden();

  await page.click("#bpmNum");                                             // opened by mistake
  await page.keyboard.press("Enter");
  await expect(page.locator("#bpmNum")).toHaveText("280");

  await page.click(".bpm-label");                                          // the BPM under it opens it too
  await expect(page.locator("#bpmEdit")).toBeFocused();
});

test("the BPM shows a pencil, but not while it shows the count-in (and doesn't open then)", async ({ page }) => {
  await open(page);
  const pencil = () => page.evaluate(() => getComputedStyle(document.querySelector("#bpmNum"), "::after").display);
  expect(await pencil()).toBe("block");
  await page.click("#playBtn");
  await page.waitForFunction(() => document.querySelector("#bpmNum").classList.contains("count"));
  expect(await pencil()).toBe("none");
  await page.evaluate(() => editBpm());
  await expect(page.locator("#bpmEdit")).toBeHidden();
});
