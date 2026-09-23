// Standard PR screenshots: `npm run screenshots` → screenshots/*.png
const { chromium } = require("@playwright/test");
const { spawn } = require("child_process");
const fs = require("fs");

const PORT = 8766;
const SHOTS = [
  ["ipad-landscape", 1180, 820],
  ["iphone", 390, 844],
  ["phone-landscape", 844, 390],
];

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  fs.mkdirSync("screenshots", { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    for (const [name, width, height] of SHOTS) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
      await page.goto(`http://localhost:${PORT}/metronome.html`);
      await page.waitForFunction(() => typeof state !== "undefined" && state.songIx >= 0);
      await page.screenshot({ path: `screenshots/${name}-main.png` });
      await page.click("#settingsBtn");
      await page.waitForTimeout(350);
      await page.screenshot({ path: `screenshots/${name}-settings.png` });
      await page.evaluate(() => closeSheets());
      await page.click("#setPill");
      await page.waitForTimeout(350);
      await page.screenshot({ path: `screenshots/${name}-set.png` });
      await page.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  console.log("Saved to screenshots/");
})();
