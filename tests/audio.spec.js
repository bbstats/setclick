const { test, expect } = require("@playwright/test");
const { open, initAudio, spyClicks, clicks, gaps } = require("./helpers");

test.beforeEach(async ({ page }) => { await open(page); });

test("double-tapping START then STOP really stops (no leaked scheduler)", async ({ page }) => {
  await page.evaluate(() => { const b = document.querySelector("#playBtn"); b.click(); b.click(); });
  await page.waitForTimeout(500);
  await page.click("#playBtn");
  const t1 = await page.evaluate(() => nextT);
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => [state.playing, nextT])).toEqual([false, t1]);
});

test("holding Space toggles once, not on every key repeat", async ({ page }) => {
  const toggles = await page.evaluate(() => {
    let n = 0; const real = toggle; window.toggle = () => { n++; real(); };
    const key = (repeat) => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", repeat }));
    key(false); for (let i = 0; i < 5; i++) key(true);
    return n;
  });
  expect(toggles).toBe(1);
});

test("changing the sound mid-play keeps the beat even", async ({ page }) => {
  await page.evaluate(() => { state.countIn = 0; });
  await spyClicks(page);
  await page.click("#playBtn");
  await page.click("#settingsBtn");
  for (const snd of ["wood", "rim", "cowbell", "blip", "beep", "click", "stick"]) {
    await page.click(`.snd[data-snd=${snd}]`);
    await page.waitForTimeout(200);
  }
  const beat = 60 / 126;
  for (const g of gaps(await clicks(page))) expect(g).toBeCloseTo(beat, 2);
});

test("switching songs mid-play relaunches with a count-in; tempo nudges don't", async ({ page }) => {
  await page.evaluate(() => { state.countIn = 0; });
  await page.click("#playBtn");
  await page.waitForTimeout(300);
  const oldBus = await page.evaluate(() => { window.__bus = bus; return true; });
  await page.evaluate(() => loadSong(2));                     // Build My Life, count-in 1 bar
  expect(await page.evaluate(() => [state.bpm, phase, __bus !== bus])).toEqual([69, "count", true]);
  await page.evaluate(() => { phase = "run"; });              // pretend the count finished
  await page.evaluate(() => setBpm(state.bpm + 1));
  expect(await page.evaluate(() => phase)).toBe("run");
});

test("STOP cuts clicks that were already queued", async ({ page }) => {
  await page.click("#playBtn");
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.__bus = bus; });
  await page.click("#playBtn");
  expect(await page.evaluate(() => __bus !== bus)).toBe(true);
});

test("6/8 in 2: BPM counts dotted quarters and the count-in speaks the pulses", async ({ page }) => {
  await page.evaluate(() => setBpm(68));
  await page.selectOption("#sigSel", "6/8 in 2");
  await spyClicks(page);
  await page.click("#playBtn");
  await page.waitForTimeout(2600);
  const list = await clicks(page);
  const count = list.slice(0, 2), bar = list.slice(2, 8);
  expect(count[1].t - count[0].t).toBeCloseTo(60 / 68, 2);    // "1 … 2"
  for (const g of gaps(bar)) expect(g).toBeCloseTo(60 / 68 / 3, 2);
});

// Gain of the first node clickAt creates (its output), and which stick sample it used.
async function probe(page) {
  return page.evaluate(() => {
    const out = {};
    for (const kind of [2, 1, 0]) {
      let gain = null, buf = null;
      const cg = ctx.createGain.bind(ctx), cb = ctx.createBufferSource.bind(ctx);
      ctx.createGain = () => { const g = cg(); gain = gain || g; return g; };
      ctx.createBufferSource = () => {
        const b = cb();
        return new Proxy(b, {
          set(t, k, v) { if (k === "buffer") buf = v; t[k] = v; return true; },
          get(t, k) { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; },
        });
      };
      clickAt(ctx.currentTime + 1, kind);
      ctx.createGain = cg; ctx.createBufferSource = cb;
      const name = Object.keys(stickBufs).find((k) => stickBufs[k] === buf);
      out[["sub", "weak", "accent"][kind]] = [+(gain.gain.value / 1.2).toFixed(2), name];
    }
    return out;
  });
}

test("weak-beat volume and accent pitch", async ({ page }) => {
  await initAudio(page);
  expect(await probe(page)).toEqual({ accent: [1, "n"], weak: [0.5, "n"], sub: [0.28, "n"] });
  await page.click("#weakChip");
  expect(await probe(page)).toEqual({ accent: [1, "n"], weak: [1, "n"], sub: [0.56, "n"] });
  await page.evaluate(() => { state.accentPitch = true; });
  expect(await probe(page)).toEqual({ accent: [1, "a"], weak: [1, "n"], sub: [0.56, "s"] });
});

test("every synth sound is audible and doesn't clip", async ({ page }) => {
  const peaks = await page.evaluate(async () => {
    const out = {};
    for (const snd of ["wood", "rim", "cowbell", "blip", "beep", "click"]) {
      const off = new OfflineAudioContext(1, 22050, 44100);
      const saved = [ctx, bus, noiseBuf];
      ctx = off; bus = off.createGain(); bus.connect(off.destination); noiseBuf = null;
      state.sound = snd;
      clickAt(0.01, 2);
      const d = (await off.startRendering()).getChannelData(0);
      out[snd] = d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      [ctx, bus, noiseBuf] = saved;
    }
    return out;
  });
  for (const [snd, peak] of Object.entries(peaks)) {
    expect(peak, snd).toBeGreaterThan(0.3);
    expect(peak, snd).toBeLessThanOrEqual(1);
  }
});
