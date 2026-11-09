/* ==========================================================================
   Ciak — copia locale dell'app (service worker)

   - L'app si apre anche se la rete è lenta o assente per un attimo.
   - Pagina ed elenco dei film: prima la rete (versione sempre aggiornata),
     la copia salvata solo se la rete non risponde.
   - Fotogrammi: una volta scaricati restano salvati (i loro nomi non cambiano mai).
   Questo file viene completato dalla build ({{BUILD}} e {{V}}).
   ========================================================================== */
const BUILD = '{{BUILD}}';
const V = '{{V}}';
const SHELL = 'ciak-shell-' + BUILD;
const IMAGES = 'ciak-img-v1';
const NET_TIMEOUT = 4500; // ms prima di usare la copia salvata

const PRECACHE = [
  './',
  'app.js?v=' + V,
  'style.css?v=' + V,
  'game.json',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('ciak-shell-') && key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const scopePath = new URL(self.registration.scope).pathname;
const rel = (url) => url.pathname.startsWith(scopePath) ? url.pathname.slice(scopePath.length) : url.pathname;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = rel(url);

  if (req.mode === 'navigate' || path === '' || path === 'index.html') {
    event.respondWith(networkFirst(req, './'));
  } else if (path === 'game.json') {
    event.respondWith(networkFirst(req, 'game.json', pruneImages));
  } else if (path.startsWith('f/')) {
    event.respondWith(cacheFirst(req, IMAGES));
  } else {
    event.respondWith(cacheFirst(req, SHELL));
  }
});

/** Rete con un tempo massimo; se non risponde (o è offline) usa la copia salvata. */
async function networkFirst(req, key, onFresh) {
  const cache = await caches.open(SHELL);
  // una richiesta di navigazione non si può copiare con opzioni: si riparte dall'indirizzo
  const fresh = req.mode === 'navigate'
    ? new Request(req.url, { cache: 'no-store', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-store' });
  const network = fetch(fresh).then(async (res) => {
    if (res.ok) {
      await cache.put(key, res.clone());
      if (onFresh) onFresh(res.clone()).catch(() => {});
    }
    return res;
  });
  const saved = cache.match(key);
  const timeout = new Promise((resolve) => setTimeout(resolve, NET_TIMEOUT));
  try {
    const first = await Promise.race([network, timeout]);
    if (first && first.ok) return first;
    if (first) { const s = await saved; return s || first; } // risposta di errore dal server
  } catch (err) { /* offline */ }
  const s = await saved;
  if (s) return s;
  return network; // nessuna copia: aspetta la rete (o fallisce come farebbe senza service worker)
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Tiene solo le immagini ancora usate dall'elenco dei film aggiornato. */
async function pruneImages(res) {
  const game = await res.json();
  const keep = new Set();
  for (const lv of game.levels || []) {
    for (const u of [...(lv.f || []), ...(lv.b || []), lv.th]) if (u) keep.add(u);
  }
  if (!keep.size) return;
  const cache = await caches.open(IMAGES);
  for (const req of await cache.keys()) {
    if (!keep.has(rel(new URL(req.url)))) await cache.delete(req);
  }
}
