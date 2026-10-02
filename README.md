# setclick
Planning-Center integrated metronome application

<img width="1595" height="899" alt="image" src="https://github.com/user-attachments/assets/b8e304ff-5fab-474c-b530-7594db7a3307" />

The app is `metronome.html`, with no build step. Host the repo anywhere static over HTTPS (for example GitHub Pages), open it on a phone or iPad, and add it to the home screen. After the first visit it works offline: `sw.js` caches the app, and your last-loaded set is kept on the device. Updates show up on the launch after they're published.

## Setup

1. Create a Planning Center [Personal Access Token](https://api.planningcenteronline.com/oauth/applications) (App ID + Secret).
2. Make a Cloudflare Worker that relays requests to `https://api.planningcenteronline.com`:
   - Save the App ID and Secret as Worker environment variables. The Worker adds the `Authorization: Basic …` header itself, so the app never sees your credentials.
   - Return CORS headers (`Access-Control-Allow-Origin`) so the browser can read the response.
   - **Only allow `GET` requests under `/services/v2/`.** Anyone who has the Worker URL can use it, so an open relay would expose your whole Planning Center account, People data included.
3. In SetClick, open Settings, paste the Worker URL, and tap **Connect**.

## Development

The app needs no build. The tests run it in headless Chromium (they need Node and Python 3):

```sh
npm install
npx playwright install chromium   # first time only
npm test                          # audio timing, sets/Planning Center sync, layout, offline
npm run screenshots               # iPad/iPhone screenshots into screenshots/
```

Tests also run on every pull request (GitHub Actions).

## Recording your own count-in voice

The spoken count-in is 12 short clips embedded in `metronome.html`. To use your own voice:

1. Record yourself saying **"one" through "twelve"** in one take. The app counts up to 12 in 7/8, 9/8 and 12/8.
   - Leave about **half a second of silence** between words.
   - Say them short and even, the way you'd count off a band. Don't stress "one"; the app does that.
   - Use a quiet room with the mic about a hand-span away, and keep the level out of the red. A phone voice memo is fine.
2. Convert it:

   ```sh
   node scripts/import-voice.js my-count.m4a      # WAV works as is; m4a/mp3 need ffmpeg
   ```

   This splits the take into words, trims and levels them, and finds where each vowel starts, so the word lands on the click. It then rewrites the voice in `metronome.html`.
3. Listen to `voice-preview/count-in.wav` (count-ins mixed against a click), then commit `metronome.html`.

Options: `--numbers 1-6` if you only recorded some numbers (counts past them are clicks only), `--pitch N` to shift the voice N semitones, and `--dry-run` to write the preview without touching the app.
