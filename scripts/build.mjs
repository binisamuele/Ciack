#!/usr/bin/env node
/**
 * Build del gioco.
 *
 * Legge le cartelle in film/, ottimizza i fotogrammi e genera il sito
 * statico in dist/ (pronto per Cloudflare Pages o qualsiasi hosting statico).
 *
 *   node scripts/build.mjs              → dist/
 *   node scripts/build.mjs --single     → dist-single/index.html (tutto in un file)
 *   node scripts/build.mjs --no-sharp   → salta l'ottimizzazione immagini
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILM_DIR = path.join(ROOT, 'film');
const APP_DIR = path.join(ROOT, 'app');
const ARGS = new Set(process.argv.slice(2));
const SINGLE = ARGS.has('--single');
const OUT = path.join(ROOT, SINGLE ? 'dist-single' : 'dist');

const FRAMES = 5;
const MAX_SIDE = SINGLE ? 1280 : 1600; // lato massimo dei fotogrammi ottimizzati
const QUALITY = SINGLE ? 74 : 82;
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const C = { dim: paint(2), bold: paint(1), green: paint(32), yellow: paint(33), red: paint(31), cyan: paint(36) };

let sharp = null;
if (!ARGS.has('--no-sharp') && !process.env.CIAK_NO_SHARP) {
  try { sharp = require('sharp'); } catch { /* facoltativo */ }
}

/* ------------------------------------------------------------------ utils */

const naturalSort = (a, b) => a.localeCompare(b, 'it', { numeric: true, sensitivity: 'base' });
const sha = (data, len = 16) => crypto.createHash('sha256').update(data).digest('hex').slice(0, len);

/** Stessa normalizzazione usata dal gioco per confrontare i titoli. */
function norm(str) {
  return String(str)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019\u2018`\u00b4]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Keystream deterministico (identico a quello in app.js) per offuscare le risposte. */
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

function encode(id, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const ks = keystream(id, data.length);
  for (let i = 0; i < data.length; i++) data[i] ^= ks[i];
  return data.toString('base64');
}

/** "004 - Titolo (2001)" → { order, title, year } */
function parseFolderName(name) {
  let rest = name.trim();
  let order = null;
  // "001 - Titolo", "1. Titolo", "01_Titolo", "001 Titolo" (lo spazio basta solo con lo zero davanti)
  const m = rest.match(/^(\d+)\s*[-–—_.)]\s*(.+)$/) || rest.match(/^(0\d*)\s+(.+)$/);
  if (m) { order = Number(m[1]); rest = m[2].trim(); }
  let year = null;
  const y = rest.match(/\s*\((\d{4})\)\s*$/);
  if (y) { year = Number(y[1]); rest = rest.slice(0, y.index).trim(); }
  return { order, title: rest, year };
}

/** info.txt facoltativo: titolo / anno / alias */
function readInfo(dir) {
  const file = ['info.txt', 'Info.txt', 'INFO.txt'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
  const info = { aliases: [] };
  if (!file) return info;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([a-zà-ù ]+?)\s*[:=]\s*(.+)$/i);
    if (!m) { info.aliases.push(line); continue; }
    const key = norm(m[1]);
    const val = m[2].trim();
    if (key === 'titolo' || key === 'title') info.title = val;
    else if (key === 'anno' || key === 'year') info.year = Number(val) || null;
    else if (key === 'alias' || key === 'aliases' || key === 'anche') {
      info.aliases.push(...val.split('|').map((s) => s.trim()).filter(Boolean));
    }
  }
  return info;
}

function readExtraTitles() {
  const file = path.join(ROOT, 'titoli-extra.txt');
  if (!fs.existsSync(file)) return [];
  const list = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const y = line.match(/\s*\((\d{4})\)\s*$/);
    list.push({ t: y ? line.slice(0, y.index).trim() : line, y: y ? Number(y[1]) : null });
  }
  return list;
}

/* --------------------------------------------------------------- immagini */

async function processImage(file, { thumb = false } = {}) {
  const input = await fsp.readFile(file);
  if (sharp) {
    try {
      const base = () => sharp(input, { failOn: 'none', animated: false }).rotate();
      const main = await base()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: QUALITY, effort: 5 })
        .toBuffer({ resolveWithObject: true });
      // sfondo già sfocato e saturato: il telefono non deve applicare filtri dal vivo
      const bg = await base().resize({ width: 160, height: 160, fit: 'inside' }).modulate({ saturation: 1.7 }).blur(9).webp({ quality: 72 }).toBuffer();
      const th = thumb ? await base().resize({ width: 400, height: 400, fit: 'inside' }).webp({ quality: 72 }).toBuffer() : null;
      return { main: main.data, ext: '.webp', w: main.info.width, h: main.info.height, bg, th, optimized: true };
    } catch (err) {
      console.warn(C.yellow(`   ! impossibile ottimizzare ${path.basename(file)} (${err.message}), uso l'originale`));
    }
  }
  return { main: input, ext: path.extname(file).toLowerCase(), w: null, h: null, bg: null, th: null, optimized: false };
}

async function emit(buffer, ext) {
  if (SINGLE) return `data:${MIME[ext] || 'application/octet-stream'};base64,${buffer.toString('base64')}`;
  const name = `${sha(buffer)}${ext}`;
  const dest = path.join(OUT, 'f', name);
  if (!fs.existsSync(dest)) await fsp.writeFile(dest, buffer);
  return `f/${name}`;
}

/* ------------------------------------------------------------------- film */

async function collectFilms() {
  if (!fs.existsSync(FILM_DIR)) return { levels: [], titles: [], warnings: ['Cartella film/ non trovata'] };
  const dirs = (await fsp.readdir(FILM_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort(naturalSort);

  const levels = [];
  const titles = [];
  const warnings = [];
  const seen = new Set();

  for (const dirName of dirs) {
    const dir = path.join(FILM_DIR, dirName);
    const parsed = parseFolderName(dirName);
    const info = readInfo(dir);
    const title = (info.title || parsed.title).trim();
    const year = info.year || parsed.year || null;
    const aliases = [...new Set(info.aliases.filter((a) => norm(a) && norm(a) !== norm(title)))];

    const images = (await fsp.readdir(dir))
      .filter((f) => !f.startsWith('.') && IMG_EXT.has(path.extname(f).toLowerCase()))
      .sort(naturalSort);

    if (images.length < FRAMES) {
      warnings.push(`"${dirName}": servono ${FRAMES} immagini, ne ho trovate ${images.length} → saltato`);
      console.log(`  ${C.red('✕')} ${dirName} ${C.dim(`(${images.length}/${FRAMES} immagini)`)}`);
      continue;
    }
    if (images.length > FRAMES) warnings.push(`"${dirName}": ${images.length} immagini, uso le prime ${FRAMES} (${images.slice(0, FRAMES).join(', ')})`);

    let id = sha('ciak/' + norm(title), 10);
    while (seen.has(id)) { warnings.push(`"${dirName}": titolo duplicato`); id = sha(id + '+', 10); }
    seen.add(id);

    const f = [];
    const b = [];
    let th = null;
    let ar = null;
    let optimized = false;
    for (let i = 0; i < FRAMES; i++) {
      const img = await processImage(path.join(dir, images[i]), { thumb: i === 0 });
      const src = await emit(img.main, img.ext);
      f.push(src);
      b.push(img.bg ? await emit(img.bg, '.webp') : src);
      if (i === 0) {
        th = img.th ? await emit(img.th, '.webp') : src;
        if (img.w && img.h) ar = Math.round((img.w / img.h) * 1000) / 1000;
        optimized = img.optimized;
      }
    }

    levels.push({ id, f, b, th, ar, pb: optimized ? 1 : 0, x: encode(id, { t: title, y: year, a: aliases }) });
    titles.push({ t: title, y: year });
    for (const a of aliases) titles.push({ t: a, y: year });
    console.log(`  ${C.green('✓')} ${String(levels.length).padStart(3)}  ${title}${year ? C.dim(` (${year})`) : ''}${aliases.length ? C.dim(`  +${aliases.length} alias`) : ''}`);
  }

  return { levels, titles, warnings };
}

/* -------------------------------------------------------------------- app */

function readConfig() {
  const defaults = { nome: 'Ciak', sottotitolo: 'Indovina il film da un fotogramma' };
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')) }; }
  catch { return defaults; }
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const entry of await fsp.readdir(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await fsp.copyFile(s, d);
  }
}

async function main() {
  const t0 = Date.now();
  const config = readConfig();
  console.log(`\n${C.bold('🎬  ' + config.nome)} ${C.dim('— build')}`);
  console.log(C.dim(sharp ? '   ottimizzazione immagini: attiva (sharp)' : '   ottimizzazione immagini: disattivata (uso le immagini originali)'));
  console.log('');

  await fsp.rm(OUT, { recursive: true, force: true });
  await fsp.mkdir(path.join(OUT, 'f'), { recursive: true });

  const { levels, titles, warnings } = await collectFilms();

  // Elenco titoli per i suggerimenti: film + alias + extra, senza doppioni, in ordine alfabetico
  const pool = new Map();
  for (const t of [...titles, ...readExtraTitles()]) {
    const k = norm(t.t);
    if (k && !pool.has(k)) pool.set(k, t);
  }
  const titleList = [...pool.values()].sort((a, b) => a.t.localeCompare(b.t, 'it', { sensitivity: 'base' }));

  const appJs = await fsp.readFile(path.join(APP_DIR, 'app.js'), 'utf8');
  const css = await fsp.readFile(path.join(APP_DIR, 'style.css'), 'utf8');
  const version = sha(appJs + css, 8);
  const game = { v: 1, build: sha(JSON.stringify(levels) + version, 8), levels, titles: titleList };

  const fill = (s) => s
    .replaceAll('{{NOME}}', escHtml(config.nome))
    .replaceAll('{{SOTTOTITOLO}}', escHtml(config.sottotitolo))
    .replaceAll('{{V}}', version);

  let html = fill(await fsp.readFile(path.join(APP_DIR, 'index.html'), 'utf8'));

  if (SINGLE) {
    await fsp.rm(path.join(OUT, 'f'), { recursive: true, force: true });
    const iconSvg = await fsp.readFile(path.join(APP_DIR, 'icons', 'icon.svg'));
    html = html
      .replace(/<link rel="manifest"[^>]*>\n?/, '')
      .replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '')
      .replace(/href="icons\/icon\.svg"/, `href="data:image/svg+xml;base64,${iconSvg.toString('base64')}"`)
      .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`)
      .replace(/<script src="app\.js[^"]*"[^>]*><\/script>/, () =>
        `<script>window.__CIAK__=${JSON.stringify(game).replace(/</g, '\\u003c')};</script>\n<script>\n${appJs}\n</script>`);
    await fsp.writeFile(path.join(OUT, 'index.html'), html);
  } else {
    await copyDir(APP_DIR, OUT);
    await fsp.writeFile(path.join(OUT, 'index.html'), html);
    const manifest = path.join(OUT, 'manifest.webmanifest');
    await fsp.writeFile(manifest, fill(await fsp.readFile(manifest, 'utf8')));
    await fsp.writeFile(path.join(OUT, 'game.json'), JSON.stringify(game));
  }

  console.log('');
  for (const w of warnings) console.log(C.yellow(`  ! ${w}`));
  if (!levels.length) console.log(C.yellow('  ! Nessun film trovato: aggiungi delle cartelle in film/ (vedi film/LEGGIMI.txt)'));
  const out = path.relative(ROOT, OUT) || '.';
  console.log(`\n  ${C.green('Fatto')} in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${C.cyan(out + '/')}  ${C.dim(`${levels.length} film · ${titleList.length} titoli nei suggerimenti`)}\n`);
}

main().catch((err) => {
  console.error(C.red('\nBuild fallita:'), err);
  process.exit(1);
});
