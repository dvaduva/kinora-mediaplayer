# Smart TV apps — architecture and implementation plan

Kinora on Samsung Tizen, LG webOS and Android TV / Google TV (Fire TV included). This document records why the TV apps are clients of a Kinora server, the decisions behind them, and the phased plan to build them.

Current state (November 2026): `apps/tv` is a React (Vite) 10-foot UI with D-pad navigation (`@noriginmedia/norigin-spatial-navigation`). Phases 0 to 3 are implemented (capability profiles: TVs play directly what they decode; on Tizen through Samsung's native player, AVPlay; on webOS through LG's native `<video>` pipeline, HLS included). Phase 0: `apps/tv-shell` is built into `apps/tv/tizen` and `apps/tv/webos` and handles discovery, pairing, the offline screen and the version check; it still has to pass the checklist on real TVs. There is no Android TV app yet.

## Client–server or standalone?

### Why not a standalone TV app

| What Kinora does | Can it run on the TV? |
|---|---|
| Scan libraries on local disks and NAS shares | **No** on Tizen/webOS: web apps have no file system or SMB access. Possible on Android TV, but awkward. |
| Remux and transcode with ffmpeg | **No.** There is no ffmpeg and the CPU is too weak. A file the TV cannot decode simply does not play. |
| TMDB metadata, subtitle cache, EPG and IPTV relay | In theory, but storage is small and it would be written three times (Tizen JS, webOS JS, Android Kotlin). |
| Watch progress shared between TV, desktop and phone | **No**, not without a central server. |

A standalone app would be a Kodi rewritten three times, and it still could not run on Tizen or webOS. Its one real advantage is not depending on a PC being on.

**Decision:** the Kinora server stays the source of truth (library, metadata, progress, transcoding). TV apps are clients. They are *smart* clients: they report what they can decode, use the platform's native player where it helps, and ask for transcoding only as a fallback.

### Risks of the client–server model, and what the code shows today

1. **The server is a single point of failure.** With the PC off, the TV can do nothing. Worse, the Tizen wrapper redirects straight to the saved address ([apps/tv/tizen/index.html](../apps/tv/tizen/index.html)); if the server is down or its IP changed, the user is stuck on an error page with no way to change the address.
2. **Playback decisions are made for a browser, not a TV.** [plan.ts](../apps/server/src/playback/plan.ts) plays only H.264/VP9 in MP4/WebM directly and remuxes or transcodes everything else. TVs decode HEVC, AC-3/E-AC-3, MKV, 4K and HDR in hardware. The server burns CPU for nothing and the TV gets worse quality (HDR lost, 5.1 folded to stereo AAC). This is the biggest gap: there are no client capability profiles.
3. **Only one transcode runs at a time.** Two TVs that both need a transcode stop each other. Direct play on capable TVs is the main fix; hardware encoding helps the rest.
4. **Remote keys are only partly handled.** There is no `tizen.tvinputdevice.registerKey` and no handling of the Back key codes (10009 on Tizen, 461 on webOS). Media keys (Play/Pause/FF/RW) do not work, and Back may close the app.
5. **The UI is loaded from the server.** The wrapper does `location.replace(<server>/tv/)`. Updates ship with the server, but there is no offline screen, the wrapper and server versions can drift apart, and Samsung and LG stores generally reject thin wrappers around remote web pages.
6. **Setup is painful.** The user types `http://192.168.x.x:3001` with a remote. There is no discovery or pairing.
7. **LAN only, plain HTTP, one shared key.** Remote access would need HTTPS, a tunnel or reverse proxy, and per-device credentials.

## Decisions

| Topic | Decision |
|---|---|
| Architecture | Kinora server + smart TV clients; no standalone app |
| Distribution | Sideload (Developer Mode) now; public stores in a later phase. Nothing in the design may block store builds |
| Platforms | Tizen, webOS and Android TV, all three tested on real devices. Fire TV comes with the Android TV app |
| Platform order | Shared foundation → Tizen → webOS → Android TV |
| Network | LAN only for now. Remote access is a separate later phase, with Tailscale as the recommended route |
| Playback | Per-device capability profile as the shared foundation; then native players per platform (AVPlay on Tizen, ExoPlayer/Media3 on Android TV) |
| Who decides the playback mode | The server. The client sends its profile (stored on the device token); the server returns `direct` / `remux` / `transcode` with a reason. The desktop web UI uses a `browser` profile that behaves exactly like today |
| Capability detection | Runtime detection (`MediaSource.isTypeSupported`, `canPlayType`, platform APIs, Android codec queries) + static per-platform overrides (TVs sometimes report support they lack, e.g. DTS with no sound) + per-device switches in Settings (force transcode, resolution and bitrate cap) |
| Transcode fallback | Still H.264, but audio keeps 5.1 (AC-3/E-AC-3) when the TV supports it. Hardware encoding is its own later phase |
| Subtitles | Text subtitles are rendered by Kinora over the video on every platform (timing from `@kinora/client`), so look and settings are the same everywhere. PGS/VobSub burned in during transcode, later phase |
| UI delivery | Hybrid: a bundled shell (connect, discovery, pairing, server switch, offline screen, version check) loads the UI from the server once `/api/health` reports a compatible `apiVersion`. The UI must stay buildable as a fully bundled app for the store phase |
| Discovery | Automatic where possible, manual IP as fallback, a list of known servers, and a "Change server" screen that is always reachable. Android: mDNS (`_kinora._tcp`) via NSD. Tizen/webOS: no mDNS in web apps, so the shell reads the TV's IP (`webapis.network.getIp()` on Tizen, Luna `connectionmanager` on webOS) and scans the /24 subnet for `/api/health` (short timeout, parallel requests, ~2–4 s), trying the last known port first |
| Pairing | The TV requests a code (`POST /api/pair`) and shows a 6-character code plus a QR code for `http://<server>/pair?code=…`. The user approves it in the web UI or on a phone, while signed in. The TV polls and receives a device token. Codes expire after 5 minutes. Typing the access key stays as a fallback |
| Authentication | One token per device, with a device list in Settings (name, platform, last seen, revoke). The shared access key stays as a fallback |
| Android TV technology | A thin Kotlin app: a WebView loads the same `/tv/` UI, and a JS↔native bridge hands playback to ExoPlayer/Media3. One UI for every platform; a fully native app (Compose for TV) stays an option if the WebView proves slow on weak devices |
| Server availability | Document running the server as a service (Windows service, systemd) now. Docker for NAS and Wake-on-LAN in a later phase |
| UI language | Auto-detected from `navigator.language` (Romanian for `ro-*`, otherwise English), with the manual choice saved as today. The shells use the same dictionary |
| Repo layout | See below |
| Build and CI | `pnpm tv:package:tizen`, `pnpm tv:package:webos`, `pnpm tv:package:android`. GitHub Actions builds the APK and IPK on tags; Tizen stays local because the Samsung certificate is tied to the account and device |

### Repo layout

```
apps/tv/            TV UI (as today) + player adapter (html5 | avplay | exoplayer-bridge)
apps/tv-shell/      shared shell (TS/Vite): connect, discovery, pairing, offline screen, version check
apps/tv/tizen/      config.xml + the built shell
apps/tv/webos/      appinfo.json + the built shell
apps/android-tv/    Gradle project (Kotlin): WebView + ExoPlayer bridge + NSD
```

The shell is written once and copied into each package at build time. The Tizen author certificate never goes into git.

### Out of scope for now

Remote access, store submissions, a fully native UI per platform, DVR.

## Phase 0 — Shared foundation

**Goal:** a TV finds the server, pairs without typing an IP, and recovers when the server goes away.

### Server
- Device tokens: `devices` table (`id`, `name`, `platform`, `token_hash`, `capabilities_json`, `overrides_json`, `created_at`, `last_seen_at`, `revoked_at`). The auth middleware accepts a device token alongside the shared key.
- Pairing: `POST /api/pair` (creates a code, 5-minute expiry), `GET /api/pair/:code` (TV polls), `POST /api/pair/:code/approve` (signed-in user). A `/pair` page in the web UI with code entry, opened directly from the QR code.
- `GET /api/health` without auth: `{ name: "kinora", apiVersion, serverVersion }`, nothing sensitive.
- mDNS announcement `_kinora._tcp` with the port and `apiVersion`.
- **Settings → Devices:** list, rename, revoke.
- Docs: running the server as a Windows service and as a systemd unit.

### Shell (`apps/tv-shell`)
- Known servers list; on start, check the last server's `/api/health` with a timeout instead of redirecting blindly.
- Discovery: subnet scan on Tizen/webOS, manual IP entry, "Change server" always reachable (including from the offline screen).
- Pairing screen with code and QR.
- Version check: incompatible `apiVersion` gives a clear message (update the server or the app).
- Offline / reconnecting screen with retry.
- Built into `apps/tv/tizen` and `apps/tv/webos`; replaces today's `index.html` wrappers.

### TV UI (`apps/tv`)
- Remote keys: Back (10009 Tizen, 461 webOS, Escape/Backspace in a browser) goes back, and exits only from Home with a confirmation; media keys registered (`tizen.tvinputdevice.registerKey`) and mapped to play, pause, seek and stop.
- i18n: auto-detect ro/en; move any remaining hard-coded strings into the dictionary.

### How it was built

Status: implemented, verified with tests and in a desktop browser; not yet run on a Samsung or LG TV.

- **The UI runs in a frame inside the shell**, not through `location.replace`. The shell page stays on top, so it keeps the platform APIs (key registration, the TV's IP, exit), can put the offline screen over the UI, and "Change server" is always one step away. The UI loads as `<server>/tv/#shell=1&token=…` and talks to the shell with `postMessage` (`ready`, `exit`, `unauthorized`, `change-server`; see `ShellMessage` in `packages/shared`).
- **Tokens.** The hash carries the token, so it never appears in a request line. Elements that cannot send headers (`<video>`, `<img>`, `<track>`) get `?token=` instead (`mediaUrl` in `@kinora/client`), because cookies may not reach a server framed by a `file://` page. The server reads the query token only on GET/HEAD.
- **Pairing.** `POST /api/pair` also returns a `secret`; `GET /api/pair/:code?secret=…` needs it, and the token is handed out once. Someone who reads the code off the screen can approve it but cannot collect the token. `GET /api/pair/:code/info` (signed in) tells the approval page which device is asking. Codes live in memory: after a server restart the TV simply asks for a new one.
- **Heartbeat.** While the UI is shown, the shell calls `GET /api/devices/me` every 10 s: a network error twice in a row shows the offline screen (which probes every 5 s and reconnects by itself), a `401` returns to pairing. A revoked or unknown device token gets `401` even on a server without an access key.
- **What a device token may do.** Browse, play, report progress and match titles. Not: Settings writes, libraries, folders, caches, other devices, pairing approvals (`isDeviceForbidden` in `security.ts`).
- **Cross-origin.** Only `/api/health`, `POST /api/pair`, `GET /api/pair/:code` and `GET /api/devices/me` answer any origin (`Access-Control-Allow-Origin: *`, no cookies). Requests with a `Bearer` header skip the origin check, since a browser never adds that header on its own.
- **Shell build.** One classic IIFE script targeting ES2015/Chromium 53 (esbuild), because `file://` pages cannot load module scripts and webOS 4 / Tizen 4 predate ES2017. Network calls use `XMLHttpRequest` for hard timeouts without `AbortController`. Generated files in `apps/tv/tizen` and `apps/tv/webos` are not in git (`pnpm tv:shell`).
- **Manifests.** Tizen `config.xml` gains `<access origin="*">`, `allow-navigation` and the `network.public` / `productinfo` privileges; webOS `appinfo.json` sets `disableBackHistoryAPI` so Back reaches the app.
- **Keys.** `apps/tv/src/remote.ts` maps key codes and names to actions (back, play, pause, play/pause, stop, rewind, fast-forward, channel up/down). The shell registers the Tizen media and channel keys; webOS sends them without registration. Back on a page without in-app history goes Home instead of leaving.
- **Language.** With no saved choice, every UI and the shell follow `navigator.language` (`detectLocale` in `packages/shared`); the shell's strings are in `@kinora/client/shell-copy`.
- **Browser floor.** The TV UI builds for Chromium 68 (`build.target` in `apps/tv/vite.config.ts`): webOS 5 and Tizen 5.5 or newer. Vite lowers syntax only, so the UI and `@kinora/client` must not call runtime APIs newer than that (`flatMap`, `Object.fromEntries`, `replaceAll`, `.at()`…) without a fallback; the dependencies' newer calls are feature-detected or on code paths the TV does not use. Older TVs (webOS 4, Tizen 4) would need a legacy, non-module build; the shell already runs there.

### Done when
- A fresh TV finds the server on the LAN without typing an IP, pairs by code or QR, and appears in Settings → Devices.
- Revoking a device sends it back to pairing.
- With the server stopped, the TV shows the offline screen and lets you change the server; it reconnects on its own when the server is back.
- Back and media keys work on Tizen and webOS.
- `pnpm test` and `pnpm typecheck` pass.

## Phase 1 — Capability profiles

**Goal:** a TV plays directly every file it can decode, and the desktop does not change.

- Profile type in `packages/shared`: containers, video codecs with profile/level/bit depth, HDR formats, audio codecs with channel counts, max resolution and bitrate, subtitle handling.
- Runtime detection in `apps/tv`, sent at pairing and refreshed at startup; static per-platform overrides; per-device switches in Settings → Devices (force transcode, resolution cap, bitrate cap).
- [plan.ts](../apps/server/src/playback/plan.ts) takes a profile. The `browser` profile reproduces today's rules exactly. Tests for both.
- Transcode fallback keeps 5.1 when the profile allows AC-3/E-AC-3.
- Player adapter interface in `apps/tv` (load, play, pause, seek, audio tracks, events); `html5` implementation first, wrapping the current player.

### How it was built

Status: implemented and covered by tests; not yet run on a Samsung or LG TV.

- **Profile** (`packages/shared/src/capabilities.ts`): containers (each optionally limited to some codecs), video codecs with max bit depth / ffprobe profiles / max level, audio codecs with max channels, HDR formats, max width/height/bitrate, and what may be copied into HLS segments. Codec names are ffprobe's, folded into families (`videoFamily`, `audioFamily`). `BROWSER_PROFILE` encodes the old rules; `sanitizeCapabilities` checks whatever a client sends.
- **Media info.** ffprobe now also yields profile, level, bit depth (from `pix_fmt`), HDR (transfer curve + Dolby Vision side data) and bitrate, stored in `media_files.video_info_json` (migration 0011). Files scanned before are probed once on the next scan, and every library is scanned at server start, so the data fills in after the first restart. A missing value is not held against a file.
- **Plan.** `playbackPlan(input, profile)` returns the mode plus `limits` (why not direct: `container`, `video_codec`, `bit_depth`, `hdr`, `resolution`, `bitrate`, `audio_codec`, `audio_channels`, `forced`…). `hlsOutput` decides what the HLS stream copies and how it encodes. A test compares the browser profile with a verbatim copy of the old function over ~4,700 container × codec × ffmpeg combinations; the only skipped case (`mp4a` in WebM) cannot come out of ffprobe.
- **Which profile.** `profileFor(request.device)`: the browser's for the web UI and the shared key; for a device, its report with `applyPlatformQuirks` (DTS/TrueHD dropped on TVs, MKV added on webOS) and its Settings switches (`applyDeviceOverrides`). A device that has not reported yet plays by the browser rules. Used by `/api/playback`, `/api/stream/*`, `/api/movies/:id` and Live TV `play`.
- **Transcode.** Not copied, surround sound becomes AC-3 5.1 (640k) when the profile takes AC-3 in HLS, otherwise stereo AAC as before. Resolution caps add a second scale, bitrate caps add `-maxrate`. Outputs that differ from the browser's get a variant (`vc-aac36-h720…`) in the session key and the cache directory; the browser's keys did not change, so existing caches stay valid.
- **Detection** (`@kinora/client/capabilities`, ES2015-safe): `MediaSource.isTypeSupported` / `canPlayType`, the extended `width=3840; height=2160` form and `webapis.productinfo` for 4K, `matchMedia("(dynamic-range: high)")` and `webapis.avinfo` for HDR. HLS copies only H.264 (plus AC-3 where MSE takes it), because hls.js plays MPEG-TS. The shell sends the profile with `POST /api/pair`; the TV UI sends it again on every start (`PUT /api/devices/me/capabilities`, the only device-management route a device token may call).
- **Settings → Devices** shows what the device plays directly, its last playback since the server started (mode and limits; kept in memory), and the switches: always convert, max resolution, max bitrate (`PUT /api/devices/:id/overrides`). They apply to the next `/api/playback` request.
- **Player adapter** (`apps/tv/src/player`): `PlayerBackend` (`capabilities()`, `create(video)`) and `PlayerAdapter` (load file/HLS, play, pause, seek, time, audio tracks, events). Only `html5` exists; the Player page uses it. Subtitles still go through the `<video>`'s text tracks. A native backend (AVPlay) will need the overlay renderer.
- **Not done yet:** HEVC copied into HLS (needs fMP4 segments or a native player), HDR tone mapping, and falling back automatically when direct play fails on a TV that over-reports. Until then, use "Always convert".

### Done when
- An MKV with HEVC + E-AC-3 plays directly on a TV that supports it.
- The desktop web UI makes the same decisions as before (covered by tests).
- Forcing transcode for a device in Settings takes effect on the next play.

## Phase 2 — Tizen

- AVPlay adapter (`webapis.avplay`): MKV, HEVC, HDR, audio track selection; subtitles rendered by Kinora.
- Tizen-specific profile overrides.
- `pnpm tv:package:tizen` (Tizen CLI, local author certificate).
- `docs/tv/tizen.md`: Developer Mode, certificates, install, debugging (remote inspector), known model quirks.

### How it was built

Status: implemented and covered by tests (the AVPlay controller against a fake player); not yet run on a Samsung TV.

- **AVPlay lives in the shell.** `webapis` exists only in the packaged page, not in the UI's frame (loaded from the server). The shell owns the player (`apps/tv-shell/src/avplay.ts`) and an `<object type="application/avplayer">` under the frame; the UI's `avplay` adapter (`apps/tv/src/player/bridge.ts`) sends `PlayerCommand`s by `postMessage` and keeps the shell's `PlayerReport`s (state, time, duration, audio tracks) so its getters stay synchronous. Every `load` has a session number; reports and commands for an older one are dropped. The shell opens media only from the connected server's origin. The same bridge is meant for the ExoPlayer adapter in phase 4.
- **Which player.** The shell adds `&player=avplay` to the launch hash when AVPlay is there; `playerBackend()` picks the bridge, otherwise `html5`. Live TV stays on hls.js.
- **Picture.** AVPlay draws under the page: the shell and the UI put `avplay-active` on `<html>` while a source is loaded and clear their backgrounds. Letterboxed, full screen (AVPlay's 1920×1080 space). Suspended when the app goes to the background, restored on return.
- **Profile** (`detectAvplayCapabilities`, `player: "avplay"`): the Samsung media spec for 2019+ models (MKV, AVI, TS; HEVC 10-bit, MPEG-2/4; AC-3, E-AC-3, PCM, Opus, Vorbis) narrowed by the TV (4K from productinfo, HDR from avinfo, VP9/AV1 from the decoder). HLS segments may carry HEVC and E-AC-3, since AVPlay plays HLS itself. Sent at pairing by the shell and on every start by the UI, which asks the shell for it.
- **Tokens in HLS.** AVPlay cannot send headers: playlist and segments carry `?token=`; `playlistForClient` appends the playlist request's token to each segment.
- **Tizen quirks** (server-side): H.264 capped at 8-bit, Dolby Vision dropped (besides DTS/TrueHD from phase 1).
- **Subtitles** are drawn by `SubtitleOverlay` from the WebVTT (`parseVtt` / `activeCueLines` in `@kinora/client`), with the size and colour from Settings and the per-file delay. The HTML5 player now applies the same size and colour to its text tracks.
- **Audio tracks**: an **Audio** list in the player's CC panel when the file has more than one (AVPlay's tracks, or the HTML5 `audioTracks`).
- **Packaging**: `pnpm tv:package:tizen [-- --install --run --target <serial>]` builds the shell, stages only the app's files, signs with the active (or `TIZEN_PROFILE`) security profile and installs with `sdb`.
- **Not done yet:** embedded text subtitles under AVPlay (the server would need to extract them, as for the HTML5 player), automatic fallback to transcode when AVPlay refuses a file it was expected to play (use **Always convert** meanwhile), and seeking ahead within a growing transcode.

### Done when
The test checklist below passes on a Samsung TV, media keys included.

## Phase 3 — webOS

- webOS adapter: the native `<video>` pipeline (wider codec support than a desktop browser), Luna `connectionmanager` for the TV's IP.
- webOS-specific profile overrides.
- `pnpm tv:package:webos` (`ares-package`).
- `docs/tv/webos.md`: Developer Mode (and its expiry), `ares-setup-device`, install, `ares-inspect`.

### How it was built

Status: implemented and covered by tests (the profile and the server rules); the IPK builds with `ares-package`; not yet run on an LG TV.

- **No bridge.** Unlike AVPlay, LG's native pipeline is behind the ordinary `<video>` element (with a plain `src`, not MSE), in the UI's frame too. The shell adds `&player=webos` to the launch hash and the UI picks the `webos` adapter (`apps/tv/src/player/webos.ts`): the HTML5 adapter with `nativeHls` (HLS given to the element instead of hls.js, token in the URL, put back on the start point if it opens at the live edge, duration from `seekable` while the stream grows) and `pauseWhenHidden`. Every converted film now depends on the TV's HLS player, so a failure before the first frame falls back to hls.js for the rest of the session (enough for H.264 streams; HEVC copied in needs **Always convert**). On a real LG, test a converted film and seeking first. Text tracks and `audioTracks` work as in the HTML5 player.
- **Profile from the shell.** The frame cannot reach Luna, so the UI asks the shell with the bridge's `capabilities` command; the shell answers with `detectWebosCapabilities(webosInfo())` (`player: "webos"`). `webosInfo` asks `com.webos.service.tv.systemproperty/getSystemInfo` for the model, SDK version and 4K panel. The profile is LG's 2020+ media spec (MKV, TS, AVI; HEVC 10-bit, MPEG-2/4; AC-3, E-AC-3, PCM), narrowed by the decoder for VP9, AV1, Opus/Vorbis and Dolby Vision. HLS segments may carry HEVC and E-AC-3. The model name also names the device at pairing ("LG TV OLED55C1").
- **webOS quirks** (server-side): H.264 capped at 8-bit like Tizen, Dolby Vision kept (besides DTS/TrueHD dropped and MKV added from phase 1).
- **Manifest.** `appinfo.json` declares the Luna ACG groups (`network.query`, `systemconfig.query`), enforced from webOS 26 when declared and required from webOS 27.
- **Packaging**: `pnpm tv:package:webos [-- --install --run --device <name>]` builds the shell, stages the app's files and runs `ares-package --no-minify`, `ares-install`, `ares-launch` (`@webos-tools/cli`, on PATH or in `ARES_CLI`). No certificate, so CI can build the IPK (phase 5).
- **Not done yet:** placeholder icons (LG wants 80×80 and 130×130 for the store), embedded text subtitles, automatic fallback to transcode when the pipeline refuses a file (use **Always convert** meanwhile), and seeking ahead within a growing transcode.

### Done when
The same checklist passes on an LG TV.

## Phase 4 — Android TV / Fire TV

- `apps/android-tv`: Kotlin app, WebView with the shell and `/tv/`, JS↔native bridge to ExoPlayer/Media3 (exposed to the UI as the `exoplayer-bridge` adapter), discovery via NSD, Leanback launcher banner, Back and media keys forwarded to the UI.
- Codec detection through `MediaCodecList` for the profile.
- `pnpm tv:package:android` (Gradle, debug or signed APK).
- `docs/tv/android-tv.md`: building, sideloading with `adb`, Fire TV notes.

### Done when
The same checklist passes on an Android TV device, and the APK starts on a Fire TV.

## Phase 5 — CI and releases

- GitHub Actions: build the APK and webOS IPK on tags, attach them to the release.
- One version number shared by the server, the shell and the apps; `apiVersion` bumped only on breaking API changes.

## Later phases

Each needs its own round of decisions before it starts.

- **Always-on server:** Docker image for NAS, Wake-on-LAN sent from the TV app.
- **Server performance:** hardware encoding chosen from Settings with detection (today only `KINORA_VIDEO_ENCODER`), more than one concurrent transcode, HDR tone mapping, PGS/VobSub burned in.
- **Remote access:** Tailscale first, then HTTPS behind a reverse proxy; adaptive bitrate.
- **Stores:** fully bundled UI, privacy policy, Samsung / LG / Google Play review requirements.

## Test checklist (per platform)

- [ ] Fresh install finds the server (or accepts a manual IP) and pairs by code or QR
- [ ] Home → Movies / Series with the D-pad; Back returns to the previous screen
- [ ] Open a title and play it; pause, seek and stop with both the D-pad and media keys
- [ ] An H.264 MP4 and an HEVC MKV with 5.1 audio both play; Settings → Devices shows which mode was used
- [ ] Text subtitles show and follow the subtitle settings
- [ ] Progress appears under "Continue watching" after returning
- [ ] Live TV: open a channel, zap up and down
- [ ] Stop the server: the offline screen appears; start it again: the app reconnects
- [ ] Revoke the device: the app returns to pairing
