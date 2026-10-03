#!/usr/bin/env node
/* Replace SetClick's spoken count-in with your own recording.

   Record yourself saying "one, two, three, ... twelve" with a short pause
   between words, then:

     node scripts/import-voice.js my-count.m4a

   It splits the recording into words, trims and levels each one, finds where
   each vowel starts (that's the instant the app lines up with the click),
   and rewrites VOICE_B64 / VOICE_LEAD in metronome.html. It also writes
   voice-preview/ with each word and a count-in mixed against a click, so
   you can hear the timing before you open the app.

   Options:
     --numbers 1-6     which numbers the recording holds (default 1-12).
                       Numbers you leave out are dropped from the app, so a
                       count past them is clicks only.
     --pitch N         semitones the app shifts the voice (default 0)
     --rate HZ         sample rate of the stored clips (default 32000; 16000
                       halves the size but dulls "s", "t" and "f")
     --dry-run         write the preview only; leave metronome.html alone
     --preview DIR     where the preview goes (default voice-preview)

   Several files also work: one word per file, in counting order.
   WAV is read directly; any other format (m4a, mp3, ...) needs ffmpeg. */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SR = 16000;                    // analysis rate: splitting and vowel onsets are tuned at this rate
const PEAK = 0.92;
const HTML = path.join(__dirname, "..", "metronome.html");

/* ---------------- args ---------------- */
const args = process.argv.slice(2);
const opt = { numbers: "1-12", pitch: 0, rate: 32000, dryRun: false, preview: "voice-preview" };
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--numbers") opt.numbers = args[++i];
  else if (a === "--pitch") opt.pitch = Number(args[++i]);
  else if (a === "--rate") opt.rate = Number(args[++i]);
  else if (a === "--dry-run") opt.dryRun = true;
  else if (a === "--preview") opt.preview = args[++i];
  else if (a === "-h" || a === "--help") { usage(); process.exit(0); }
  else if (a.startsWith("--")) die(`unknown option ${a}`);
  else files.push(a);
}
if (!files.length) { usage(); process.exit(1); }
const range = /^(\d+)-(\d+)$/.exec(opt.numbers || "");
if (!range || +range[1] < 1 || +range[2] > 12 || +range[1] > +range[2]) die("--numbers wants a range like 1-12 or 1-6");
const NUMS = [];
for (let n = +range[1]; n <= +range[2]; n++) NUMS.push(n);
if (!Number.isFinite(opt.pitch) || Math.abs(opt.pitch) > 12) die("--pitch wants semitones, -12 to 12");
if (!Number.isInteger(opt.rate) || opt.rate < 16000 || opt.rate > 48000) die("--rate wants a sample rate from 16000 to 48000");
const OUT = opt.rate;                // rate of the stored clips

function usage() {
  console.log("usage: node scripts/import-voice.js <recording> [more files] [--numbers 1-12] [--pitch 0] [--rate 32000] [--dry-run]");
}
function die(msg) { console.error("import-voice: " + msg); process.exit(1); }

/* ---------------- decode ---------------- */
function hasFfmpeg() {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
}

// -> { sr, data }: mono, at the recording's own rate
// WAV is read here; anything else goes through ffmpeg into a float WAV at its own
// channel count. (ffmpeg's own mono downmix adds the channels at 0.7 each, which
// makes a stereo file look 3 dB hotter than it is and fakes clipping.)
function decode(file) {
  if (!fs.existsSync(file)) die(`no such file: ${file}`);
  let w = readWav(fs.readFileSync(file));
  if (!w) {
    if (!hasFfmpeg()) die(`${file}: can't read this format without ffmpeg — install ffmpeg, or export the recording as WAV`);
    let raw;
    try {
      raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-c:a", "pcm_f32le", "-f", "wav", "-"],
        { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { die(`${file}: ffmpeg couldn't read it (${String(e.stderr || e.message).trim().split("\n").pop()})`); }
    w = readWav(raw);
    if (!w) die(`${file}: couldn't decode the audio`);
  }
  if (w.peak > 0.99) console.warn(`warning: ${file} is clipped (too loud for the mic), which sounds harsh. Back off the mic or turn the input down.`);
  return { sr: w.sr, data: w.data };
}

function readWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let fmt = null, off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4), len = buf.readUInt32LE(off + 4), body = off + 8;
    if (id === "fmt ") {
      let tag = buf.readUInt16LE(body);
      if (tag === 0xfffe) tag = buf.readUInt16LE(body + 24);           // WAVE_FORMAT_EXTENSIBLE
      fmt = { tag, ch: buf.readUInt16LE(body + 2), sr: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data" && fmt) {
      const bps = fmt.bits / 8, frames = Math.floor(Math.min(len, buf.length - body) / (bps * fmt.ch));
      const read = fmt.tag === 3 && fmt.bits === 32 ? (o) => buf.readFloatLE(o)
        : fmt.tag !== 1 ? null
        : fmt.bits === 16 ? (o) => buf.readInt16LE(o) / 32768
        : fmt.bits === 24 ? (o) => buf.readIntLE(o, 3) / 8388608
        : fmt.bits === 32 ? (o) => buf.readInt32LE(o) / 2147483648
        : fmt.bits === 8 ? (o) => (buf[o] - 128) / 128 : null;
      if (!read) return null;
      const data = new Float32Array(frames);
      let peak = 0;
      for (let i = 0; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < fmt.ch; c++) {
          const v = read(body + (i * fmt.ch + c) * bps);
          s += v; peak = Math.max(peak, Math.abs(v));
        }
        data[i] = s / fmt.ch;
      }
      return { sr: fmt.sr, data, peak };
    }
    off = body + len + (len & 1);
  }
  return null;
}

// Windowed-sinc resampler: recording rate -> SR and OUT, and --pitch in the preview.
function resample(x, from, to) {
  if (from === to) return Float32Array.from(x);
  const ratio = to / from, n = Math.floor(x.length * ratio);
  const fc = Math.min(1, ratio) * 0.95, width = Math.ceil(24 / fc);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const c = i / ratio, j0 = Math.max(0, Math.ceil(c - width)), j1 = Math.min(x.length - 1, Math.floor(c + width));
    let s = 0, ws = 0;
    for (let j = j0; j <= j1; j++) {
      const t = c - j, u = t / width;
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * fc * t) / (Math.PI * fc * t);
      const w = sinc * (0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u));
      s += x[j] * w; ws += w;
    }
    out[i] = ws ? s / ws : 0;
  }
  return out;
}

// RBJ high-pass, run forward: removes DC, handling noise and mic rumble.
function highpass(x, f0, rate) {
  const w = 2 * Math.PI * f0 / rate, q = Math.SQRT1_2, al = Math.sin(w) / (2 * q), cw = Math.cos(w);
  const a0 = 1 + al, b0 = (1 + cw) / 2 / a0, b1 = -(1 + cw) / a0, b2 = b0, a1 = -2 * cw / a0, a2 = (1 - al) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/* ---------------- analysis ---------------- */
const dB = (v) => 20 * Math.log10(v + 1e-9);
function frames(x, win, hop) {               // [{rms, zcr}] per hop
  const out = [];
  for (let s = 0; s + win <= x.length; s += hop) {
    let e = 0, z = 0;
    for (let i = s; i < s + win; i++) {
      e += x[i] * x[i];
      if (i > s && (x[i] >= 0) !== (x[i - 1] >= 0)) z++;
    }
    out.push({ rms: Math.sqrt(e / win), zcr: z / win });
  }
  return out;
}
function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
const fmtT = (s) => s.toFixed(2) + "s";

// Find the words in one long take. Returns [{a, b, edge}]: sample ranges, and the
// level (linear RMS) just above the room noise.
function splitWords(x, want, label) {
  const HOP = SR / 100;                                    // 10 ms
  const db = frames(x, HOP, HOP).map((f) => dB(f.rms));
  if (!db.length) die("the recording is empty");
  const floor = Math.max(-75, percentile(db, 0.1)), peak = Math.max(...db);   // clamp: digital silence isn't a room
  if (peak - floor < 20) console.warn(`warning: only ${(peak - floor).toFixed(0)} dB between the words and the background. A quieter room or closer mic will sound cleaner.`);
  const thr = floor + Math.max(8, 0.35 * (peak - floor));

  let runs = [];
  for (let i = 0, start = -1; i <= db.length; i++) {
    const on = i < db.length && db[i] > thr;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push({ a: start, b: i, peak: Math.max(...db.slice(start, i)) }); start = -1; }
  }
  // glue "si...x" back together, drop breaths and mouth clicks
  const glue = (rs, gap) => rs.reduce((o, r) => {
    const last = o[o.length - 1];
    if (last && r.a - last.b <= gap) { last.b = r.b; last.peak = Math.max(last.peak, r.peak); } else o.push({ ...r });
    return o;
  }, []);
  runs = glue(runs, 20);
  const loud = percentile(runs.map((r) => r.peak), 0.5);
  runs = runs.filter((r) => r.b - r.a >= 6 && r.peak > loud - 18);
  if (runs.length !== want) {
    console.error(`Found ${runs.length} words in ${label}, expected ${want === 1 ? 1 : `${want} (${NUMS[0]}–${NUMS[NUMS.length - 1]})`}:`);
    runs.forEach((r, i) => console.error(`  ${i + 1}: ${fmtT(r.a / 100)} – ${fmtT(r.b / 100)}`));
    die(runs.length < want
      ? "some words ran together. Leave about half a second of silence between words and record again."
      : "there's extra sound in the recording (a cough, a bump, talking). Trim it out, or re-record in a quieter spot. " +
        "If you recorded fewer numbers on purpose, say which with --numbers, e.g. --numbers 1-6.");
  }
  // widen each word to catch quiet edges ("s", "f", "th" and the tail of the vowel)
  const edge = floor + 6;
  return runs.map((r, i) => {
    const lo = i ? runs[i - 1].b : 0, hi = i + 1 < runs.length ? runs[i + 1].a : db.length;
    let a = r.a, b = r.b;
    while (a > lo && r.a - a < 15 && db[a - 1] > edge) a--;
    while (b < hi && b - r.b < 20 && db[b] > edge) b++;
    return { a: Math.max(0, a * HOP - SR * 0.005), b: Math.min(x.length, b * HOP + SR * 0.02), edge: 10 ** (edge / 20) };
  });
}

// Seconds from the clip start to the vowel onset: the first loud, voiced frame.
// Fricatives ("s" in six/seven, "f" in four/five, "th" in three) are noisy and
// cross zero far more often, so they don't count as the onset.
function vowelOnset(clip) {
  const WIN = SR * 0.02, HOP = SR * 0.005;
  const f = frames(clip, WIN, HOP);
  const top = Math.max(...f.map((v) => v.rms));
  for (let i = 0; i < f.length; i++) {
    if (f[i].rms >= 0.3 * top && f[i].zcr < 0.2) return (i * HOP + WIN / 2) / SR;
  }
  return 0;
}

/* ---------------- shaping & output ---------------- */
// Cut one word out: at most PRE of consonant before the vowel (longer is a breath
// or a bump, which would play ahead of the beat), at most 0.8 s overall.
// Works on the analysis signal; returns the span in seconds.
function trim(x, { a, b, edge }) {
  const PRE = 0.16, HOP = SR / 100;
  a = Math.round(a); b = Math.round(b);
  const on = a + Math.round(vowelOnset(x.slice(a, b)) * SR);
  if (on - a > PRE * SR) {
    let s = on;
    while (s - HOP >= a && on - s < PRE * SR && rmsOf(x, s - HOP, s) > edge) s -= HOP;
    a = Math.max(a, s - Math.round(SR * 0.005));
  }
  return { a: a / SR, b: Math.min(b, a + Math.round(SR * 0.8)) / SR };
}
function cut(x, { a, b }, rate) {
  const clip = x.slice(Math.round(a * rate), Math.round(b * rate));
  const fin = Math.round(rate * 0.003), fout = Math.min(Math.round(rate * 0.03), clip.length >> 2);
  for (let i = 0; i < fin; i++) clip[i] *= i / fin;
  for (let i = 0; i < fout; i++) clip[clip.length - 1 - i] *= i / fout;
  return clip;
}
const peakOf = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
function rmsOf(x, a, b) {
  let e = 0; a = Math.max(0, a); b = Math.min(x.length, b);
  for (let i = a; i < b; i++) e += x[i] * x[i];
  return Math.sqrt(e / Math.max(1, b - a));
}

function wav16(x, rate) {
  const buf = Buffer.alloc(44 + x.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + x.length * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + i * 2);
  return buf;
}

// Count-ins mixed the way the app plays them (speakAt in metronome.html), with a plain click.
function renderPreview(clips, leads) {
  const rate = Math.pow(2, opt.pitch / 12);
  const shifted = clips.map((c) => resample(c, OUT * rate, OUT));      // played faster = higher
  const parts = [[100, [1, 2, 3, 4]], [150, [1, 2, 3, 4]], [126, NUMS]];
  const events = [];
  let t = 0.3;
  for (const [bpm, ns] of parts) {
    const gap = 60 / bpm;
    for (let i = 0; i < ns.length; i++) {
      events.push({ t, n: ns[i], gap, accent: i === 0 });
      t += gap;
    }
    t += 0.8;
  }
  const out = new Float32Array(Math.ceil((t + 0.5) * OUT));
  for (const e of events) {
    const at = Math.round(e.t * OUT);
    for (let i = 0; i < OUT * 0.02; i++) out[at + i] += 0.3 * Math.sin(2 * Math.PI * (e.accent ? 1600 : 1000) * i / OUT) * (1 - i / (OUT * 0.02));
    const k = NUMS.indexOf(e.n);
    if (k < 0) continue;
    const src = shifted[k], lead = leads[k] / rate;
    const st = Math.round((e.t - lead) * OUT), vol = (e.accent ? 1.6 : 1.05) * 0.5;
    const dur = Math.min(src.length, Math.round((lead + e.gap * 0.92) * OUT)), fade = Math.round(OUT * 0.03);
    for (let i = 0; i < dur; i++) {
      const g = dur < src.length && i > dur - fade ? (dur - i) / fade : 1;
      if (st + i >= 0) out[st + i] += src[i] * vol * g;
    }
  }
  const p = peakOf(out);
  if (p > 0.98) for (let i = 0; i < out.length; i++) out[i] *= 0.98 / p;
  return out;
}

/* ---------------- main ---------------- */
// Find words and onsets at SR (what the detection is tuned for); cut the stored clips at OUT.
function load(f) {
  const w = decode(f);
  return { a: highpass(resample(w.data, w.sr, SR), 70, SR), o: highpass(resample(w.data, w.sr, OUT), 70, OUT) };
}
let parts;
if (files.length === 1) {
  const x = load(files[0]);
  parts = splitWords(x.a, NUMS.length, files[0]).map((r) => ({ x, span: trim(x.a, r) }));
} else {
  if (files.length !== NUMS.length) die(`got ${files.length} files for ${NUMS.length} numbers (${opt.numbers})`);
  parts = files.map((f) => {
    const x = load(f);
    return { x, span: trim(x.a, splitWords(x.a, 1, f)[0]) };
  });
}

const leads = parts.map(({ x, span }) => vowelOnset(cut(x.a, span, SR)));
let clips = parts.map(({ x, span }) => cut(x.o, span, OUT));
// Even out loudness: match the vowels' level, but never push a word past PEAK.
const vowelRms = clips.map((c, i) => rmsOf(c, Math.round(leads[i] * OUT), Math.round((leads[i] + 0.15) * OUT)));
const target = percentile(clips.map((c, i) => vowelRms[i] * PEAK / peakOf(c)), 0.5);
clips = clips.map((c, i) => {
  const g = Math.min(PEAK / peakOf(c), target / vowelRms[i]);
  return c.map((v) => v * g);
});

console.log(" #   length   vowel at   level");
clips.forEach((c, i) => console.log(
  `${String(NUMS[i]).padStart(2)}   ${fmtT(c.length / OUT).padStart(6)}   ${fmtT(leads[i]).padStart(8)}   ${dB(peakOf(c)).toFixed(1).padStart(5)} dB`));
const long = clips.map((c, i) => [NUMS[i], c.length / OUT]).filter(([, d]) => d > 0.6);
if (long.length) console.warn(`note: ${long.map(([n]) => n).join(", ")} ran long. Fast count-ins cut words off anyway, but short, punchy words sound tighter.`);
const late = leads.map((l, i) => [NUMS[i], l]).filter(([, l]) => l > 0.2);
if (late.length) console.warn(`note: the vowel starts late in ${late.map(([n]) => n).join(", ")} — check the preview; a breath or noise before the word can do this.`);

fs.mkdirSync(opt.preview, { recursive: true });
clips.forEach((c, i) => fs.writeFileSync(path.join(opt.preview, `${NUMS[i]}.wav`), wav16(c, OUT)));
fs.writeFileSync(path.join(opt.preview, "count-in.wav"), wav16(renderPreview(clips, leads), OUT));
console.log(`\nPreview: ${path.join(opt.preview, "count-in.wav")} (1-2-3-4 at 100 and 150 BPM, then every number at 126 BPM)`);

if (opt.dryRun) { console.log("Dry run: metronome.html not changed."); process.exit(0); }

let html = fs.readFileSync(HTML, "utf8");
const b64 = "{" + clips.map((c, i) => `"${NUMS[i]}": "${wav16(c, OUT).toString("base64")}"`).join(", ") + "}";
const lead = "{" + leads.map((l, i) => `"${NUMS[i]}": ${+l.toFixed(3)}`).join(", ") + "}";
const swap = (re, line, what) => {
  if (!re.test(html)) die(`couldn't find ${what} in metronome.html`);
  html = html.replace(re, () => line);
};
swap(/^const VOICE_B64 = \{.*\};$/m, `const VOICE_B64 = ${b64};`, "VOICE_B64");
swap(/^const VOICE_LEAD = \{.*\};$/m, `const VOICE_LEAD = ${lead};`, "VOICE_LEAD");
swap(/^const VOICE_PITCH_ST = -?[\d.]+;.*$/m,
  `const VOICE_PITCH_ST = ${opt.pitch};                    // semitones over the recording (scripts/import-voice.js --pitch)`, "VOICE_PITCH_ST");
fs.writeFileSync(HTML, html);
console.log(`Updated metronome.html with numbers ${NUMS[0]}–${NUMS[NUMS.length - 1]}.`);
