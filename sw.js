/* SetClick service worker: makes the app open with no network.
   The app page is served from cache and only replaced by checkUpdate(), which the
   page calls on launch: that way the page can say "update available" when it was.
   Other same-origin files are served from cache and refreshed in the background.
   Planning Center calls go to the relay (another origin) and are never cached. */
const CACHE = "setclick-v1";
const PAGE = "metronome.html";
const PRECACHE = [
  "metronome.html",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Fetch the page past every cache; if it differs from the cached copy (the one the
// open app is running), store it and answer "updated". Otherwise "same" (or "offline").
async function checkUpdate() {
  const c = await caches.open(CACHE), url = new URL(PAGE, self.registration.scope).href;
  let res;
  try { res = await fetch(url, { cache: "no-cache" }); } catch (err) { return new Response("offline"); }
  if (!res.ok) return new Response("offline");
  const old = await c.match(url);
  const [fresh, cur] = await Promise.all([res.clone().text(), old ? old.text() : null]);
  if (fresh === cur) return new Response("same");
  await c.put(url, res);
  return new Response(cur === null ? "same" : "updated");      // first copy: nothing to update from
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  const isPage = url.pathname.endsWith("/" + PAGE);
  if (isPage && url.searchParams.has("check-update")) { e.respondWith(checkUpdate()); return; }
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit && isPage) return hit;             // replaced only by checkUpdate()
    const net = fetch(req).then((res) => {
      if (res.ok) e.waitUntil(c.put(req, res.clone()).catch(() => {}));   // full storage, partial response…
      return res;
    });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
