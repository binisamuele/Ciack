# 🎬 Ciak — indovina il film

Un gioco in stile Framed: vedi un fotogramma di un film e devi indovinare qual è.
Se non lo sai (o sbagli) si sblocca il fotogramma successivo, sempre più facile.
Hai 5 fotogrammi: al quinto errore il film viene svelato.

- Livelli in sequenza, progressi salvati sul telefono
- Suggerimenti mentre scrivi, basati sui film del gioco (con tolleranza agli errori di battitura)
- Interfaccia Liquid Glass pensata per iPhone, installabile come app sulla schermata Home
- Coriandoli quando indovini 🎉

---

## 1. Aggiungere un film

Ogni film è una cartella dentro `film/`:

```
film/
├── 001 - Interstellar (2014)/
│   ├── 1.jpg      ← il più difficile
│   ├── 2.jpg
│   ├── 3.jpg
│   ├── 4.jpg
│   └── 5.jpg      ← il più facile
├── 002 - Ritorno al futuro (1985)/
│   ├── 1.jpg … 5.jpg
│   └── info.txt   ← facoltativo
└── 003 - Titanic (1997)/
```

- **Nome della cartella**: `NUMERO - Titolo (anno)`. Il numero serve solo a te per tenerle in ordine: nel gioco i film escono in ordine casuale. L'anno è facoltativo.
- **Immagini**: 5 file jpg, png o webp, presi in ordine alfabetico. Va bene qualsiasi dimensione: in fase di build vengono ridimensionati e convertiti in WebP leggeri.
- **info.txt** (facoltativo) per titoli alternativi accettati come risposta giusta, o per titoli con caratteri non ammessi nei nomi delle cartelle:

  ```
  titolo: Star Wars: Una nuova speranza
  anno: 1977
  alias: Guerre stellari
  alias: Star Wars
  ```

- Una cartella che inizia con `_` viene ignorata: utile per preparare film in anticipo.
- Puoi rinumerare le cartelle quando vuoi: i progressi sono legati al titolo, non al numero. I film aggiunti dopo finiscono tra quelli ancora da giocare, in un punto a caso.

I tre film già presenti sono **esempi con immagini segnaposto**: cancellali prima di pubblicare.

> I nomi dei file non svelano mai la risposta: nel sito pubblicato le immagini hanno nomi casuali e i titoli sono codificati, così non si scoprono per sbaglio tenendo premuta un'immagine.

## 2. Provarlo sul computer (facoltativo)

Serve [Node.js](https://nodejs.org) 20 o più recente.

```bash
npm install
npm run dev
```

Apri `http://localhost:5173`. Il terminale mostra anche un indirizzo da aprire sul telefono, se è sulla stessa Wi‑Fi.

## 3. Pubblicarlo gratis su Cloudflare Pages

1. **Metti il progetto su GitHub.** Crea un nuovo repository (va bene anche privato) e carica tutta questa cartella, tranne `node_modules/` e `dist/` se esistono.
   - Dal sito: *New repository* → *uploading an existing file* → trascina i file e le cartelle → *Commit changes*.
   - Oppure da terminale:
     ```bash
     git init && git add . && git commit -m "Ciak"
     git branch -M main
     git remote add origin https://github.com/TUO-UTENTE/ciak.git
     git push -u origin main
     ```
2. **Collega Cloudflare.** Su [dash.cloudflare.com](https://dash.cloudflare.com) (account gratuito): *Workers & Pages* → *Create application* → *Pages* → *Connect to Git* → scegli GitHub e il repository → *Begin setup*.
3. **Impostazioni di build:**

   | Campo | Valore |
   |---|---|
   | Framework preset | `None` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. *Save and Deploy*. Dopo un paio di minuti il gioco è online a un indirizzo tipo `https://ciak-xxx.pages.dev`.

### Se Cloudflare crea un Worker invece di Pages

Va bene lo stesso: il file `wrangler.jsonc` dice già a Cloudflare di eseguire la build e pubblicare la cartella `dist`.
Il nome in `wrangler.jsonc` (`"name": "ciack"`) deve essere uguale al nome del Worker su Cloudflare.

Il link si trova nel Worker → *Settings* → *Domains & Routes* → riga *workers.dev*, ed è tipo `https://ciack.TUO-NOME.workers.dev`.
Se in alto vedi "No URLs enabled", attiva *workers.dev* da lì.

### Aggiungere film dopo la pubblicazione

Basta caricare la nuova cartella su GitHub: Cloudflare ricostruisce il sito da solo in circa un minuto.

Dal sito di GitHub: apri il repository → cartella `film` → *Add file* → *Upload files* → trascina **l'intera cartella del film** (con dentro le 5 immagini) → *Commit changes*.

## 4. Installarlo come app sull'iPhone

Apri il sito in **Safari** → tasto *Condividi* → *Aggiungi alla schermata Home*.
Si apre a tutto schermo con la sua icona, come un'app vera.

⚠️ Su iPhone i progressi della versione installata sulla Home sono separati da quelli di Safari: meglio giocare sempre dallo stesso posto (l'icona sulla Home).

## 5. Personalizzare

| Cosa | Dove |
|---|---|
| Nome del gioco e sottotitolo | `config.json` |
| Titoli "esca" nei suggerimenti, per renderlo più difficile | `titoli-extra.txt` |
| Icona dell'app | `app/icons/` (PNG 180, 192 e 512 px + `icon.svg`) |
| Colori e stile | `app/style.css` (variabili in cima al file) |

## Struttura del progetto

```
app/              interfaccia (HTML, CSS, JS, icone)
film/             i film del gioco, una cartella per film
scripts/build.mjs legge film/, ottimizza le immagini e genera dist/
scripts/serve.mjs server locale per le prove
config.json       nome e sottotitolo
titoli-extra.txt  titoli aggiuntivi per i suggerimenti (facoltativo)
```

Nessun database, nessun server: è un sito statico. Per azzerare i progressi c'è *Ricomincia da capo* in fondo alla schermata dei livelli.
