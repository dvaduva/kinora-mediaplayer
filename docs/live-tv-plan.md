# Live TV — plan de implementare

Un meniu **Live TV** în Kinora, cu ghid EPG (canale pe rânduri, timp pe coloane), „What's On” și categorii. Canalele vin din două surse care folosesc același model de date (canal → program cu `start`/`end`):

- **canale virtuale** construite din biblioteca proprie (pseudo-TV);
- **IPTV** din playlisturi M3U, cu EPG XMLTV.

## Decizii

| Subiect | Decizie |
|---|---|
| Surse | Canale virtuale (faza 1) + IPTV (faza 3), pe același model |
| Redare „live” | Fiecare client pornește de la offset-ul calculat (`acum − start`); fără sincronizare la cadru între clienți |
| Derulare | Pauză și înapoi în emisiunea curentă; înainte, cel mult până la „acum”; buton **Înapoi la Live** |
| Creare canale | Manual (faza 1), apoi și generate automat, editabile și dezactivabile (faza 2) |
| Ordine | Setare per canal: secvențial / aleator. Aleatorul folosește un seed per canal, deci e stabil la restart. Implicit: filme aleator, seriale secvențial cu rotație între seriale |
| Grilă | Program continuu, fără aliniere la :00/:30 (alinierea cu umplutură vine în faza 4) |
| Program | Materializat în DB pe 72h; regenerat zilnic, la editarea canalului și când un fișier programat lipsește |
| Fișier lipsă | Regenerare de la acel punct înainte, canalul trece la itemul următor |
| Canal fără conținut | Ascuns din ghid, cu avertisment în Setări |
| Muzică | Canale audio în faza 2 (vizualizare sau copertă pe ecran) |
| IPTV | Mai multe surse M3U, fiecare cu EPG opțional; redare mereu prin server (remux, transcodare doar la nevoie); un ffmpeg partajat per canal, oprit la ~60s după ultimul spectator; reîmprospătare la 12h + buton manual |
| Potrivire EPG | `tvg-id` → nume → mapare manuală în Setări |
| Canale / profiluri | Canalele sunt globale; favoritele și ordinea sunt per profil |
| Categorii | Derivate automat (regula canalului, sau `group-title` la IPTV), cu suprascriere manuală. Tab-uri fixe: Favorite, Toate |
| Logo / număr | Logo generat (nume pe culoare derivată din nume) sau încărcat; număr editabil, cu propunere automată. La IPTV: `tvg-logo` și `tvg-chno` |
| Click în ghid | În curs → redare live. Viitor → panou lateral cu detalii (+ „Vezi în bibliotecă”). Trecut → estompat, cu „Redă din bibliotecă” doar la canalele virtuale |
| Progres | Live TV nu modifică `progress` și nu marchează nimic ca văzut |
| Pornire la mijlocul unui fișier transcodat | Transcodare cu punct de start arbitrar (faza 1); pre-transcodarea emisiunii următoare (faza 4) |

### În afara planului

DVR/înregistrare, tuner fizic (HDHomeRun/DVB), catch-up IPTV, sincronizare la cadru între clienți.

## Faza 1 — Canale virtuale (MVP)

**Scop:** creezi un canal din bibliotecă, îl vezi în ghid și te uiți la el ca la TV.

### Server

- **Schemă DB** (migrare nouă în `apps/server/drizzle`, definiții în `apps/server/src/db/schema.ts`):
  - `channels`: `id`, `kind` (`virtual` | `iptv`), `number`, `name`, `logo_path`, `order_mode` (`sequential` | `shuffle`), `seed`, `enabled`, `category_override`, `created_at`, `updated_at`
  - `channel_sources`: reguli per canal, `channel_id`, `type`, `value`. Tipuri în faza 1: `genre`, `series`, `movie` (listă manuală de titluri), `library`, `decade`, `person` (actor sau regizor, din `cast_json`/`directors_json`)
  - `channel_programs`: `channel_id`, `start`, `end`, `item_type` (`movie` | `episode` | `track` | `external`), `item_id`, `file_id`, `title`, `subtitle` (de ex. „S1 · E4”), `description`, `image`. Index pe (`channel_id`, `start`)
- **Scheduler** (`apps/server/src/livetv/schedule.ts`):
  - rezolvă regulile într-o listă de itemi cu durată, luată din `media_files` sau `runtime`;
  - ordonează: secvențial (episoadele în ordine, rotație între seriale) sau aleator cu seed;
  - lipește itemii continuu până la `acum + 72h`, continuând de unde s-a oprit programul existent;
  - declanșatori: job zilnic, salvarea unui canal, fișier lipsă detectat la redare sau la scanare.
- **Transcodare cu start arbitrar:** `ensureTranscode` din `apps/server/src/playback/transcode.ts` primește un punct de start și pornește o sesiune nouă de la offset (`-ss`, segmente numerotate de acolo). Fișierele redabile direct fac doar seek în browser.
- **API:**
  - `GET /api/livetv/channels`
  - `GET /api/livetv/guide?from=&to=`: programele din interval, pentru toate canalele active
  - `GET /api/livetv/channels/:id/now`: emisiunea curentă + următoarea + offset
  - `POST /api/livetv/channels/:id/play`: planul de redare (fișier, offset, URL HLS)
  - CRUD pentru administrare: `POST/PUT/DELETE /api/livetv/channels`, upload logo, `POST /api/livetv/channels/:id/regenerate`
- **Teste:** scheduler (determinism la seed, rotația serialelor, continuitate la regenerare, fișier lipsă), plus adăugarea noilor fișiere `*.test.ts` în scriptul `test` din `apps/server/package.json`.

### Web

- **Setări → Live TV** (`apps/web/src/pages/settings/LiveTvSection.tsx`): lista canalelor, formular de canal (nume, număr, logo generat sau încărcat, reguli, ordine), avertisment la canalele goale, buton de regenerare.
- **Pagina Live TV** (rută nouă + intrare în sidebar), tab-ul **Guide**:
  - desktop: grilă de ~3h, sloturi de 30 min, selector de zi pe 72h, linie verticală „acum”, auto-scroll la ora curentă;
  - mobil: listă „Acum / Urmează” per canal;
  - comportamentul la click de mai sus, cu panou lateral pentru programele viitoare.
- **Player live** (extinde `Player.tsx` sau un `LivePlayer.tsx` separat):
  - pornire la offset, pauză și derulare în limitele emisiunii, **Înapoi la Live**;
  - zapping: săgeți sus/jos, PageUp/PageDown, butoane pe ecran;
  - banner la schimbarea canalului: logo, „Acum”, „Urmează”, progresul emisiunii;
  - tranziție automată la emisiunea următoare.
- Traduceri ro/en în `apps/web/src/i18n.tsx`; tipuri comune în `packages/shared/src/index.ts`.

### Gata când

- Un canal creat din Setări apare în ghid cu 72h de program.
- Click pe emisiunea curentă pornește redarea la minutul corect, atât pentru fișiere redate direct, cât și pentru cele transcodate.
- La sfârșitul emisiunii pornește singură următoarea, iar zapping-ul funcționează.
- Programul nu se schimbă la restartul serverului.
- `pnpm test` și `pnpm typecheck` trec.

### Stare (8 nov. 2026)

Implementată. Pe lângă coloanele din plan, `channel_programs` are `seq` (poziția în ordinea de redare a canalului), din care continuă extinderea programului. Limite cunoscute:

- La fișierele transcodate, derularea înapoi se oprește la punctul de start al sesiunii (`/api/stream/:fileId/at/:start/…`); emisiunea de la început ar cere sesiunea întregului fișier.
- Playerul live nu afișează încă subtitrări.
- O singură transcodare rulează la un moment dat. Spectatorii aceleiași emisiuni folosesc aceeași sesiune, dar două emisiuni diferite urmărite simultan se opresc una pe alta.

## Faza 2 — Organizare și extindere

- **Categorii:** derivate din reguli (gen → categorie), cu suprascriere manuală. Bara de tab-uri: Favorite, Toate și categoriile care au cel puțin un canal.
- **Favorite și ordine per profil:** tabel `profile_channels` (`profile_id`, `channel_id`, `favorite`, `position`), plus o stea în ghid și în player.
- Tab-ul **What's On**: carduri cu emisiunile în curs (imagine, titlu, progres), filtrabile pe categorie.
- **Canale generate automat:** câte unul pe gen și pentru serialele mari (prag configurabil de episoade). Le poți edita sau dezactiva; sunt marcate ca „auto”.
- **Canale de muzică:** reguli pe artist, album sau gen muzical; playerul arată vizualizarea existentă sau coperta albumului.
- **Mini-ghid suprapus** în player.

## Faza 3 — IPTV

- Tabel `iptv_sources` (`id`, `name`, `m3u_url`, `xmltv_url`, `refreshed_at`, `status`); canalele importate au `kind = iptv` și păstrează URL-ul de stream.
- Parser M3U (`tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno`, `group-title`) și parser XMLTV, care scrie în `channel_programs` cu `item_type = external`.
- Potrivire EPG: `tvg-id`, apoi nume, apoi mapare manuală în Setări → Live TV → surse.
- Reîmprospătare la 12h, plus buton manual.
- Redare: un ffmpeg partajat per canal (remux când codecul e compatibil, altfel transcodare, după logica din `apps/server/src/playback/plan.ts`), oprit la ~60s după ultimul spectator. URL-urile sursă nu ajung în browser.
- Categorii din `group-title`, logo și număr din M3U, toate suprascriptibile.

## Faza 4 — Optimizări

- Pre-transcodarea emisiunii următoare, cu câteva minute înainte, pe canalele urmărite activ.
- Opțiune per canal: aliniere la :00/:30, cu umplutură din trailere și clipuri muzicale sau un ecran „Urmează…”.

## Note

- Biblioteca nu salvează colecțiile TMDB (`belongs_to_collection`). O regulă „colecție” are nevoie ca acestea să fie aduse la potrivirea cu TMDB; până atunci, „listă manuală de titluri” acoperă cazul.
