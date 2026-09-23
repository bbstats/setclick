// Tests run the real app in Chromium, served over HTTP so the service worker works.
const { defineConfig } = require("@playwright/test");

const PORT = 8765;

module.exports = defineConfig({
  testDir: "tests",
  timeout: 30000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}/`,
    browserName: "chromium",
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: `http://localhost:${PORT}/metronome.html`,
    reuseExistingServer: !process.env.CI,
    stderr: "ignore",               // http.server logs every request
  },
});
