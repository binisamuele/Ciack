/* ==========================================================================
   Ciak — indovina il film da 5 fotogrammi
   ========================================================================== */
(() => {
  'use strict';

  const MAX = 5;
  const KEY = 'ciak.v1';
  // Formato del riquadro: segue quello dei fotogrammi ma resta entro questi limiti.
  // Fuori dai limiti l'immagine riempie il riquadro e i bordi vengono rifilati (niente bande nere).
  const RATIO_MIN = 4 / 3;  // immagini più "quadrate" di 4:3
  const RATIO_MAX = 2;      // immagini più larghe di 2:1 (es. cinemascope 2.39:1)
  const SUG_MIN = 2;        // lettere da scrivere prima di vedere i suggerimenti
  const SUG_MAX = 3;        // suggerimenti mostrati al massimo
  const SKIP_LOCK = 700;    // ms in cui "Salta" non risponde dopo un tentativo (evita il doppio tocco)
  const ARTICLES = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'uno', 'una', 'the', 'a', 'an']);
  const doc = document;
  const root = doc.documentElement;
  const $ = (s, r = doc) => r.querySelector(s);
  const $$ = (s, r = doc) => Array.from(r.querySelectorAll(s));
  const mq = (q) => !!(window.matchMedia && window.matchMedia(q).matches);
  const REDUCED = mq('(prefers-reduced-motion: reduce)');
  const COARSE = mq('(pointer: coarse)');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    skip: '<svg viewBox="0 0 24 24"><path d="M5 6.5v11l7-5.5zM12.5 6.5v11l7-5.5z" class="solid"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2"/></svg>',
    film: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="3"/><path d="M7.5 4v16M16.5 4v16M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="m12 3.6 2.55 5.2 5.7.83-4.13 4.02.98 5.67L12 16.64l-5.1 2.68.98-5.67-4.13-4.02 5.7-.83z" class="solid"/></svg>',
    trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/></svg>',
  };

  /* ------------------------------------------------------------ storage */

  const store = (() => {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* privato */ }
    if (!data || typeof data !== 'object') data = {};
    if (!data.levels || typeof data.levels !== 'object') data.levels = {};
    return {
      data,
      save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* pieno o bloccato */ } },
      reset() { data.levels = {}; delete data.seed; this.save(); },
    };
  })();

  /* -------------------------------------------------------------- testo */

  /** Normalizza e tiene la mappa degli indici verso la stringa originale (per evidenziare). */
  function normMap(str) {
    let n = '';
    const map = [];
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (/['\u2019\u2018`\u00b4]/.test(ch)) continue;
      const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (const c of base) {
        if (/[\p{L}\p{N}]/u.test(c)) { n += c; map.push(i); }
        else if (n && n[n.length - 1] !== ' ') { n += ' '; map.push(i); }
      }
    }
    if (n.endsWith(' ')) { n = n.slice(0, -1); map.pop(); }
    return { n, map };
  }
  const norm = (s) => normMap(String(s || '')).n;

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function isCorrect(guess, ans) {
    const g = norm(guess).replace(/ (18|19|20)\d\d$/, '');
    if (!g) return false;
    const options = [ans.t, ...(ans.a || [])].map(norm).filter(Boolean);
    if (options.includes(g)) return true;
    return options.some((o) => o.length >= 6 && lev(g, o) <= Math.floor(o.length / 7));
  }

  /* -------------------------------------------------------------- dati */

  function keystream(id, n) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
    let a = h >>> 0;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      out[i] = ((t ^ (t >>> 14)) >>> 0) & 255;
    }
    return out;
  }
  function decode(id, b64) {
    const bin = atob(b64);
    const ks = keystream(id, bin.length);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) ^ ks[i];
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  async function loadGame() {
    if (window.__CIAK__) return window.__CIAK__;
    const res = await fetch('game.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('game.json ' + res.status);
    return res.json();
  }

  /* ----------------------------------------------------------- feedback */

  let hapticLabel = null;
  const haptic = (kind = 'light') => {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(kind === 'error' ? [16, 70, 16] : kind === 'success' ? [10, 60, 22] : 8);
        return;
      }
      // iOS 18+: il toggle di un <input switch> produce un feedback aptico (un solo elemento, riusato)
      if (!hapticLabel) {
        hapticLabel = doc.createElement('label');
        hapticLabel.ariaHidden = 'true';
        hapticLabel.style.display = 'none';
        const input = doc.createElement('input');
        input.type = 'checkbox';
        input.setAttribute('switch', '');
        hapticLabel.appendChild(input);
        doc.head.appendChild(hapticLabel);
      }
      const tick = () => hapticLabel.click();
      tick();
      if (kind === 'error' || kind === 'success') setTimeout(tick, 120);
    } catch (e) { /* niente aptica */ }
  };

  let toastTimer = 0;
  function toast(msg) {
    const t = el.toast;
    clearTimeout(toastTimer);
    t.innerHTML = `<span>${esc(msg)}</span>`;
    t.classList.remove('out');
    t.hidden = false;
    t.style.animation = 'none';
    void t.offsetWidth;
    t.style.animation = '';
    toastTimer = setTimeout(() => {
      t.classList.add('out');
      toastTimer = setTimeout(() => { t.hidden = true; }, 320);
    }, 1800);
  }

  function restartAnim(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  /* ------------------------------------------------------------ elementi */

  const el = {
    app: $('#app'), ambient: $('#ambient'), pill: $('#pill'), stage: $('#stage'),
    play: $('#play'), screen: $('#screen'), frame: $('#frame'), tabs: $('#tabs'),
    guesses: $('#guesses'), composer: $('#composer'), form: $('#form'), input: $('#guess'),
    clear: $('#clear'), send: $('#send'), suggest: $('#suggest'), result: $('#result'),
    scrim: $('#scrim'), sheetLevels: $('#sheetLevels'),
    lvGrid: $('#lvGrid'), lvSub: $('#lvSub'), btnReset: $('#btnReset'),
    alert: $('#alert'), lightbox: $('#lightbox'), lbStage: $('#lbStage'), lbImg: $('#lbImg'),
    toast: $('#toast'), confetti: $('#confetti'), field: $('.field'),
  };
  const fimgs = $$('.fimg', el.frame);
  const ambImgs = $$('img', el.ambient);
  const tabBtns = $$('.tab', el.tabs);
  const lens = $('.lens', el.tabs);
  const flash = $('.frame-flash', el.frame);

  /* --------------------------------------------------------------- stato */

  let G = null;          // dati del gioco
  let INDEX = [];        // indice dei titoli per i suggerimenti
  let view = -1;         // livello mostrato
  let frameIdx = 0;      // fotogramma mostrato
  let mode = 'loading';  // play | finale | empty | error
  let sugList = [];
  let sugActive = -1;
  let busy = false;
  let skipLockUntil = 0;
  let suppressFrameClick = 0;

  const lvAt = (i) => G.levels[i];
  const stOf = (lv) => store.data.levels[lv.id] || { g: [], d: false, w: false };
  const curLv = () => lvAt(view);
  const curSt = () => stOf(curLv());
  const currentIndex = () => {
    const i = G.levels.findIndex((lv) => !stOf(lv).d);
    return i === -1 ? G.levels.length : i;
  };
  const isUnlocked = (i) => i <= currentIndex();
  const countWon = () => G.levels.filter((lv) => stOf(lv).w).length;
  const countDone = () => G.levels.filter((lv) => stOf(lv).d).length;

  function prepare(game) {
    game.levels.forEach((lv) => { lv.ans = decode(lv.id, lv.x); });
    INDEX = game.titles.map((t) => {
      const { n, map } = normMap(t.t);
      const first = n.indexOf(' ');
      const core = first > 0 && ARTICLES.has(n.slice(0, first)) ? first + 1 : 0; // inizio dopo l'articolo
      return { t: t.t, y: t.y, n, map, core, ns: n.replace(/ /g, '') };
    }).filter((t) => t.n);
  }

  /** Ordine dei film: quelli finiti nell'ordine in cui li ha giocati, poi quello in corso,
   *  poi i nuovi in un ordine casuale che resta sempre uguale su questo telefono. */
  function orderLevels() {
    if (!store.data.seed) { store.data.seed = Math.random().toString(36).slice(2, 10); store.save(); }
    const seed = store.data.seed;
    const base = new Map(G.levels.map((lv, i) => [lv.id, i]));
    const key = (lv) => {
      let h = 2166136261;
      const s = seed + lv.id;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      return h >>> 0;
    };
    const rank = (lv) => { const st = stOf(lv); return st.d ? 0 : st.g.length ? 1 : 2; };
    G.levels.sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (stOf(a).t || 0) - (stOf(b).t || 0) || base.get(a.id) - base.get(b.id);
      if (ra === 1) return base.get(a.id) - base.get(b.id);
      return key(a) - key(b);
    });
  }

  /* ------------------------------------------------------------ viewport */

  let baseH = 0; // altezza senza tastiera
  function syncViewport() {
    const vv = window.visualViewport;
    if (vv && vv.scale > 1.01) return; // zoom manuale: non toccare
    const h = vv ? vv.height : window.innerHeight;
    const top = vv ? Math.max(0, vv.offsetTop) : 0;
    const focused = doc.activeElement === el.input;
    if (!focused || h > baseH) baseH = h;
    root.style.setProperty('--vvh', Math.round(h) + 'px');
    el.app.style.transform = top ? `translate3d(0, ${Math.round(top)}px, 0)` : '';
    // tastiera a schermo aperta: lo spazio visibile si è ridotto mentre si scrive
    doc.body.classList.toggle('kb', focused && baseH - h > 150);
    if (!el.suggest.hidden) sizeSuggest();
  }

  function setKeyboard() {
    syncViewport();
    setTimeout(syncViewport, 350);
  }

  /* ------------------------------------------------------------- ambient */

  let ambLayer = 0;
  function setAmbient(src) {
    if (!src) return;
    const cur = ambImgs[ambLayer];
    if (cur.dataset.src === src) return;
    const next = ambImgs[1 - ambLayer];
    next.dataset.src = src;
    next.onload = () => {
      if (next.dataset.src !== src) return;
      next.classList.add('on');
      cur.classList.remove('on');
      ambLayer = 1 - ambLayer;
    };
    next.src = src;
  }

  /* ------------------------------------------------------------- frames */

  let frameLayer = 0;
  let frameToken = 0;
  /** dir: 1 = arriva da destra (avanti), -1 = da sinistra (indietro), 0 = dissolvenza sul posto */
  function showFrame(k, dir = 0) {
    const lv = curLv();
    frameIdx = k;
    const src = lv.f[k];
    const cur = fimgs[frameLayer];
    el.ambient.classList.toggle('raw', !lv.pb);
    setAmbient(lv.b[k]);
    renderTabs();
    if (cur.dataset.src === src && cur.classList.contains('on')) return;
    const next = fimgs[1 - frameLayer];
    const token = ++frameToken;
    // posizione di partenza del nuovo fotogramma, senza animazione
    next.style.transition = 'none';
    next.classList.remove('on');
    next.style.setProperty('--from', `${dir * 56}px`);
    void next.offsetWidth;
    next.style.transition = '';
    cur.style.setProperty('--from', `${-dir * 56}px`); // quello vecchio esce dal lato opposto
    next.dataset.src = src;
    next.src = src;
    const done = () => {
      if (token !== frameToken) return;
      if (!lv.ar && next.naturalWidth) setRatio(next.naturalWidth / next.naturalHeight);
      next.classList.add('on');
      cur.classList.remove('on');
      frameLayer = 1 - frameLayer;
      el.frame.classList.remove('loading');
    };
    if (next.decode) next.decode().then(done, () => (next.complete ? done() : next.addEventListener('load', done, { once: true })));
    else next.addEventListener('load', done, { once: true });
  }

  function setRatio(r) {
    root.style.setProperty('--arn', clamp(r || 16 / 9, RATIO_MIN, RATIO_MAX).toFixed(4));
  }

  const warm = [];
  function warmUp(src) {
    if (!src || warm.some((i) => i.src.endsWith(src))) return;
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    warm.push(img);
    if (warm.length > 24) warm.shift();
  }

  function preload(lv, upto) {
    for (let k = 0; k <= Math.min(upto, MAX - 1); k++) warmUp(lv.f[k]);
  }

  /** Primo fotogramma e sfondo di un film, per aprirlo senza attese. */
  function preloadStart(lv) {
    if (!lv) return;
    warmUp(lv.f[0]);
    warmUp(lv.b[0]);
  }

  /* --------------------------------------------------------------- render */

  function renderPill() {
    if (mode === 'play') {
      el.pill.innerHTML = `<span class="pill-k">Film</span><span class="pill-n">${view + 1}</span><span class="pill-t">di ${G.levels.length}</span>`;
    } else if (mode === 'finale') {
      el.pill.innerHTML = `<span class="pill-k">Completato</span><span class="pill-dot"></span><span class="pill-n">${countWon()}</span><span class="pill-t">/ ${G.levels.length}</span>`;
    }
    restartAnim(el.pill, 'bump');
  }

  function unlockedCount(st) { return st.d ? MAX : Math.min(st.g.length + 1, MAX); }

  function renderTabs() {
    const st = curSt();
    const unlocked = unlockedCount(st);
    tabBtns.forEach((b, k) => {
      b.className = 'tab';
      if (k >= unlocked) b.classList.add('locked');
      if (k < st.g.length) {
        const g = st.g[k];
        const isWin = st.w && k === st.g.length - 1;
        b.classList.add(isWin ? 'ok' : g === '' ? 'skip' : 'wrong');
        if (isWin && st.g.length === 1) b.classList.add('gold');
      }
      b.setAttribute('aria-selected', String(k === frameIdx));
      b.setAttribute('aria-label', `Fotogramma ${k + 1}${k >= unlocked ? ' (bloccato)' : ''}`);
    });
    const prev = Number(lens.style.getPropertyValue('--i') || 0);
    lens.style.setProperty('--i', frameIdx);
    if (prev !== frameIdx && !REDUCED && lens.firstElementChild.animate) {
      const s = Math.min(1 + Math.abs(prev - frameIdx) * 0.18, 1.6);
      lens.firstElementChild.animate(
        [{ transform: 'scale(1,1)' }, { transform: `scale(${s}, ${2 - s * 0.95})`, offset: 0.35 }, { transform: 'scale(1,1)' }],
        { duration: 560, easing: 'cubic-bezier(.3,1.2,.4,1)' },
      );
    }
  }

  /** Cinque caselle fisse: tentativi fatti, tentativo attuale, tentativi rimasti. */
  function renderGuesses(animateLast = false) {
    const st = curSt();
    const n = st.g.length;
    const rows = [];
    for (let k = 0; k < MAX; k++) {
      let cls = 'empty', ico = '', txt = '';
      if (k < n) {
        const g = st.g[k];
        if (st.w && k === n - 1) { cls = n === 1 ? 'ok gold' : 'ok'; ico = n === 1 ? ICON.star : ICON.check; txt = esc(g); }
        else if (g === '') { cls = 'skip'; ico = ICON.skip; txt = 'Saltato'; }
        else { cls = 'wrong'; ico = ICON.x; txt = esc(g); }
      } else if (k === n && !st.d) {
        cls = 'now';
        txt = k === 0 ? 'Primo tentativo' : `Tentativo ${k + 1} di ${MAX}`;
      }
      const isNew = animateLast && k === n - 1;
      rows.push(`<li class="guess ${cls}${isNew ? ' new' : ''}"><span class="g-ico">${ico}</span><span class="g-t">${txt}</span></li>`);
    }
    el.guesses.innerHTML = `<ol class="glist glass" aria-label="Tentativi">${rows.join('')}</ol>`;
    el.play.classList.toggle('done', !!st.d);
    requestAnimationFrame(checkOverflow);
  }

  function checkOverflow() {
    const g = el.guesses;
    g.classList.toggle('overflow', g.scrollHeight - g.clientHeight > 4 && g.scrollTop + g.clientHeight < g.scrollHeight - 4);
  }

  function renderBottom(animate = false) {
    const st = curSt();
    el.composer.hidden = false;
    if (!st.d) {
      el.result.hidden = true;
      el.form.hidden = false;
      el.form.classList.remove('out');
      return;
    }
    hideSuggest();
    const lv = curLv();
    const ans = lv.ans;
    const n = st.g.length;
    const squares = Array.from({ length: MAX }, (_, k) => {
      let c = '';
      if (k < n) c = st.w && k === n - 1 ? (n === 1 ? 'ok gold' : 'ok') : st.g[k] === '' ? 'skip' : 'wrong';
      return `<i class="sq ${c}" style="animation-delay:${0.2 + k * 0.06}s"></i>`;
    }).join('');
    const ci = currentIndex();
    const nextLabel = ci >= G.levels.length ? 'Fine' : ci === view + 1 ? 'Prossimo film' : 'Continua a giocare';
    const first = st.w && n === 1;
    // il prossimo film si carica dopo l'animazione del risultato, così non la rallenta
    if (ci < G.levels.length) setTimeout(() => preloadStart(G.levels[ci]), animate ? 1100 : 0);
    el.result.className = `result glass ${st.w ? 'win' : 'lose'}${first ? ' first' : ''}`;
    el.result.innerHTML = `
      <span class="res-badge">${first ? ICON.star : st.w ? ICON.check : ICON.x}${st.w ? (first ? 'Al primo colpo!' : `Indovinato al ${n}° fotogramma`) : 'Non indovinato'}</span>
      ${st.w ? '' : '<p class="res-kicker">Il film era</p>'}
      <h2 class="res-title"${st.w ? ' style="margin-top:12px"' : ''}>${esc(ans.t)}</h2>
      ${ans.y ? `<p class="res-year">${ans.y}</p>` : ''}
      <div class="res-squares">${squares}</div>
      <button class="btn btn-primary btn-block press" id="btnNext" type="button">${nextLabel} ${ICON.arrow}</button>`;
    if (animate) {
      el.form.classList.add('out');
      setTimeout(() => { el.form.hidden = true; el.result.hidden = false; requestAnimationFrame(checkOverflow); }, 260);
    } else {
      el.form.hidden = true;
      el.result.hidden = false;
    }
  }

  function renderLevel(i, { frame = null } = {}) {
    mode = 'play';
    view = i;
    const lv = curLv();
    const st = curSt();
    el.screen.hidden = true;
    el.play.hidden = false;
    el.frame.classList.toggle('won', !!st.w);
    el.frame.classList.toggle('first', !!st.w && st.g.length === 1);
    if (fimgs[frameLayer].dataset.src !== lv.f[0]) el.frame.classList.add('loading');
    setRatio(lv.ar);
    const k = frame != null ? frame : st.d ? (st.w ? st.g.length - 1 : MAX - 1) : Math.min(st.g.length, MAX - 1);
    showFrame(k);
    renderGuesses();
    renderBottom();
    renderPill();
    preload(lv, unlockedCount(st));
    resetInput();
  }

  async function goLevel(i) {
    if (busy) return;
    busy = true;
    const anim = !REDUCED && el.stage.animate;
    if (anim) await el.stage.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(-28px) scale(.98)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished;
    fimgs.forEach((f) => { f.classList.remove('on'); delete f.dataset.src; });
    if (i >= G.levels.length) showFinale(); else renderLevel(i);
    if (anim) await el.stage.animate([{ opacity: 0, transform: 'translateX(28px) scale(.98)' }, { opacity: 1, transform: 'none' }], { duration: 480, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).finished;
    el.stage.getAnimations?.().forEach((a) => a.cancel());
    busy = false;
  }

  function showFinale() {
    mode = 'finale';
    view = -1;
    el.play.hidden = true;
    el.composer.hidden = true;
    el.screen.hidden = false;
    const won = countWon();
    const total = G.levels.length;
    const lost = countDone() - won;
    el.screen.innerHTML = `
      <div class="card glass">
        <div class="card-ico">${ICON.trophy}</div>
        <h2>Hai visto tutti i film!</h2>
        <p>${won === total ? 'Li hai indovinati tutti. Leggendaria.' : `Ne hai indovinati ${won} su ${total}.`}<br>Quando arriveranno nuovi film li troverai qui.</p>
        <div class="card-stats">
          <div class="stat"><b>${won}</b><span>indovinati</span></div>
          <div class="stat"><b>${lost}</b><span>persi</span></div>
        </div>
        <button class="btn btn-primary btn-block press" type="button" data-open-levels>${ICON.grid} Rivedi i livelli</button>
      </div>`;
    renderPill();
    const last = G.levels[G.levels.length - 1];
    if (last) setAmbient(last.b[MAX - 1]);
  }

  function showEmpty(msg) {
    mode = 'empty';
    el.play.hidden = true;
    el.composer.hidden = true;
    el.screen.hidden = false;
    el.screen.innerHTML = `
      <div class="card glass">
        <div class="card-ico">${ICON.film}</div>
        <h2>${msg ? 'Qualcosa non va' : 'Ancora nessun film'}</h2>
        <p>${msg ? esc(msg) : 'Aggiungi le cartelle dei film in <b>film/</b> e pubblica di nuovo il sito.'}</p>
      </div>`;
  }

  /* ---------------------------------------------------------- tentativi */

  function resetInput() {
    el.input.value = '';
    onInput();
  }

  async function submit(text) {
    if (busy || mode !== 'play') return;
    const lv = curLv();
    const st = { ...curSt(), g: [...curSt().g] };
    if (st.d) return;
    const guess = text.trim();

    if (guess && st.g.some((g) => g && norm(g) === norm(guess))) {
      restartAnim(el.field, 'shake');
      haptic('error');
      toast('Hai già provato questo titolo');
      return;
    }

    const ok = !!guess && isCorrect(guess, lv.ans);
    st.g.push(ok ? lv.ans.t : guess);
    if (ok) { st.d = true; st.w = true; }
    else if (st.g.length >= MAX) { st.d = true; st.w = false; }
    if (st.d) st.t = Date.now();
    store.data.levels[lv.id] = st;
    store.save();

    hideSuggest();
    el.input.value = '';
    onInput();
    if (COARSE) el.input.blur();

    if (ok) return win();
    lockSkip();
    busy = true;
    if (guess) {
      restartAnim(el.field, 'shake');
      flash.style.setProperty('--flash', 'var(--red)');
      haptic('error');
    } else {
      flash.style.setProperty('--flash', 'rgba(255,255,255,.55)');
      haptic('light');
    }
    restartAnim(flash, 'go');
    renderGuesses(true);
    await sleep(guess ? 260 : 120);
    showFrame(st.d ? MAX - 1 : st.g.length, 1);
    preload(lv, st.g.length + 1);
    if (st.d) {
      await sleep(350);
      renderBottom(true);
      haptic('error');
    }
    busy = false;
  }

  /** "Salta" resta spento per un attimo, così un doppio tocco non brucia un fotogramma. */
  let skipLockTimer = 0;
  function lockSkip() {
    skipLockUntil = performance.now() + SKIP_LOCK;
    el.send.classList.add('cooling');
    clearTimeout(skipLockTimer);
    skipLockTimer = setTimeout(() => el.send.classList.remove('cooling'), SKIP_LOCK);
  }

  function win() {
    const st = curSt();
    const first = st.g.length === 1;
    el.frame.classList.add('won');
    el.frame.classList.toggle('first', first);
    showFrame(st.g.length - 1);
    renderGuesses(true);
    renderBottom(true);
    haptic('success');
    setTimeout(() => confetti({ gold: first }), 120);
  }

  /* ------------------------------------------------------- suggerimenti */

  /**
   * Suggerimenti più pertinenti, dal migliore:
   *   0  il titolo inizia con il testo scritto (anche saltando l'articolo: "incre" → Gli Incredibili)
   *   1  una parola del titolo inizia con il testo
   *   2  il testo compare dentro una parola
   *   3  il testo compare ignorando gli spazi
   *   4+ errore di battitura (da 4 lettere in su)
   * A parità di livello vince il titolo scritto per la parte più grande, poi il più corto.
   */
  function search(q) {
    const nq = norm(q);
    const nqs = nq.replace(/ /g, '');
    if (nqs.length < SUG_MIN) return [];
    const tried = new Set(curSt().g.filter(Boolean).map(norm));
    const out = [];
    for (const s of INDEX) {
      if (tried.has(s.n)) continue;
      let score = -1;
      let pos = -1;
      if (s.n.startsWith(nq)) { score = 0; pos = 0; }
      else if (s.core && s.n.startsWith(nq, s.core)) { score = 0; pos = s.core; }
      else {
        const w = s.n.indexOf(' ' + nq);
        if (w >= 0) { score = 1; pos = w + 1; }
        else {
          const c = s.n.indexOf(nq);
          if (c >= 0) { score = 2; pos = c; }
          else if (nqs.length >= 3 && s.ns.includes(nqs)) score = 3;
        }
      }
      if (score >= 0) out.push({ s, score, pos, len: nq.length });
    }
    // tolleranza agli errori di battitura ("aristogati" → Gli Aristogatti)
    if (out.length < SUG_MAX && nq.length >= 4) {
      const maxD = nq.length >= 8 ? 2 : 1;
      const found = new Set(out.map((r) => r.s));
      for (const s of INDEX) {
        if (found.has(s) || tried.has(s.n)) continue;
        let d = Infinity;
        for (const start of s.core ? [0, s.core] : [0]) {
          for (let L = nq.length - 1; L <= nq.length + 1; L++) d = Math.min(d, lev(nq, s.n.slice(start, start + L)));
        }
        if (d <= maxD) out.push({ s, score: 4 + d, pos: -1, len: 0 });
      }
    }
    const cover = (r) => nqs.length / r.s.ns.length;
    out.sort((a, b) => a.score - b.score || cover(b) - cover(a) || a.s.ns.length - b.s.ns.length
      || a.s.t.localeCompare(b.s.t, 'it', { sensitivity: 'base' }));
    return out.slice(0, SUG_MAX);
  }

  /** Invio con un titolo parziale: completa invece di sprecare un tentativo. */
  function onSubmit() {
    const text = el.input.value;
    if (!text.trim() && performance.now() < skipLockUntil) return; // doppio tocco dopo un tentativo
    if (text.trim() && mode === 'play' && !curSt().d) {
      const q = norm(text);
      const exact = INDEX.some((s) => s.n === q) || isCorrect(text, curLv().ans);
      if (!exact) {
        if (!el.suggest.hidden && sugActive >= 0) { pick(sugActive); return; }
        const res = search(text);
        if (res.length === 1) { sugList = res; pick(0); toast('Tocca di nuovo per confermare'); return; }
        if (res.length > 1) {
          el.input.focus();
          renderSuggest();
          if (!COARSE) setActive(0);
          toast('Scegli il titolo tra i suggerimenti');
          return;
        }
      }
    }
    submit(text);
  }

  function highlight({ s, pos, len }) {
    if (pos < 0) return esc(s.t);
    const a = s.map[pos];
    const b = s.map[Math.min(pos + len - 1, s.map.length - 1)] + 1;
    return esc(s.t.slice(0, a)) + '<mark>' + esc(s.t.slice(a, b)) + '</mark>' + esc(s.t.slice(b));
  }

  function sizeSuggest() {
    const top = $('.topbar').getBoundingClientRect().bottom;
    const bottom = el.composer.getBoundingClientRect().top;
    el.suggest.style.setProperty('--sug-max', Math.max(120, bottom - top - 8) + 'px');
  }

  function renderSuggest() {
    const q = el.input.value;
    const focused = doc.activeElement === el.input;
    if (!q.trim() || !focused || mode !== 'play' || curSt().d) return hideSuggest();
    sugList = search(q);
    sugActive = -1;
    if (!sugList.length) return hideSuggest(); // nessun indizio se il titolo non c'è
    const wasHidden = el.suggest.hidden;
    el.suggest.innerHTML = sugList.map((r, i) => `<button class="sug" type="button" role="option" data-i="${i}" id="sug-${i}"><span class="sug-t">${highlight(r)}</span>${r.s.y ? `<span class="sug-y">${r.s.y}</span>` : ''}</button>`).join('');
    el.suggest.hidden = false;
    el.input.setAttribute('aria-expanded', 'true');
    if (wasHidden) sizeSuggest();
    el.suggest.scrollTop = 0;
  }

  function hideSuggest() {
    el.suggest.hidden = true;
    el.input.setAttribute('aria-expanded', 'false');
    el.input.removeAttribute('aria-activedescendant');
    sugList = [];
    sugActive = -1;
  }

  function setActive(i) {
    const items = $$('.sug', el.suggest);
    if (!items.length) return;
    sugActive = (i + items.length) % items.length;
    items.forEach((b, k) => b.classList.toggle('active', k === sugActive));
    items[sugActive].scrollIntoView({ block: 'nearest' });
    el.input.setAttribute('aria-activedescendant', items[sugActive].id);
  }

  function pick(i) {
    const r = sugList[i];
    if (!r) return;
    el.input.value = r.s.t;
    onInput();
    hideSuggest();
    haptic('light');
    if (COARSE) el.input.blur();
    else el.input.focus();
  }

  function onInput() {
    const has = el.input.value.trim().length > 0;
    el.form.classList.toggle('has-text', has);
    el.send.setAttribute('aria-label', has ? 'Conferma' : 'Salta');
    renderSuggest();
  }

  /* --------------------------------------------------------------- sheet */

  let openSheetEl = null;
  function openSheet(sheet, { silent = false } = {}) {
    if (openSheetEl === sheet) return;
    if (openSheetEl) closeSheet(true);
    el.input.blur();
    hideSuggest();
    if (sheet === el.sheetLevels) renderLevels();
    openSheetEl = sheet;
    sheet.hidden = false;
    el.scrim.hidden = false;
    sheet.style.transform = '';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      sheet.classList.add('open');
      el.scrim.classList.add('on');
    }));
    if (!silent) haptic('light');
  }

  function closeSheet(instant = false) {
    const sheet = openSheetEl;
    if (!sheet) return;
    openSheetEl = null;
    sheet.classList.remove('open', 'dragging');
    sheet.style.transform = '';
    el.scrim.classList.remove('on');
    const hide = () => { if (!sheet.classList.contains('open')) sheet.hidden = true; if (!openSheetEl) el.scrim.hidden = true; };
    if (instant) hide(); else setTimeout(hide, 450);
  }

  function bindSheetDrag(sheet) {
    let startY = 0, dy = 0, t0 = 0, active = false;
    const handles = [$('.sheet-grab', sheet), $('.sheet-head', sheet)];
    handles.forEach((h) => h.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      active = true; startY = e.clientY; dy = 0; t0 = performance.now();
      sheet.classList.add('dragging');
      h.setPointerCapture(e.pointerId);
    }));
    handles.forEach((h) => h.addEventListener('pointermove', (e) => {
      if (!active) return;
      dy = e.clientY - startY;
      const y = dy > 0 ? dy : -Math.sqrt(-dy) * 2;
      sheet.style.transform = `translateY(${y}px)`;
    }));
    const end = () => {
      if (!active) return;
      active = false;
      sheet.classList.remove('dragging');
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > 110 || (dy > 30 && v > 0.6)) closeSheet();
      else sheet.style.transform = '';
    };
    handles.forEach((h) => { h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end); });
  }

  function renderLevels() {
    const ci = currentIndex();
    const total = G.levels.length;
    const done = countDone();
    el.lvSub.textContent = done === total ? `Tutti completati · ${countWon()} indovinati` : `${done} di ${total} completati`;
    el.lvGrid.innerHTML = G.levels.map((lv, i) => {
      const st = stOf(lv);
      const d = `style="--d:${Math.min(i, 30)}"`;
      if (st.d) {
        const first = st.w && st.g.length === 1;
        return `<div class="lv-cell" ${d}><button class="lv done ${st.w ? 'win' : 'lose'}${first ? ' first' : ''}${i === view ? ' viewing' : ''}" type="button" data-i="${i}" aria-label="Livello ${i + 1}: ${esc(lv.ans.t)}">
          <span class="lv-thumb" style="background-image:url('${lv.th}')"></span>
          <span class="lv-badge">${first ? ICON.star : st.w ? ICON.check : ICON.x}</span><span class="lv-num">${i + 1}</span></button>
          <span class="lv-name">${esc(lv.ans.t)}</span></div>`;
      }
      if (i === ci) {
        return `<div class="lv-cell" ${d}><button class="lv current${i === view ? ' viewing' : ''}" type="button" data-i="${i}" aria-label="Livello ${i + 1}, in corso">${i + 1}</button><span class="lv-name">In corso</span></div>`;
      }
      return `<div class="lv-cell" ${d}><button class="lv locked" type="button" data-i="${i}" aria-label="Livello ${i + 1}, bloccato">${i + 1}${ICON.lock}</button><span class="lv-name muted">Bloccato</span></div>`;
    }).join('');
  }

  function confirmDialog(title, msg, okLabel) {
    return new Promise((resolve) => {
      $('#alertTitle').textContent = title;
      $('#alertMsg').textContent = msg;
      $('[data-v="1"]', el.alert).textContent = okLabel;
      el.alert.hidden = false;
      const onClick = (e) => {
        const b = e.target.closest('[data-v]');
        if (!b && e.target !== el.alert) return;
        el.alert.removeEventListener('click', onClick);
        el.alert.hidden = true;
        resolve(b ? b.dataset.v === '1' : false);
      };
      el.alert.addEventListener('click', onClick);
    });
  }

  /* --------------------------------------------------------------- swipe */

  /** Scorrere col dito sul fotogramma per passare a quelli già sbloccati. */
  function bindSwipe() {
    const f = el.frame;
    let sx = 0, sy = 0, dx = 0, pid = null, active = false, swiping = false;
    const canGo = (dir) => {
      const t = frameIdx + dir;
      return t >= 0 && t < unlockedCount(curSt());
    };
    f.addEventListener('pointerdown', (e) => {
      if (mode !== 'play' || busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
      active = true; swiping = false; dx = 0; sx = e.clientX; sy = e.clientY; pid = e.pointerId;
    });
    f.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== pid) return;
      dx = e.clientX - sx;
      const dy = e.clientY - sy;
      if (!swiping) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          swiping = true;
          try { f.setPointerCapture(pid); } catch (err) { /* già rilasciato */ }
          f.classList.add('dragging');
        } else if (Math.abs(dy) > 14) { active = false; return; } else return;
      }
      const damp = canGo(dx < 0 ? 1 : -1) ? 0.4 : 0.12; // resistenza se non c'è un fotogramma da quel lato
      fimgs[frameLayer].style.transform = `translate3d(${(dx * damp).toFixed(1)}px, 0, 0)`;
    });
    const end = (e) => {
      if (!active || (e && e.pointerId !== pid)) return;
      active = false;
      if (!swiping) return;
      swiping = false;
      suppressFrameClick = performance.now() + 450; // non aprire lo schermo intero
      f.classList.remove('dragging');
      fimgs[frameLayer].style.transform = '';
      if (Math.abs(dx) < 45) return;
      const dir = dx < 0 ? 1 : -1;
      if (!canGo(dir)) {
        const tab = tabBtns[frameIdx + dir];
        if (tab) restartAnim(tab, 'nope');
        haptic('error');
        return;
      }
      haptic('light');
      showFrame(frameIdx + dir, dir);
    };
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------ lightbox */

  const lb = { s: 1, x: 0, y: 0, ptrs: new Map(), start: null, lastTap: 0, dragY: 0 };

  function openLightbox() {
    const src = fimgs[frameLayer].dataset.src;
    if (!src) return;
    el.lbImg.src = src;
    Object.assign(lb, { s: 1, x: 0, y: 0, dragY: 0 });
    applyLb(false);
    el.lightbox.classList.remove('closing');
    el.lightbox.hidden = false;
    const hint = $('.lb-hint', el.lightbox);
    hint.style.animation = 'none'; void hint.offsetWidth; hint.style.animation = '';
  }
  function closeLightbox() {
    el.lightbox.classList.add('closing');
    setTimeout(() => { el.lightbox.hidden = true; el.lightbox.classList.remove('closing'); el.lbImg.style.opacity = ''; }, 240);
  }
  function applyLb(anim) {
    el.lbImg.style.transition = anim ? 'transform .35s cubic-bezier(.22,1,.36,1)' : 'none';
    el.lbImg.style.transform = `translate3d(${lb.x}px, ${lb.y + lb.dragY}px, 0) scale(${lb.s})`;
    el.lbImg.style.opacity = lb.dragY ? String(clamp(1 - Math.abs(lb.dragY) / 500, 0.4, 1)) : '';
  }
  function clampLb() {
    const r = el.lbStage.getBoundingClientRect();
    lb.s = clamp(lb.s, 1, 5);
    lb.x = clamp(lb.x, r.width - r.width * lb.s, 0);
    lb.y = clamp(lb.y, r.height - r.height * lb.s, 0);
  }
  function bindLightbox() {
    const stage = el.lbStage;
    const pt = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      lb.ptrs.set(e.pointerId, pt(e));
      const pts = [...lb.ptrs.values()];
      if (pts.length === 2) {
        const [a, b] = pts;
        lb.start = { d: Math.hypot(a.x - b.x, a.y - b.y), m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, s: lb.s, x: lb.x, y: lb.y };
      } else if (pts.length === 1) {
        lb.start = { p: pts[0], x: lb.x, y: lb.y, s: lb.s, t: performance.now(), moved: false };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (!lb.ptrs.has(e.pointerId) || !lb.start) return;
      lb.ptrs.set(e.pointerId, pt(e));
      const pts = [...lb.ptrs.values()];
      if (pts.length >= 2 && lb.start.d) {
        const [a, b] = pts;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const s = clamp(lb.start.s * (d / lb.start.d), 0.8, 6);
        const qx = (lb.start.m.x - lb.start.x) / lb.start.s;
        const qy = (lb.start.m.y - lb.start.y) / lb.start.s;
        lb.s = s; lb.x = m.x - s * qx; lb.y = m.y - s * qy;
        applyLb(false);
      } else if (pts.length === 1 && lb.start.p) {
        const dx = pts[0].x - lb.start.p.x;
        const dy = pts[0].y - lb.start.p.y;
        if (Math.hypot(dx, dy) > 6) lb.start.moved = true;
        if (lb.s > 1.01) { lb.x = lb.start.x + dx; lb.y = lb.start.y + dy; }
        else lb.dragY = dy;
        applyLb(false);
      }
    });
    const up = (e) => {
      if (!lb.ptrs.has(e.pointerId)) return;
      const st = lb.start;
      lb.ptrs.delete(e.pointerId);
      if (lb.ptrs.size === 1) {
        const p = [...lb.ptrs.values()][0];
        lb.start = { p, x: lb.x, y: lb.y, s: lb.s, t: performance.now(), moved: true };
        return;
      }
      if (lb.ptrs.size) return;
      lb.start = null;
      if (Math.abs(lb.dragY) > 120) { closeLightbox(); return; }
      lb.dragY = 0;
      if (st && st.p && !st.moved && performance.now() - st.t < 250) {
        const now = performance.now();
        if (now - lb.lastTap < 320) {
          const p = pt(e);
          const target = lb.s > 1.2 ? 1 : 2.6;
          const qx = (p.x - lb.x) / lb.s;
          const qy = (p.y - lb.y) / lb.s;
          lb.s = target; lb.x = p.x - target * qx; lb.y = p.y - target * qy;
          lb.lastTap = 0;
        } else lb.lastTap = now;
      }
      clampLb();
      applyLb(true);
    };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    $('#lbClose').addEventListener('click', closeLightbox);
  }

  /* ------------------------------------------------------------ confetti */

  /** Prepara il canvas dei coriandoli in anticipo (all'avvio e quando cambia la dimensione). */
  function sizeConfetti() {
    const c = el.confetti;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  /** gold: vittoria al primo colpo, coriandoli dorati con stelle e una pioggia in più */
  function confetti({ gold = false } = {}) {
    if (REDUCED) return;
    const c = el.confetti;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth;
    const H = window.innerHeight;
    sizeConfetti(); // di solito è già pronto: niente lavoro pesante nel momento della vittoria
    const colors = gold
      ? ['#ffd60a', '#ffcc00', '#ffe58a', '#fff3c4', '#f5b700', '#ffffff', '#ffdf6e']
      : ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#64d2ff', '#0a84ff', '#bf5af2', '#ff375f', '#ffffff'];
    const parts = [];
    const speed = Math.max(H, 600) / 46;
    const burst = (x, y, angle, spread, n, power = 1) => {
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = speed * (0.55 + Math.random() * 0.6) * power;
        parts.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
          w: 6 + Math.random() * 6, h: 9 + Math.random() * 8,
          r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
          tilt: Math.random() * Math.PI * 2, vt: 0.08 + Math.random() * 0.18,
          color: colors[(Math.random() * colors.length) | 0],
          shape: gold && Math.random() < 0.35 ? 'star' : Math.random() < 0.25 ? 'round' : 'rect',
          drag: 0.975 + Math.random() * 0.012,
        });
      }
    };
    burst(-10, H * 0.82, -Math.PI / 3.1, 0.75, 75);
    burst(W + 10, H * 0.82, -Math.PI + Math.PI / 3.1, 0.75, 75);
    setTimeout(() => burst(W / 2, H * 0.55, -Math.PI / 2, 1.6, 50, 0.75), 180);
    if (gold) {
      setTimeout(() => {
        burst(W * 0.2, H * 0.7, -Math.PI / 2.4, 0.9, 40, 0.9);
        burst(W * 0.8, H * 0.7, -Math.PI + Math.PI / 2.4, 0.9, 40, 0.9);
      }, 520);
    }
    const g = speed / 46;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(2.5, (now - last) / 16.67);
      last = now;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vx *= Math.pow(p.drag, dt);
        p.vy = p.vy * Math.pow(p.drag, dt) + g * dt;
        p.x += p.vx * dt + Math.sin(p.tilt) * 0.6;
        p.y += p.vy * dt;
        p.r += p.vr * dt;
        p.tilt += p.vt * dt;
        if (p.y > H + 40) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
        // posizione, rotazione e "sventolio" in un'unica trasformazione
        const cs = Math.cos(p.r), sn = Math.sin(p.r), fl = Math.cos(p.tilt);
        ctx.setTransform(cs * dpr, sn * dpr, -sn * fl * dpr, cs * fl * dpr, p.x * dpr, p.y * dpr);
        if (ctx.fillStyle !== p.color) ctx.fillStyle = p.color;
        if (p.shape === 'round') { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.2, 0, Math.PI * 2); ctx.fill(); }
        else if (p.shape === 'star') {
          const R = p.w * 0.9, r = R * 0.45;
          ctx.beginPath();
          for (let k = 0; k < 10; k++) {
            const a = -Math.PI / 2 + (k * Math.PI) / 5;
            const rad = k % 2 ? r : R;
            ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
          }
          ctx.closePath();
          ctx.fill();
        } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      if (parts.length) requestAnimationFrame(tick);
      else { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height); }
    };
    requestAnimationFrame(tick);
  }

  /* -------------------------------------------------------------- eventi */

  function bind() {
    doc.addEventListener('touchstart', () => {}, { passive: true }); // abilita :active su iOS

    // riflesso del vetro che segue il dito, solo sui pulsanti e solo mentre li premi
    let glowEl = null;
    let glowTimer = 0;
    doc.addEventListener('pointerdown', (e) => {
      const g = e.target.closest && e.target.closest('.glass.press');
      if (!g) return;
      clearTimeout(glowTimer);
      if (glowEl && glowEl !== g) glowEl.style.removeProperty('--mx'), glowEl.style.removeProperty('--my');
      glowEl = g;
      const r = g.getBoundingClientRect();
      g.style.setProperty('--mx', `${e.clientX - r.left}px`);
      g.style.setProperty('--my', `${e.clientY - r.top}px`);
    }, { passive: true });
    const releaseGlow = () => {
      if (!glowEl) return;
      const g = glowEl;
      clearTimeout(glowTimer);
      glowTimer = setTimeout(() => {
        g.style.removeProperty('--mx');
        g.style.removeProperty('--my');
        if (glowEl === g) glowEl = null;
      }, 450); // dopo la dissolvenza del riflesso
    };
    doc.addEventListener('pointerup', releaseGlow, { passive: true });
    doc.addEventListener('pointercancel', releaseGlow, { passive: true });

    el.input.addEventListener('input', onInput);
    el.input.addEventListener('focus', () => { setKeyboard(); renderSuggest(); });
    el.input.addEventListener('blur', () => {
      setKeyboard();
      setTimeout(() => { if (doc.activeElement !== el.input) hideSuggest(); }, 120);
      setTimeout(() => { if (doc.activeElement !== el.input) window.scrollTo(0, 0); }, 60);
    });
    el.input.addEventListener('keydown', (e) => {
      if (el.suggest.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(sugActive + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(sugActive - 1); }
      else if (e.key === 'Escape') { hideSuggest(); }
      else if (e.key === 'Enter' && sugActive >= 0) { e.preventDefault(); pick(sugActive); }
    });

    el.suggest.addEventListener('pointerdown', (e) => e.preventDefault()); // non chiudere la tastiera
    el.suggest.addEventListener('mousedown', (e) => e.preventDefault());
    el.suggest.addEventListener('click', (e) => {
      const b = e.target.closest('.sug');
      if (b) pick(Number(b.dataset.i));
    });

    el.clear.addEventListener('pointerdown', (e) => e.preventDefault());
    el.clear.addEventListener('click', () => { el.input.value = ''; onInput(); el.input.focus(); });

    el.form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit();
    });

    el.result.addEventListener('click', (e) => {
      if (!e.target.closest('#btnNext')) return;
      haptic('light');
      goLevel(currentIndex());
    });

    el.tabs.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b || mode !== 'play') return;
      const k = Number(b.dataset.i);
      if (k >= unlockedCount(curSt())) { restartAnim(b, 'nope'); haptic('error'); return; }
      if (k !== frameIdx) { haptic('light'); showFrame(k, Math.sign(k - frameIdx)); }
    });

    el.frame.addEventListener('click', () => {
      if (performance.now() < suppressFrameClick || el.frame.classList.contains('loading')) return;
      openLightbox();
    });
    bindSwipe();

    $('#btnLevels').addEventListener('click', () => { if (G && G.levels.length) openSheet(el.sheetLevels); });
    el.screen.addEventListener('click', (e) => { if (e.target.closest('[data-open-levels]')) openSheet(el.sheetLevels); });
    el.scrim.addEventListener('click', () => closeSheet());
    $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeSheet()));
    bindSheetDrag(el.sheetLevels);

    el.lvGrid.addEventListener('click', (e) => {
      const b = e.target.closest('.lv');
      if (!b) return;
      const i = Number(b.dataset.i);
      if (!isUnlocked(i)) { restartAnim(b, 'nope'); haptic('error'); return; }
      closeSheet();
      if (i !== view) setTimeout(() => goLevel(i), 140);
    });

    el.btnReset.addEventListener('click', async () => {
      const ok = await confirmDialog('Ricominciare da capo?', 'Tutti i progressi verranno cancellati da questo dispositivo.', 'Ricomincia');
      if (!ok) return;
      store.reset();
      orderLevels(); // nuovo ordine casuale
      closeSheet();
      setTimeout(() => goLevel(0), 200);
    });

    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!el.lightbox.hidden) closeLightbox();
      else if (openSheetEl) closeSheet();
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
    window.addEventListener('resize', () => { syncViewport(); checkOverflow(); });
    let confettiResize = 0;
    window.addEventListener('resize', () => { clearTimeout(confettiResize); confettiResize = setTimeout(sizeConfetti, 300); });
    el.guesses.addEventListener('scroll', checkOverflow, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(syncViewport, 250));

    bindLightbox();
  }

  /* ---------------------------------------------------------------- avvio */

  async function init() {
    bind();
    syncViewport();
    requestAnimationFrame(sizeConfetti);
    try {
      G = await loadGame();
      prepare(G);
      orderLevels();
    } catch (err) {
      console.error(err);
      doc.body.classList.add('ready');
      showEmpty('Non riesco a caricare i film. Controlla la connessione e riprova.');
      return;
    }
    doc.body.classList.add('ready');
    if (!G.levels.length) { showEmpty(); return; }
    const ci = currentIndex();
    if (ci >= G.levels.length) showFinale(); else renderLevel(ci);
  }

  init();
})();
