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

### Stare (8 nov. 2026)

Implementată (migrarea `0006_live_tv_phase2`). Detalii și abateri de la plan:

- **Categorii:** prima regulă de gen dă categoria; canalele cu reguli de un singur tip primesc „Filme”, „Seriale” sau „Muzică”; regulile amestecate nu dau categorie (canalul apare doar la „Toate”). Derivarea e în `packages/shared`, ca formularul să arate categoria propusă.
- **Ordinea per profil** se schimbă din Setări → Live TV (săgeți sus/jos, „Ordine după număr”). Zapping-ul o respectă.
- **Canale auto:** oprite implicit; se pornesc din Setări (prag implicit: 20 de episoade). Se sincronizează la pornire, la fiecare oră și după fiecare scanare. Un gen are nevoie de cel puțin 3 titluri; la muzică intră doar cele mai mari 8 genuri cu cel puțin 15 piese, fără valori ca „Other” sau „Unknown”. Un canal auto șters nu mai e generat („Readu canalele auto șterse” le aduce înapoi). Canalele auto rămase fără conținut nu se șterg singure, pentru că un disc deconectat le-ar renumerota; se ascund din ghid ca orice canal gol.
- **Muzică:** `tracks.genre` se citește din taguri la scanare. Piesele scanate dinainte primesc genul o singură dată, la următoarea scanare. Regula „bibliotecă” acceptă acum și bibliotecile de muzică. În ordinea secvențială, albumele se redau cap-coadă, pe rând. Spectrul pornește doar după ce contextul audio rulează, ca să nu amuțească redarea.
- **Mini-ghid:** tasta `G` sau butonul din bară; filtrabil pe categorie, cu săgeți sus/jos între rânduri.
- Videoclipurile muzicale (`ClipLoop`) nu apar încă în vizualizarea live.

## Faza 3 — IPTV

- Tabel `iptv_sources` (`id`, `name`, `m3u_url`, `xmltv_url`, `refreshed_at`, `status`); canalele importate au `kind = iptv` și păstrează URL-ul de stream.
- Parser M3U (`tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno`, `group-title`) și parser XMLTV, care scrie în `channel_programs` cu `item_type = external`.
- Potrivire EPG: `tvg-id`, apoi nume, apoi mapare manuală în Setări → Live TV → surse.
- Reîmprospătare la 12h, plus buton manual.
- Redare: un ffmpeg partajat per canal (remux când codecul e compatibil, altfel transcodare, după logica din `apps/server/src/playback/plan.ts`), oprit la ~60s după ultimul spectator. URL-urile sursă nu ajung în browser.
- Categorii din `group-title`, logo și număr din M3U, toate suprascriptibile.

### Stare (8 nov. 2026)

Implementată (migrarea `0007_live_tv_iptv`). Detalii și abateri de la plan:

- **Date:** pe lângă `iptv_sources`, tabelul `iptv_epg_channels` ține canalele din ghid, pentru maparea manuală. Coloanele IPTV stau direct în `channels` (`stream_url`, `tvg_id`, `group_title`, `remote_logo`, `epg_channel`, `epg_match`, `iptv_missing` etc.). Sursa poate fi un URL http(s) sau o cale absolută pe server; dacă XMLTV lipsește, se folosește `url-tvg` din antetul M3U. Ghidurile `.gz` sunt suportate, iar XMLTV se citește în flux.
- **Reîmprospătare:** un canal e recunoscut după `tvg-id` + nume, chiar dacă URL-ul se schimbă. Un nume modificat manual rămâne. Numărul din `tvg-chno` se folosește doar dacă e liber și se atribuie o singură dată. Canalele dispărute din playlist sunt marcate „lipsă” (își păstrează favoritele) și se ascund din ghid. Canalele IPTV nu se șterg individual: se dezactivează sau se șterge sursa. Ghidul descărcat rămâne în cache, așa că o mapare manuală se aplică fără o nouă descărcare. Maparea manuală are prioritate față de potrivirea automată.
- **Releu** (`livetv/relay.ts`): un singur ffmpeg per canal, cu `ffprobe` înainte pentru alegerea între remux și transcodare (aceleași reguli ca în `plan.ts`). Produce o fereastră HLS de 5 minute în `data/cache/iptv/<canal>`, cu `-protocol_whitelist` (fără `file:`) și reconectare automată la http. Se oprește după ~60s fără cereri și pornește din nou de până la 5 ori cât timp cineva se uită. Implicit rulează cel mult 4 relee simultan (`KINORA_IPTV_MAX_STREAMS`). URL-urile sursă și erorile ffmpeg care le conțin nu ajung la browser.
- **Player:** IPTV rulează în modul `live`, la marginea fluxului. Pauza și derularea funcționează doar în fereastra de 5 minute, nu de la începutul emisiunii. Bannerul se actualizează din EPG fără să repornească streamul, iar fără EPG afișează „Fără informații de program”.
- **Logo-urile** `tvg-logo` sunt descărcate de server și păstrate în cache (doar PNG/JPEG/GIF/WebP). Imaginile programelor din XMLTV nu se folosesc.
- **Surse publice:** butoanele „+ România” și „+ Republica Moldova” din Setări adaugă playlisturile iptv-org (`IPTV_PRESETS` din `packages/shared`), adică doar stream-uri făcute publice de posturi, cu ghidul de la iptv-epg.org. Moldova nu are ghid propriu și folosește ghidul românesc, care acoperă canalele `.ro` din listă. Potrivirea după `tvg-id` ignoră sufixul `@SD`/`@HD` al iptv-org, iar din nume se elimină notele „(1080p)” și „[Not 24/7]”. La testul din 8 nov. 2026, România a avut 183 de canale, dintre care 76 cu ghid. Unele stream-uri sunt oprite temporar sau blocate geografic.
- Opțiunile `#EXTVLCOPT` (user-agent sau referrer per canal) nu sunt suportate încă. Playlisturile mari (mii de canale) încarcă greu ghidul și lista din Setări.

## Faza 4 — Optimizări

- Pre-transcodarea emisiunii următoare, cu câteva minute înainte, pe canalele urmărite activ.
- Opțiune per canal: aliniere la :00/:30, cu umplutură din trailere și clipuri muzicale sau un ecran „Urmează…”.

### Stare (8 nov. 2026)

Implementată (migrarea `0008_live_tv_alignment`). Detalii și abateri de la plan:

- **Pre-transcodare** (`livetv/prepare.ts`, `prepareUpcoming` în `channels.ts`, la fiecare 15s): un canal virtual e „urmărit” cât timp playerul trimite `POST /api/livetv/channels/:id/watching` (la 30s; și `/play` contează), cu expirare la 90s. Cu 5 minute înainte de următoarea emisiune a unui canal urmărit, fișierul ei e transcodat întreg, în fundal. Conversia de fundal nu o oprește pe cea a spectatorului, iar cât timp aceea încă rulează, pregătirea așteaptă până la 90s înainte de start, ca două encodere să nu împartă procesorul mult timp. Rulează cel mult o conversie de fundal. La începutul emisiunii, playerul preia conversia deja pornită. Dacă nimeni nu mai urmărește canalul, conversia se oprește, iar ce s-a scris rămâne în cache și se continuă la nevoie. Fișierele redate direct sau deja convertite sunt sărite. Un fișier lipsă e găsit la pregătire, iar programul se reface înainte ca cineva să ajungă la el. Se poate opri din Setări → Live TV („Pregătire”, pornită implicit).
- **Aliniere:** per canal virtual, „fără” / „la :00 și :30” / „la ora fixă” (`align_minutes` 0/30/60, după ora locală a serverului). Golul dinaintea fiecărei emisiuni devine un program `item_type = filler`, fără fișier, care nu consumă poziții din ordinea de redare. Un canal nou pornește imediat, aliniat de la a doua emisiune. La editare, emisiunea în curs rămâne, iar următoarele se aliniază. Golurile sub o secundă se lipesc de emisiunea anterioară. „Urmează” (banner, ghid, What's On, mini-ghid) sare peste umpluturi.
- **Umplutură** (`filler`: `media` sau `upnext`): `media` redă, prin playerul YouTube, întâi trailerele titlurilor canalului, apo pe ale restului bibliotecii, apoi clipurile muzicale deja găsite pentru albume (cache-ul din `data/cache/clips`). La canalele de muzică, clipurile vin primele. Lista e stabilă pentru aceeași umplutură. Peste ele apare cardul „Urmează…”, cu titlul, ora și numărătoarea inversă. Dacă niciun clip nu pornește (offline, încorporare blocată), sau la `upnext`, rămâne doar cardul, peste imaginea emisiunii următoare. Fără un click recent, browserul poate porni clipurile fără sunet.
- În ghid, umpluturile apar ca blocuri hașurate. Click pe una în curs pornește canalul. Una viitoare nu deschide panoul.

## Note

- Biblioteca nu salvează colecțiile TMDB (`belongs_to_collection`). O regulă „colecție” are nevoie ca acestea să fie aduse la potrivirea cu TMDB; până atunci, „listă manuală de titluri” acoperă cazul.
