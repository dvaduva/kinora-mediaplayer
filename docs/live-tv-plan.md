# Live TV — implementation plan

A **Live TV** menu in Kinora, with an EPG guide (channels in rows, time in columns), "What's On" and categories. Channels come from two sources that share one data model (channel → program with `start`/`end`):

- **virtual channels** built from your own library (pseudo-TV);
- **IPTV** from M3U playlists, with XMLTV EPG.

## Decisions

| Topic | Decision |
|---|---|
| Sources | Virtual channels (phase 1) + IPTV (phase 3), on the same model |
| "Live" playback | Each client starts at the computed offset (`now − start`); no frame sync between clients |
| Seeking | Pause and rewind within the current program; forward at most up to "now"; a **Back to Live** button |
| Creating channels | Manual (phase 1), then also generated automatically, editable and disableable (phase 2) |
| Order | Per-channel setting: sequential / shuffle. Shuffle uses a per-channel seed, so it is stable across restarts. Default: movies shuffled, series sequential with rotation between series |
| Grid | Continuous schedule, no alignment to :00/:30 (alignment with filler comes in phase 4) |
| Schedule | Materialized in the DB for 72h; regenerated daily, when the channel is edited, and when a scheduled file is missing |
| Missing file | Regenerate from that point on; the channel moves to the next item |
| Channel with no content | Hidden from the guide, with a warning in Settings |
| Music | Audio channels in phase 2 (visualizer or cover on screen) |
| IPTV | Several M3U sources, each with an optional EPG; always played through the server (remux, transcode only when needed); one shared ffmpeg per channel, stopped ~60s after the last viewer; refresh every 12h + a manual button |
| EPG matching | `tvg-id` → name → manual mapping in Settings |
| Channels / profiles | Channels are global; favorites and order are per profile |
| Categories | Derived automatically (the channel's rule, or `group-title` for IPTV), with manual override. Fixed tabs: Favorites, All |
| Logo / number | Generated logo (name on a color derived from the name) or uploaded; editable number with an automatic suggestion. For IPTV: `tvg-logo` and `tvg-chno` |
| Click in the guide | On air → live playback. Upcoming → side panel with details (+ "See in library"). Past → dimmed, with "Play from library" on virtual channels only |
| Progress | Live TV does not change `progress` and does not mark anything as watched |
| Starting in the middle of a transcoded file | Transcoding from an arbitrary start point (phase 1); pre-transcoding the next program (phase 4) |

### Out of scope

DVR/recording, physical tuners (HDHomeRun/DVB), IPTV catch-up, frame sync between clients.

## Phase 1 — Virtual channels (MVP)

**Goal:** create a channel from the library, see it in the guide and watch it like TV.

### Server

- **DB schema** (new migration in `apps/server/drizzle`, definitions in `apps/server/src/db/schema.ts`):
  - `channels`: `id`, `kind` (`virtual` | `iptv`), `number`, `name`, `logo_path`, `order_mode` (`sequential` | `shuffle`), `seed`, `enabled`, `category_override`, `created_at`, `updated_at`
  - `channel_sources`: rules per channel, `channel_id`, `type`, `value`. Types in phase 1: `genre`, `series`, `movie` (manual list of titles), `library`, `decade`, `person` (actor or director, from `cast_json`/`directors_json`)
  - `channel_programs`: `channel_id`, `start`, `end`, `item_type` (`movie` | `episode` | `track` | `external`), `item_id`, `file_id`, `title`, `subtitle` (e.g. "S1 · E4"), `description`, `image`. Index on (`channel_id`, `start`)
- **Scheduler** (`apps/server/src/livetv/schedule.ts`):
  - resolves the rules into a list of items with a duration, taken from `media_files` or `runtime`;
  - orders them: sequential (episodes in order, rotating between series) or shuffled with the seed;
  - lays items back to back up to `now + 72h`, continuing where the existing schedule ended;
  - triggers: a daily job, saving a channel, a missing file detected during playback or scanning.
- **Transcoding from an arbitrary start:** `ensureTranscode` in `apps/server/src/playback/transcode.ts` takes a start point and starts a new session at that offset (`-ss`, segments numbered from there). Files that play directly just seek in the browser.
- **API:**
  - `GET /api/livetv/channels`
  - `GET /api/livetv/guide?from=&to=`: programs in the range, for all active channels
  - `GET /api/livetv/channels/:id/now`: current program + next + offset
  - `POST /api/livetv/channels/:id/play`: the playback plan (file, offset, HLS URL)
  - Admin CRUD: `POST/PUT/DELETE /api/livetv/channels`, logo upload, `POST /api/livetv/channels/:id/regenerate`
- **Tests:** scheduler (seed determinism, series rotation, continuity across regeneration, missing file), plus adding the new `*.test.ts` files to the `test` script in `apps/server/package.json`.

### Web

- **Settings → Live TV** (`apps/web/src/pages/settings/LiveTvSection.tsx`): channel list, channel form (name, number, generated or uploaded logo, rules, order), warning for empty channels, regenerate button.
- **Live TV page** (new route + sidebar entry), **Guide** tab:
  - desktop: ~3h grid, 30-minute slots, day picker over 72h, vertical "now" line, auto-scroll to the current time;
  - mobile: "Now / Next" list per channel;
  - the click behavior above, with a side panel for upcoming programs.
- **Live player** (extends `Player.tsx` or a separate `LivePlayer.tsx`):
  - start at the offset, pause and seek within the program, **Back to Live**;
  - zapping: up/down arrows, PageUp/PageDown, on-screen buttons;
  - banner on channel change: logo, "Now", "Next", program progress;
  - automatic transition to the next program.
- ro/en translations in `apps/web/src/i18n.tsx`; shared types in `packages/shared/src/index.ts`.

### Done when

- A channel created in Settings appears in the guide with 72h of schedule.
- Clicking the current program starts playback at the right minute, for both directly played and transcoded files.
- At the end of a program the next one starts on its own, and zapping works.
- The schedule does not change when the server restarts.
- `pnpm test` and `pnpm typecheck` pass.

### Status (Nov 8, 2026)

Implemented. Besides the columns in the plan, `channel_programs` has `seq` (the position in the channel's play order), from which the schedule extension continues. Known limitations:

- For transcoded files, rewinding stops at the session's start point (`/api/stream/:fileId/at/:start/…`); the program from its beginning would need the session for the whole file.
- The live player does not show subtitles yet.
- Only one transcode runs at a time. Viewers of the same program share one session, but two different programs watched at the same time stop each other.

## Phase 2 — Organization and expansion

- **Categories:** derived from rules (genre → category), with manual override. Tab bar: Favorites, All and every category with at least one channel.
- **Favorites and order per profile:** `profile_channels` table (`profile_id`, `channel_id`, `favorite`, `position`), plus a star in the guide and in the player.
- **What's On** tab: cards with the programs on air (image, title, progress), filterable by category.
- **Automatically generated channels:** one per genre and for large series (configurable episode threshold). You can edit or disable them; they are marked "auto".
- **Music channels:** rules by artist, album or music genre; the player shows the existing visualizer or the album cover.
- **Mini guide** overlaid in the player.

### Status (Nov 8, 2026)

Implemented (migration `0006_live_tv_phase2`). Details and deviations from the plan:

- **Categories:** the first genre rule gives the category; channels whose rules are all of one type get "Movies", "Series" or "Music"; mixed rules give no category (the channel appears only under "All"). The derivation lives in `packages/shared`, so the form can show the suggested category.
- **Per-profile order** is changed in Settings → Live TV (up/down arrows, "Order by number"). Zapping follows it.
- **Auto channels:** off by default; turned on in Settings (default threshold: 20 episodes). They sync at startup, every hour and after every scan. A genre needs at least 3 titles; for music, only the 8 largest genres with at least 15 tracks are used, without values like "Other" or "Unknown". A deleted auto channel is not generated again ("Bring back deleted automatic channels" restores them). Auto channels left with no content are not deleted on their own, because a disconnected disk would renumber them; they are hidden from the guide like any empty channel.
- **Music:** `tracks.genre` is read from tags during scanning. Tracks scanned earlier get their genre once, on the next scan. The "library" rule now also accepts music libraries. In sequential order, albums play start to finish, one after another. The spectrum starts only once the audio context is running, so playback is not muted.
- **Mini guide:** the `G` key or the button in the bar; filterable by category, with up/down arrows between rows.
- Music videos (`ClipLoop`) do not appear in the live view yet.

## Phase 3 — IPTV

- `iptv_sources` table (`id`, `name`, `m3u_url`, `xmltv_url`, `refreshed_at`, `status`); imported channels have `kind = iptv` and keep the stream URL.
- M3U parser (`tvg-id`, `tvg-name`, `tvg-logo`, `tvg-chno`, `group-title`) and XMLTV parser, which writes into `channel_programs` with `item_type = external`.
- EPG matching: `tvg-id`, then name, then manual mapping in Settings → Live TV → sources.
- Refresh every 12h, plus a manual button.
- Playback: one shared ffmpeg per channel (remux when the codec is compatible, otherwise transcode, following the logic in `apps/server/src/playback/plan.ts`), stopped ~60s after the last viewer. Source URLs never reach the browser.
- Categories from `group-title`, logo and number from the M3U, all overridable.

### Status (Nov 8, 2026)

Implemented (migration `0007_live_tv_iptv`). Details and deviations from the plan:

- **Data:** besides `iptv_sources`, the `iptv_epg_channels` table holds the guide's channels, for manual mapping. The IPTV columns live directly in `channels` (`stream_url`, `tvg_id`, `group_title`, `remote_logo`, `epg_channel`, `epg_match`, `iptv_missing`, etc.). The source can be an http(s) URL or an absolute path on the server; if there is no XMLTV, `url-tvg` from the M3U header is used. `.gz` guides are supported, and XMLTV is read as a stream.
- **Refresh:** a channel is recognized by `tvg-id` + name, even if its URL changes. A manually changed name is kept. The number from `tvg-chno` is used only if it is free, and is assigned only once. Channels that disappear from the playlist are marked "missing" (they keep their favorites) and are hidden from the guide. IPTV channels are not deleted one by one: you disable them or delete the source. The downloaded guide stays in the cache, so a manual mapping applies without a new download. Manual mapping takes priority over automatic matching.
- **Relay** (`livetv/relay.ts`): one ffmpeg per channel, with `ffprobe` first to choose between remux and transcode (the same rules as in `plan.ts`). It produces a 5-minute HLS window in `data/cache/iptv/<channel>`, with `-protocol_whitelist` (no `file:`) and automatic reconnect for http. It stops after ~60s without requests and restarts up to 5 times while someone is watching. By default at most 4 relays run at once (`KINORA_IPTV_MAX_STREAMS`). Source URLs, and ffmpeg errors that contain them, never reach the browser.
- **Player:** IPTV runs in `live` mode, at the edge of the stream. Pause and seek work only within the 5-minute window, not from the beginning of the program. The banner updates from the EPG without restarting the stream, and without an EPG it shows "No program information".
- **Logos** from `tvg-logo` are downloaded by the server and cached (PNG/JPEG/GIF/WebP only). Program images from XMLTV are not used.
- **Public sources:** the "+ România" and "+ Republica Moldova" buttons in Settings add the iptv-org playlists (`IPTV_PRESETS` in `packages/shared`), that is, only streams the broadcasters made public, with the guide from iptv-epg.org. Moldova has no guide of its own and uses the Romanian guide, which covers the `.ro` channels in its list. Matching by `tvg-id` ignores iptv-org's `@SD`/`@HD` suffix, and the "(1080p)" and "[Not 24/7]" notes are stripped from names. In the test on Nov 8, 2026, Romania had 183 channels, 76 of them with a guide. Some streams are temporarily down or geo-blocked.
- `#EXTVLCOPT` options (per-channel user agent or referrer) are not supported yet. Large playlists (thousands of channels) make the guide and the Settings list slow to load.

## Phase 4 — Optimizations

- Pre-transcoding the next program, a few minutes ahead, on channels being watched.
- Per-channel option: alignment to :00/:30, with filler from trailers and music videos or an "Up next…" screen.

### Status (Nov 8, 2026)

Implemented (migration `0008_live_tv_alignment`). Details and deviations from the plan:

- **Pre-transcoding** (`livetv/prepare.ts`, `prepareUpcoming` in `channels.ts`, every 15s): a virtual channel counts as "watched" while the player sends `POST /api/livetv/channels/:id/watching` (every 30s; `/play` counts too), expiring after 90s. Five minutes before the next program on a watched channel, its file is transcoded in full, in the background. The background conversion does not stop the viewer's, and while that one is still running, preparation waits until 90s before the start, so two encoders do not share the CPU for long. At most one background conversion runs. When the program starts, the player picks up the conversion already in progress. If nobody is watching the channel any more, the conversion stops; what was written stays in the cache and continues when needed. Files played directly or already converted are skipped. A missing file is found during preparation, and the schedule is rebuilt before anyone reaches it. It can be turned off in Settings → Live TV ("Preparation", on by default).
- **Alignment:** per virtual channel, "No alignment" / "On :00 and :30" / "On the hour" (`align_minutes` 0/30/60, by the server's local time). The gap before each program becomes an `item_type = filler` program, with no file, which does not use up positions in the play order. A new channel starts immediately, aligned from the second program. On edit, the program on air stays and the following ones are aligned. Gaps under one second are merged into the previous program. "Next" (banner, guide, What's On, mini guide) skips filler.
- **Filler** (`filler`: `media` or `upnext`): `media` plays, through the YouTube player, first the trailers of the channel's titles, then those from the rest of the library, then the music videos already found for albums (the cache in `data/cache/clips`). On music channels, music videos come first. The list is stable for the same filler. The "Up next…" card is shown on top, with the title, time and countdown. If no clip starts (offline, embedding blocked), or with `upnext`, only the card remains, over the next program's image. Without a recent click, the browser may start clips muted.
- In the guide, fillers appear as hatched blocks. Clicking one on air starts the channel. An upcoming one does not open the panel.

## Notes

- The library does not store TMDB collections (`belongs_to_collection`). A "collection" rule needs them to be fetched during TMDB matching; until then, "manual list of titles" covers the case.
