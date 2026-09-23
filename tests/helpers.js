// Shared helpers. The app's top-level `let`/`const`/functions (state, clickAt,
// loadSong, …) are globals, so page.evaluate can read and wrap them by name.

async function open(page) {
  await page.goto("metronome.html");
  await page.waitForFunction(() => typeof state !== "undefined" && state.set && state.songIx >= 0);
}

// Create the AudioContext (as a tap would) and wait for the stick samples to decode.
async function initAudio(page) {
  await page.evaluate(() => initAudio());
  await page.waitForFunction(() => stickBufs.n && stickBufs.a && stickBufs.s);
}

// Record the scheduled time and kind of every click from here on.
async function spyClicks(page) {
  await page.evaluate(() => {
    window.__clicks = [];
    const real = clickAt;
    window.clickAt = (t, kind) => { __clicks.push({ t, kind }); real(t, kind); };
  });
}
const clicks = (page) => page.evaluate(() => __clicks);
const gaps = (list) => list.slice(1).map((c, i) => c.t - list[i].t);

// Fake Planning Center: one service type, one plan, songs from window.__items
// ([id, title, bpm, meter] rows). Change __items to simulate edits upstream.
async function mockPco(page, items) {
  await page.evaluate((items) => {
    window.__items = items;
    window.pco = async (path) => {
      if (path.includes("/items")) {
        const included = [];
        const data = __items.map(([id, title, bpm, meter]) => {
          included.push({ type: "Song", id: "s" + id, attributes: { title } },
                        { type: "Arrangement", id: "a" + id, attributes: { bpm, meter } });
          return { id, attributes: { item_type: "song", title, key_name: "G" },
                   relationships: { song: { data: { type: "Song", id: "s" + id } },
                                    arrangement: { data: { type: "Arrangement", id: "a" + id } } } };
        });
        return { data, included };
      }
      if (path.includes("/plans")) return { data: [{ id: "p1", attributes: { dates: "Sep 28", title: "" } }] };
      return { data: [{ id: "st1", attributes: { name: "Sunday AM" } }] };
    };
    state.creds.relay = "https://relay.test";
  }, items);
}

module.exports = { open, initAudio, spyClicks, clicks, gaps, mockPco };
