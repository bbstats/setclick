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
