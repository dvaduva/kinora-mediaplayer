# Kinora

Kinora este un media server personal pentru filme, seriale și muzică. Scanează folderele de pe disc sau din rețea, aduce afișe, distribuție și trailere de la TMDB (coperți de album de la MusicBrainz) și redă totul în browser. Ce nu poate fi redat direct este convertit din mers, cu ffmpeg, într-un flux HLS.

Interfața este în română și engleză.

## Cerințe

| Componentă | De ce |
|---|---|
| **Node.js 22+** (testat cu 24) | serverul rulează TypeScript direct, prin `tsx` |
| **pnpm 10** prin Corepack | proiectul e un monorepo pnpm (`corepack enable`) |
| **ffmpeg și ffprobe** | detalii tehnice, subtitrări din fișier, remux și transcodare |
| **Token TMDB** (opțional) | metadate pentru filme și seriale |

Pe Windows, ffmpeg se instalează cel mai simplu cu:

```powershell
winget install Gyan.FFmpeg
```

Kinora îl găsește în `PATH` sau în folderul de pachete winget, deci nu e nevoie să repornești terminalul după instalare. Fără ffprobe lipsesc detaliile tehnice. Fără ffmpeg se redau doar fișierele compatibile direct cu browserul.

Tokenul TMDB este „API Read Access Token” din [setările contului TMDB](https://www.themoviedb.org/settings/api). Îl introduci în pagina **Setări** din aplicație.

## Pornire

```bash
corepack enable
pnpm install
pnpm dev
```

- Interfața de dezvoltare: <http://localhost:5173>. Vite trimite cererile `/api` către server.
- Serverul: <http://127.0.0.1:3001>.

La prima pornire, deschide **Setări**, adaugă un folder (filme, seriale sau muzică, câte o cale pe linie) și, opțional, tokenul TMDB. Scanarea pornește imediat. Folderele sunt urmărite, așa că fișierele noi apar singure.

### Utilizare zilnică (fără Vite)

```bash
pnpm build   # compilează interfața în apps/web/dist
pnpm start   # serverul livrează interfața și API-ul pe portul 3001
```

## Configurare

Majoritatea setărilor se fac din pagina **Setări** și se păstrează în baza de date. Câteva sunt variabile de mediu:

| Variabilă | Implicit | Rol |
|---|---|---|
| `PORT` | `3001` | portul serverului |
| `KINORA_ALLOWED_ORIGINS` | – | origini suplimentare acceptate pentru API, separate prin virgulă (de ex. un reverse proxy: `https://media.acasa`) |
| `KINORA_VIDEO_ENCODER` | `libx264` | encoderul H.264 folosit la transcodare, de ex. `h264_nvenc` (NVIDIA), `h264_qsv` (Intel), `h264_amf` (AMD) |

### Acces din rețea

Implicit, Kinora ascultă doar pe `127.0.0.1`. Pentru acces de pe alte dispozitive:

1. În **Setări**, alege o cheie de acces.
2. Schimbă adresa în `0.0.0.0` sau în IP-ul calculatorului.
3. Repornește serverul.

Serverul refuză să pornească pe o adresă externă fără cheie de acces. Cheia se trimite ca header `Authorization: Bearer …` sau prin cookie-ul setat la autentificare.

Protecții incluse:
- API-ul acceptă cereri din browser doar de la pagina servită de Kinora, de la serverul Vite sau din `KINORA_ALLOWED_ORIGINS`. Alte site-uri primesc `403`.
- Cât timp serverul ascultă doar local, un `Host` care nu e local primește `421`, ca protecție împotriva DNS rebinding.
- Fișierele sunt servite doar din interiorul folderelor bibliotecilor.

## Cum se redă un fișier

| Fișier | Mod | Ce face serverul |
|---|---|---|
| MP4/MOV/M4V cu H.264 și AAC/MP3, WebM cu H.264/VP9 și Opus/Vorbis | `direct` | trimite fișierul cu suport pentru HTTP Range |
| H.264 cu AAC/MP3 în alt container (MKV, AVI, TS) | `remux` | copiază pistele în segmente HLS (rapid) |
| H.264 cu alt sunet (AC-3, E-AC-3, DTS…) | `transcode` | copiază imaginea, convertește sunetul în AAC stereo |
| Alt codec video (HEVC, AV1, VP9 în MKV, MPEG-4…) | `transcode` | convertește imaginea în H.264 8-bit (maxim 1080p) |

Limitări cunoscute:
- Conversia pornește de la începutul fișierului. Când imaginea trebuie convertită, reluarea de la o poziție avansată sau derularea înainte așteaptă până ajunge encoderul acolo.
- Conținutul HDR este convertit fără tone mapping, deci culorile pot ieși mai șterse.
- Rulează o singură conversie odată: deschiderea altui fișier o oprește pe cea curentă.

### Cache-ul de conversii

Fiecare conversie se păstrează în `data/cache/transcode`, ca a doua vizionare să pornească instant. Cache-ul are o limită (implicit 30 GB, modificabilă în **Setări**):
- conversiile nefolosite de 30 de zile se șterg automat;
- peste limită se șterg, pe rând, cele vizionate cel mai demult;
- conversia în curs nu se șterge niciodată;
- butonul **Golește conversiile** șterge tot, mai puțin conversia în curs.

### Subtitrări

- Subtitrările externe (`.srt`, `.vtt`, `.ass`, `.ssa`) de lângă fișierul video sunt găsite automat, la fel și cele încorporate în fișier.
- Toate sunt convertite în WebVTT. Fișierele în Windows-1250 sunt decodate, iar diacriticele românești sunt corectate (ş→ș, ţ→ț).
- Subtitrările încorporate ajung la player pe bucăți de 60 de secunde, în jurul poziției din film:
  - la remux sau transcodare, aceeași comandă ffmpeg care face streamul le scrie și pe ele, fără o citire în plus a fișierului;
  - la redare directă (sau pentru porțiuni convertite înainte), serverul sare la poziția respectivă și citește doar acea fereastră, una singură odată; ferestrele pe lângă care s-a trecut cu seek sunt anulate.
  - Bucățile citite rămân în `data/cache/subtitles/chunks`.
- Subtitrările de tip imagine (PGS, VobSub) nu pot fi afișate.

## Interfața TV

Kinora include o interfață dedicată televizoarelor (D-pad / 10-foot) în `apps/tv`.

### Din browser (dezvoltare)

```bash
pnpm dev
```

- TV UI: <http://localhost:5174/tv/>
- Desktop UI: <http://localhost:5173>
- API: <http://127.0.0.1:3001>

Pe un televizor sau cu tastatura ca telecomandă: săgeți pentru navigare, Enter pentru selectare, Backspace/Escape pentru înapoi. În player: Enter/Space pauză, ←/→ seek ±10s.

### Din rețeaua locală (producție)

1. În **Setări** (interfața web), setează o cheie de acces și leagă serverul de `0.0.0.0` (sau IP-ul PC-ului), apoi repornește.
2. Construiește ambele interfețe și pornește serverul:

```bash
pnpm build
pnpm start
```

3. Pe televizor sau telefon deschide `http://<ip-pc>:3001/tv/`.

Aceeași origine ca API-ul permite redarea directă a fișierelor (cookie de sesiune). Shell-urile Tizen/webOS din `apps/tv/tizen` și `apps/tv/webos` sunt ambalaje subțiri care cer adresa serverului și deschid `/tv/`.

#### Sideload pe Samsung Tizen

1. Activează Developer Mode pe TV și notează IP-ul.
2. În Tizen Studio, importă `apps/tv/tizen` și conectează televizorul.
3. Rulează / instalează pachetul pe dispozitiv.
4. La prima deschidere introdu `http://<ip-pc>:3001`.

#### Sideload pe LG webOS

1. Activează Developer Mode și instalează [webOS CLI](https://webostv.developer.lge.com/).
2. Empachetează folderul `apps/tv/webos` (`ares-package apps/tv/webos`).
3. Instalează IPK-ul pe TV (`ares-install`).
4. La prima deschidere introdu adresa Kinora.

### Checklist rapid (tastatură ca telecomandă)

- [ ] Deschide `/tv/`, autentifică-te dacă e nevoie de cheie
- [ ] Navighează Acasă → Filme / Seriale cu săgețile
- [ ] Deschide un titlu, apasă Redă
- [ ] Pauză cu Enter, seek cu săgeți, ieșire cu Escape
- [ ] Progresul apare la „Continuă vizionarea” după ce te întorci

## Structura proiectului

```
apps/server     API Fastify, scanare, metadate, streaming (TypeScript, tsx)
  drizzle/      migrațiile bazei de date (generate)
  src/db/       schema Drizzle și rularea migrațiilor
  src/playback/ plan de redare, HLS, subtitrări, cache
apps/web        interfața React (Vite)
apps/tv         interfața TV (Vite) + shell-uri Tizen/webOS
packages/shared tipurile comune ale API-ului
data/           baza SQLite și cache-urile (nu intră în git)
```

## Baza de date

Datele stau în `data/kinora.db` (SQLite, mod WAL). Schema este definită în [apps/server/src/db/schema.ts](apps/server/src/db/schema.ts), iar migrațiile se aplică automat la pornire. Bazele create înainte de migrații sunt preluate de la versiunea de bază.

Pentru a modifica schema:

```bash
# 1. editează apps/server/src/db/schema.ts
pnpm --filter @kinora/server db:generate --name descriere_scurta
# 2. verifică SQL-ul generat în apps/server/drizzle/ și pune-l în același commit
```

Cheile străine sunt active. Ștergerea unei biblioteci șterge în cascadă titlurile, fișierele, subtitrările și progresul de vizionare. Migrațiile rulează cu verificarea cheilor oprită și se termină cu `PRAGMA foreign_key_check`.

## Teste

```bash
pnpm test        # testele serverului (node:test)
pnpm typecheck   # server și interfață
```

Testele care pornesc ffmpeg sunt sărite automat dacă ffmpeg lipsește. Un fișier de test nou trebuie adăugat în scriptul `test` din [apps/server/package.json](apps/server/package.json).
