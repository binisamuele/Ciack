/* ==========================================================================
   Ciak — copia locale dell'app (service worker)

   - L'app si apre anche se la rete è lenta o assente per un attimo.
   - Pagina: si apre subito dalla copia salvata e intanto si aggiorna dalla rete
     (una nuova versione dell'app si vede dall'apertura successiva).
   - Elenco dei film: prima la rete, la copia salvata solo se la rete non risponde.
   - Fotogrammi: mai salvati qui. Li gestisce la cache normale del browser, che ha una
     scadenza (vedi _headers) e viene svuotata dal telefono da solo: se non giochi per un
     po', sul telefono restano solo questa copia dell'app e i progressi.
   Questo file viene completato dalla build ({{BUILD}} e {{V}}).
   ========================================================================== */
const BUILD = '{{BUILD}}';
const V = '{{V}}';
const SHELL = 'ciak-shell-' + BUILD;
const OLD_IMAGES = 'ciak-img-v1'; // vecchia raccolta dei fotogrammi: non più usata, va cancellata
const NET_TIMEOUT = 3000; // ms prima di usare la copia salvata

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
      if (key === OLD_IMAGES || (key.startsWith('ciak-shell-') && key !== SHELL)) await caches.delete(key);
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
    event.respondWith(shellFirst(event));
  } else if (path === 'game.json') {
    event.respondWith(networkFirst(req, 'game.json'));
  } else if (path.startsWith('f/')) {
    return; // fotogrammi: direttamente dalla rete, senza copia permanente
  } else {
    event.respondWith(cacheFirst(req, SHELL));
  }
});

/** La pagina: subito la copia salvata, aggiornata in sottofondo per la prossima apertura. */
async function shellFirst(event) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match('./');
  const network = fetch(new Request(event.request.url, { cache: 'no-store', credentials: 'same-origin' })).then(async (res) => {
    if (res.ok) await cache.put('./', res.clone());
    return res;
  });
  if (!saved) return network;
  event.waitUntil(network.catch(() => {}));
  return saved;
}

/** Rete con un tempo massimo; se non risponde (o è offline) usa la copia salvata. */
async function networkFirst(req, key) {
  const cache = await caches.open(SHELL);
  // una richiesta di navigazione non si può copiare con opzioni: si riparte dall'indirizzo
  const fresh = req.mode === 'navigate'
    ? new Request(req.url, { cache: 'no-store', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-store' });
  const network = fetch(fresh).then(async (res) => {
    if (res.ok) await cache.put(key, res.clone());
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
