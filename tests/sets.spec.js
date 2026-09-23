const { test, expect } = require("@playwright/test");
const { open, mockPco } = require("./helpers");

const titles = (page) => page.evaluate(() => state.set.songs.map((s) => `${s.title}@${s.bpm}`));

test.beforeEach(async ({ page }) => { await open(page); });

test("manual entry parsing", async ({ page }) => {
  const songs = await page.evaluate(() =>
    parseManual("1. Way Maker 68 6/8 in 2\nGoodness of God, 126 4/4\nNo Tempo Song\nBuild My Life 72 bpm"));
  expect(songs.map((s) => [s.title, s.bpm, s.meter])).toEqual([
    ["Way Maker", 68, "6/8 in 2"],
    ["Goodness of God", 126, "4/4"],
    ["No Tempo Song", null, ""],
    ["Build My Life", 72, ""],
  ]);
  const odd = await page.evaluate(() => parseManual("24/7 Praise 110 3/4\nOpen 24/7 96"));
  expect(odd.map((s) => [s.title, s.bpm, s.meter])).toEqual([["24/7 Praise", 110, "3/4"], ["Open 24/7", 96, ""]]);
});

test("a song with no meter gets 4/4, not the previous song's meter and accents", async ({ page }) => {
  await page.evaluate(() => { useSet({ id: "manual:t", name: "T", songs: parseManual("Waltz 90 3/4\nNo Meter 100") }); });
  await page.locator(".lamp").nth(1).click();                 // custom accents on the 3/4 song
  await page.evaluate(() => loadSong(1, { instant: true }));
  expect(await page.evaluate(() => [state.beats, state.denom, state.accents])).toEqual([4, 4, [2, 1, 1, 1]]);
  expect(await page.inputValue("#sigSel")).toBe("4/4");
});

test("edit set: reorder, add, remove the current song", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await page.evaluate(() => loadSong(1, { instant: true }));   // King of Kings
  await page.click("#setPill");
  await page.click("#editSetBtn");
  await page.click('.ebtn[data-act=up][data-i="1"]');
  expect(await page.evaluate(() => [state.songIx, state.set.songs[state.songIx].title])).toEqual([0, "King of Kings"]);
  await page.fill("#addTxt", "Way Maker 68 6/8");
  await page.press("#addTxt", "Enter");
  await page.click('.ebtn[data-act=del][data-i="0"]');
  expect(await titles(page)).toEqual(["Goodness of God@126", "Build My Life@69", "Way Maker@68"]);
  expect(await page.evaluate(() => state.songIx)).toBe(0);
  await page.reload();
  await open(page);
  expect(await titles(page)).toEqual(["Goodness of God@126", "Build My Life@69", "Way Maker@68"]);
});

test("edit set: drag a song by its grip to reorder", async ({ page }) => {
  await page.evaluate(() => loadSong(1, { instant: true }));   // King of Kings
  await page.click("#setPill");
  await page.click("#editSetBtn");
  await page.waitForTimeout(350);
  const drag = async (from, to) => {
    const g = await page.locator(`.grip[data-i="${from}"]`).boundingBox();
    const t = await page.locator(".editrow").nth(to).boundingBox();
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(g.x + g.width / 2, t.y + t.height / 2 + (to > from ? 8 : -8), { steps: 8 });
    await page.waitForTimeout(50);
    await page.mouse.up();
  };
  await drag(0, 2);
  expect(await titles(page)).toEqual(["King of Kings@136", "Build My Life@69", "Goodness of God@126"]);
  expect(await page.evaluate(() => state.songIx)).toBe(0);   // still on King of Kings
  await drag(2, 0);
  expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@136", "Build My Life@69"]);
  await page.reload();
  await open(page);
  expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@136", "Build My Life@69"]);
});

// Hold a carousel card, then drag it toward `to` (holding near the edge lets the carousel
// scroll there if that card is off-screen). Works for the portrait strip and landscape rail.
async function holdAndDrag(page, from, to) {
  const card = await page.locator("#carousel .card").nth(from).boundingBox();
  const box = await page.locator("#carousel").boundingBox();
  const rail = await page.evaluate(() => railMode());
  const x = card.x + card.width / 2, y = card.y + card.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(500);                            // hold
  const edge = to > from ? (rail ? box.y + box.height - 10 : box.x + box.width - 10) : (rail ? box.y + 10 : box.x + 10);
  await page.mouse.move(rail ? x : edge, rail ? edge : y, { steps: 10 });
  await page.waitForTimeout(700);                            // let it scroll along if needed
  await page.mouse.up();
}

test.describe("hold a song on the main screen to move it", () => {
  for (const [name, viewport] of [["landscape rail", { width: 1180, height: 820 }], ["portrait strip", { width: 390, height: 844 }]]) {
    test(name, async ({ page }) => {
      await page.setViewportSize(viewport);
      await holdAndDrag(page, 0, 2);
      expect(await titles(page)).toEqual(["King of Kings@136", "Build My Life@69", "Goodness of God@126"]);
      expect(await page.evaluate(() => state.set.songs[state.songIx].title)).toBe("Goodness of God");   // still on it
      await holdAndDrag(page, 2, 0);
      expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@136", "Build My Life@69"]);
      await holdAndDrag(page, 0, 2);
      await page.reload();
      await open(page);
      expect(await titles(page)).toEqual(["King of Kings@136", "Build My Life@69", "Goodness of God@126"]);
    });
  }

  test("a tap still selects; a hold without moving neither selects nor moves", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    const cards = page.locator("#carousel .card");
    await cards.nth(1).click();
    expect(await page.evaluate(() => state.songIx)).toBe(1);
    const b = await cards.nth(2).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.up();
    expect(await page.evaluate(() => state.songIx)).toBe(1);
    expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@136", "Build My Life@69"]);
  });

  test.describe("on a touchscreen", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    // Real touch input (not mouse), so the browser's own swipe-to-scroll is in play.
    async function touch(page, points) {
      const cdp = await page.context().newCDPSession(page);
      for (const [type, x, y, wait] of points) {
        await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
        if (wait) await page.waitForTimeout(wait);
      }
    }

    test("hold and drag moves the song instead of scrolling", async ({ page }) => {
      const c = await page.locator("#carousel .card").nth(0).boundingBox();
      const x = c.x + c.width / 2, y = c.y + c.height / 2;
      const path = Array.from({ length: 10 }, (_, i) => ["touchMove", x + (i + 1) * 17, y, 16]);
      await touch(page, [["touchStart", x, y, 500], ...path, ["touchMove", 380, y, 700], ["touchEnd"]]);
      expect(await titles(page)).toEqual(["King of Kings@136", "Build My Life@69", "Goodness of God@126"]);
    });

    test("a quick swipe just browses", async ({ page }) => {
      const c = await page.locator("#carousel .card").nth(0).boundingBox();
      const x = c.x + c.width / 2, y = c.y + c.height / 2;
      const path = Array.from({ length: 8 }, (_, i) => ["touchMove", x - (i + 1) * 20, y, 16]);
      await touch(page, [["touchStart", x, y, 30], ...path, ["touchEnd", 0, 0, 600]]);
      expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@136", "Build My Life@69"]);
    });
  });
});

const PLAN = [["1", "Goodness of God", 126, "4/4"], ["2", "King of Kings", 136, "4/4"], ["3", "Build My Life", 69, "4/4"]];

async function loadPlan(page) {
  await page.click("#setPill");
  await page.click("#switchBtn");
  await page.click("#loadPcoBtn");
  await page.click("[data-st=st1]");
  await page.click("[data-plan=p1]");
  await page.waitForFunction(() => state.set.id === "pco:p1");
}

test("saved sets keep your changes when you switch away and back", async ({ page }) => {
  await mockPco(page, PLAN);
  await loadPlan(page);
  await page.evaluate(() => { loadSong(1, { instant: true }); setBpm(140); });
  await page.click("#switchBtn");
  await page.click("#manualBtn");
  await page.fill("#manualTxt", "Firm Foundation 70");
  await page.click("#manualGo");
  await page.click("#switchBtn");
  await page.click(".setrow:not(.current)");
  expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@140", "Build My Life@69"]);
});

test("Planning Center changes: confirm first, cancel keeps your copy, OK merges and keeps tweaks", async ({ page }) => {
  const dialogs = []; let answer = false;
  page.on("dialog", (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await mockPco(page, PLAN);
  await loadPlan(page);
  await page.evaluate(() => { loadSong(1, { instant: true }); setBpm(140); });
  await page.evaluate(() => { __items = [["2", "King of Kings", 136, "4/4"], ["1", "Goodness of God", 126, "4/4"], ["9", "Way Maker", 68, "6/8"]]; });

  await page.evaluate(() => goSetlist("st1", "p1", "Sep 28"));
  expect(dialogs.at(-1)).toContain("Added: Way Maker");
  expect(dialogs.at(-1)).toContain("Removed: Build My Life");
  expect(dialogs.at(-1)).toContain("The song order changed");
  expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@140", "Build My Life@69"]);

  answer = true;
  await page.evaluate(() => goSetlist("st1", "p1", "Sep 28"));
  expect(await titles(page)).toEqual(["King of Kings@140", "Goodness of God@126", "Way Maker@68"]);
  expect(await page.evaluate(() => state.set.songs[state.songIx].title)).toBe("King of Kings");   // stayed on it
});

test("sets saved before plan item ids existed match by title, with no false changes", async ({ page }) => {
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await mockPco(page, PLAN);
  await page.evaluate(async (plan) => {
    const old = { name: "Sep 28", src: { stId: "st1", planId: "p1", label: "Sep 28" },
      songs: plan.map(([, title, bpm, meter]) => ({ title, bpm: title === "King of Kings" ? 140 : bpm, meter, key: "G", subdiv: 1, countIn: 1 })) };
    useSet(old);
    loadSong(1, { instant: true });
    await syncPco(state.set);
  }, PLAN);
  expect(dialogs).toEqual([]);
  expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@140", "Build My Life@69"]);
  expect(await page.evaluate(() => state.set.songs.map((s) => s.pcoId))).toEqual(["1", "2", "3"]);

  await page.evaluate(() => { __items = [["2", "King of Kings", 136, "4/4"], ["1", "Goodness of God", 126, "4/4"]]; });
  await page.evaluate(() => goSetlist("st1", "p1", "Sep 28"));
  expect(dialogs.at(-1)).toBe("Planning Center has changed this set since you last used it:\n\n" +
    "Removed: Build My Life\nThe song order changed" +
    "\n\nUpdate your copy? Your tempo and feel changes stay on songs that are still in the set.");
});

test("Reset asks first, then restores Planning Center values; survives reload", async ({ page }) => {
  const dialogs = []; let answer = false;
  page.on("dialog", (d) => { dialogs.push(d.message()); answer ? d.accept() : d.dismiss(); });
  await mockPco(page, PLAN);
  await loadPlan(page);
  await page.evaluate(() => { loadSong(1, { instant: true }); setBpm(140); viewHome(); });
  await page.click("#resetBtn");
  expect(dialogs.at(-1)).toContain("Reset this set");
  expect(await titles(page)).toContain("King of Kings@140");
  answer = true;
  await page.click("#resetBtn");
  await page.waitForFunction(() => state.set.songs[1].bpm === 136);
  await page.reload();
  await open(page);
  expect(await titles(page)).toEqual(["Goodness of God@126", "King of Kings@136", "Build My Life@69"]);
  expect(await page.evaluate(() => library.map((s) => s.id))).toEqual(["pco:p1"]);
});

test("Reset also resets the tempo that's playing, not just the saved one", async ({ page }) => {
  page.on("dialog", (d) => d.accept());
  await mockPco(page, PLAN);
  await loadPlan(page);
  await page.evaluate(() => { loadSong(1, { instant: true }); setBpm(140); viewHome(); });
  await page.click("#resetBtn");
  await page.waitForFunction(() => state.set.songs[1].bpm === 136);
  expect(await page.evaluate(() => state.bpm)).toBe(136);
  await expect(page.locator("#bpmNum")).toHaveText("136");
});

test("Planning Center's new tempo, meter and title come through unless you changed that song", async ({ page }) => {
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await mockPco(page, PLAN);
  await loadPlan(page);
  await page.evaluate(() => { loadSong(1, { instant: true }); setBpm(140); });   // your King of Kings tempo
  await page.evaluate(() => { __items = [["1", "Goodness of God", 130, "4/4"], ["2", "King of Kings", 150, "4/4"],
                                         ["3", "Build My Life (Live)", 69, "6/8"]]; });
  await page.evaluate(() => goSetlist("st1", "p1", "Sep 28"));
  expect(dialogs).toHaveLength(1);
  expect(dialogs[0]).toContain("New tempo or meter: Goodness of God, Build My Life (Live)");
  expect(dialogs[0]).not.toContain("Added");
  expect(await titles(page)).toEqual(["Goodness of God@130", "King of Kings@140", "Build My Life (Live)@69"]);
  expect(await page.evaluate(() => state.set.songs[2].meter)).toBe("6/8");
});

test("a Planning Center prompt waits until STOP instead of freezing the click", async ({ page }) => {
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await mockPco(page, PLAN);
  await loadPlan(page);
  await page.evaluate(() => closeSheets());
  await page.click("#playBtn");
  await page.waitForFunction(() => state.playing);
  await page.evaluate(() => { __items = [...__items, ["9", "Way Maker", 68, "6/8"]]; });
  await page.evaluate(() => syncPco(state.set));
  await page.waitForTimeout(300);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => state.playing)).toBe(true);
  await page.click("#playBtn");
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("Added: Way Maker");
  expect(await titles(page)).toContain("Way Maker@68");
});

test("pressing Back while a list loads throws the late result away", async ({ page }) => {
  await mockPco(page, PLAN);
  await page.click("#setPill");
  await page.click("#switchBtn");
  await page.click("#loadPcoBtn");
  await page.evaluate(() => { window.__delay = 600; });
  await page.click("[data-st=st1]");                             // plans start loading, slowly…
  await page.evaluate(() => { window.__delay = 0; });
  await page.click("#setBack");                                  // …but we go back to the services
  await expect(page.locator("[data-st=st1]")).toBeVisible();
  await page.waitForTimeout(800);                                // the plans answer arrives now
  await expect(page.locator("#setSheetTitle")).toHaveText("Pick a service");
  await page.click("#setBack");
  await expect(page.locator("#setSheetTitle")).toHaveText("My sets");
});

test("Back from a plan that failed to load returns to the plan list", async ({ page }) => {
  await mockPco(page, PLAN);
  await page.evaluate(() => { window.__fail = "/items"; });
  await page.click("#setPill");
  await page.click("#switchBtn");
  await page.click("#loadPcoBtn");
  await page.click("[data-st=st1]");
  await page.click("[data-plan=p1]");
  await expect(page.locator("#setSheetTitle")).toHaveText("Hmm");
  await page.click("#setBack");
  await expect(page.locator("[data-plan=p1]")).toBeVisible();
  await expect(page.locator("#setSheetTitle")).toHaveText("Sunday AM");
});
