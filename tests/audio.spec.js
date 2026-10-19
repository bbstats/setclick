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

test("two fingers on + don't leave the tempo climbing after you let go", async ({ page }) => {
  const bpm = await page.evaluate(async () => {
    const el = document.querySelector("#plus");
    const fire = (type, pointerId) => el.dispatchEvent(new PointerEvent(type, { pointerId, button: 0, bubbles: true }));
    fire("pointerdown", 1); fire("pointerdown", 2);
    await new Promise((r) => setTimeout(r, 700));               // both held: repeating
    fire("pointerup", 2);
    return state.bpm;
  });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => state.bpm)).toBe(bpm);
});

test("nudging the tempo during the count-in doesn't cover the count", async ({ page }) => {
  await page.click("#playBtn");
  await page.waitForFunction(() => document.querySelector("#bpmNum").classList.contains("count"));
  const shown = await page.evaluate(() => { setBpm(100); return document.querySelector("#bpmNum").textContent; });
  expect(shown).not.toBe("100");
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

// Record what the count-in voice says and when, like spyClicks.
const spySpeech = (page) => page.evaluate(() => {
  window.__spoken = [];
  const real = speakAt;
  window.speakAt = (t, n, ...rest) => { __spoken.push({ t, n }); real(t, n, ...rest); };
});
const spoken = (page) => page.evaluate(() => __spoken);

test("6/8 in 2: BPM counts dotted quarters and the count-in speaks the pulses", async ({ page }) => {
  await page.evaluate(() => setBpm(68));
  await page.selectOption("#sigSel", "6/8 in 2");
  await spyClicks(page);
  await spySpeech(page);
  await page.click("#playBtn");
  await page.waitForTimeout(2600);
  const voice = (await spoken(page)).slice(0, 2);
  expect(voice.map((v) => v.n)).toEqual([1, 2]);                // "1 … 2"
  expect(voice[1].t - voice[0].t).toBeCloseTo(60 / 68, 2);
  const list = await clicks(page);
  expect(list[0].t).toBeCloseTo(voice[0].t, 3);
  for (const g of gaps(list.slice(0, 12))) expect(g).toBeCloseTo(60 / 68 / 3, 2);   // count bar clicks every eighth, like the song
});

test("the count-in plays the song's own click, even on beats the count skips", async ({ page }) => {
  await page.evaluate(() => {                                   // 2-bar count: "1 … 2 … 1 2 3 4"
    setBpm(240); state.countIn = 2; state.subdiv = 2; state.accents = [2, 1, 0, 1];   // eighths, beat 3 muted
  });
  await spyClicks(page);
  await spySpeech(page);
  await page.click("#playBtn");
  await page.waitForTimeout(3800);                              // 2 count bars + a song bar
  const list = await clicks(page), bar = 1, t0 = list[0].t;     // 4/4 at 240: a bar a second
  const inBar = (i) => list.filter((c) => c.t >= t0 + i * bar - 0.01 && c.t < t0 + (i + 1) * bar - 0.01)
    .map((c) => [+((c.t - t0 - i * bar) / (bar / 8)).toFixed(1), c.kind]);   // [eighth in the bar, kind]
  const song = inBar(2);
  expect(song).toEqual([[0, 2], [1, 0], [2, 1], [3, 0], [5, 0], [6, 1], [7, 0]]);
  expect(inBar(0)).toEqual(song);                               // "1 … 2" bar
  expect(inBar(1)).toEqual(song);                               // "1 2 3 4" bar
  const voice = (await spoken(page)).map((v) => [v.n, +((v.t - t0) / (bar / 4)).toFixed(1)]);
  expect(voice).toEqual([[1, 0], [2, 2], [1, 4], [2, 5], [3, 6], [4, 7]]);   // [number, beat]
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
  await page.evaluate(() => { state.sound = "stick"; });
  expect(await probe(page)).toEqual({ accent: [1, "n"], weak: [1, "n"], sub: [0.56, "n"] });   // 100% by default
  await page.click("#weakChip");
  expect(await probe(page)).toEqual({ accent: [1, "n"], weak: [0.5, "n"], sub: [0.28, "n"] });
  await page.evaluate(() => { state.accentPitch = true; });
  expect(await probe(page)).toEqual({ accent: [1, "a"], weak: [0.5, "n"], sub: [0.28, "s"] });
});

test("every synth sound is audible and doesn't clip", async ({ page }) => {
  const peaks = await page.evaluate(async () => {
    const out = {};
    for (const snd of ["wood", "rim", "cowbell", "blip", "beep", "click"]) {
      const off = new OfflineAudioContext(1, 22050, 44100);
      const saved = [ctx, clickBus, noiseBuf];
      ctx = off; clickBus = off.createGain(); clickBus.connect(off.destination); noiseBuf = null;
      state.sound = snd;
      clickAt(0.01, 2);
      const d = (await off.startRendering()).getChannelData(0);
      out[snd] = d.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
      [ctx, clickBus, noiseBuf] = saved;
    }
    return out;
  });
  for (const [snd, peak] of Object.entries(peaks)) {
    expect(peak, snd).toBeGreaterThan(0.3);
    expect(peak, snd).toBeLessThanOrEqual(1);
  }
});

test("click and voice have their own volume and mute, and both volumes survive a reload", async ({ page }) => {
  await initAudio(page);
  const levels = () => page.evaluate(() => new Promise((ok) =>
    setTimeout(() => ok([+clickBus.gain.value.toFixed(2), +voiceBus.gain.value.toFixed(2)]), 150)));
  expect(await levels()).toEqual([0.8, 0.8]);
  await page.fill("#voiceSlider", "40");
  await page.fill("#volSlider", "60");
  expect(await levels()).toEqual([0.6, 0.4]);
  await page.click("#voiceMuteBtn");
  expect(await levels()).toEqual([0.6, 0]);
  expect(await page.textContent("#voicePct")).toBe("Muted");
  await page.click("#muteBtn");
  await page.click("#voiceMuteBtn");
  expect(await levels()).toEqual([0, 0.4]);
  await page.evaluate(() => persistSettings());
  await page.reload();
  await open(page);
  expect(await page.evaluate(() => [state.vol, state.voiceVol, state.muted, state.voiceMuted])).toEqual([0.6, 0.4, false, false]);
});

test("the voice starts at the old single volume for settings saved before the voice knob", async ({ page }) => {
  await page.addInitScript(() =>      // before the app loads: a reload saves the current settings on the way out
    localStorage.setItem("setclick:settings", JSON.stringify({ sound: "click", vol: 0.5 })));
  await page.reload();
  await open(page);
  expect(await page.evaluate(() => [state.vol, state.voiceVol])).toEqual([0.5, 0.5]);
});

test("Output: Left/Right only put the click on one side at full level; Both matches it on each", async ({ page }) => {
  await page.evaluate(() => {                                   // keep hold of what feeds the speakers
    const real = AudioContext.prototype.createChannelMerger;
    AudioContext.prototype.createChannelMerger = function (n) { return (window.__out = real.call(this, n)); };
  });
  await initAudio(page);
  await page.evaluate(() => { state.sound = "beep"; });         // a pure tone: same peak every time
  const peaks = (output) => page.evaluate(async (output) => {
    state.output = output; applyOutput();
    const split = ctx.createChannelSplitter(2);
    __out.connect(split);
    const meters = [0, 1].map((ch) => { const a = ctx.createAnalyser(); split.connect(a, ch); return a; });
    const buf = new Float32Array(meters[0].fftSize), peak = [0, 0];
    await new Promise((r) => setTimeout(r, 60));                 // let the side gains settle
    clickAt(ctx.currentTime + 0.02, 2);
    for (const end = performance.now() + 300; performance.now() < end; await new Promise((r) => setTimeout(r, 10)))
      meters.forEach((a, ch) => { a.getFloatTimeDomainData(buf); for (const x of buf) peak[ch] = Math.max(peak[ch], Math.abs(x)); });
    __out.disconnect(split);
    return peak;
  }, output);
  const [left, both, right] = [await peaks("left"), await peaks("both"), await peaks("right")];
  expect(left[0]).toBeGreaterThan(0.2);
  expect(left[1]).toBeLessThan(0.001);
  expect(right[0]).toBeLessThan(0.001);
  expect(right[1]).toBeCloseTo(left[0], 2);
  expect(both[0]).toBeCloseTo(left[0], 2);                       // no quieter than one side alone
  expect(both[1]).toBeCloseTo(left[0], 2);
});

test("the Output choice survives a reload", async ({ page }) => {
  await page.click("#settingsBtn");
  await page.click('.out[data-out="left"]');
  await expect(page.locator('.out[data-out="left"]')).toHaveClass(/\bon\b/);
  await page.reload();
  await open(page);
  expect(await page.evaluate(() => state.output)).toBe("left");
  await expect(page.locator('.out[data-out="left"]')).toHaveClass(/\bon\b/);
});
