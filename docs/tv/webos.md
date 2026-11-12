# Kinora on LG TVs (webOS)

How to package, install and debug the Kinora app on an LG TV, and what its player plays. The architecture is in [smart-tv.md](../smart-tv.md).

Target: LG TVs from 2020 on (webOS 5+). The UI builds for Chromium 68, the browser of webOS 5; the shell itself runs on webOS 4 too.

## 1. One-time setup on the PC

Install the webOS CLI (`ares-*` commands), which needs Node.js:

```bash
npm install -g @webos-tools/cli
ares --version
```

If you keep it somewhere else, set `ARES_CLI` to the folder holding `ares-package` (on Windows, the `.cmd` files).

## 2. Developer Mode on the TV

1. Sign in to (or create) an account on [webostv.developer.lge.com](https://webostv.developer.lge.com/).
2. On the TV, install **Developer Mode** from the LG Content Store and open it.
3. Sign in with the same account, turn **Dev Mode Status** on (the TV restarts), then turn **Key Server** on.
4. Note the IP address and passphrase that the Developer Mode app shows.

**Developer Mode expires.** The session lasts 1000 hours (about 6 weeks); the Developer Mode app shows the time left. Press **Extend** there before it runs out. When it expires, the TV removes every sideloaded app (Kinora included) and you have to install it again. The paired device token is lost with the app, so the TV pairs again too.

## 3. Register the TV with the CLI

```bash
ares-setup-device
```

Choose **add**, give it a name (e.g. `lgtv`), the TV's IP, port `9922`, user `prisoner`, no password. Then fetch the TV's key with the passphrase from the Developer Mode app:

```bash
ares-novacom --device lgtv --getkey      # asks for the passphrase
ares-device --device lgtv --system-info  # checks the connection
```

To use it without `--device` every time, make it the default: `ares-setup-device --default lgtv`. The key stays valid until Developer Mode is turned off or the TV is reset.

## 4. Build, package, install

```bash
pnpm tv:package:webos                               # apps/tv/webos/dist/com.kinora.tv_<version>_all.ipk
pnpm tv:package:webos -- --install                  # and install it on the default device
pnpm tv:package:webos -- --install --run            # and start it
pnpm tv:package:webos -- --install --device lgtv    # on a named device (or set WEBOS_DEVICE)
```

The script builds the shell (`pnpm tv:shell`), copies only the app's files (`appinfo.json`, `icon.png`, `index.html`, `shell.js`, `shell.css`) into `apps/tv/webos/dist/app`, packs them with `ares-package --no-minify` (the shell is already minified), and installs with `ares-install` / starts with `ares-launch`. Everything in `dist/` is ignored by git. No signing certificate is needed for Developer Mode.

The UI is not in the package: it is loaded from the Kinora server, so a server update reaches the TV on the next start. Reinstall only when the shell or `appinfo.json` changes.

To remove the app: `ares-install --device lgtv --remove com.kinora.tv`.

## 5. Debugging

**Web Inspector** (DevTools for the app on the TV):

```bash
ares-inspect --device lgtv --app com.kinora.tv --open
```

This opens the inspector in your browser (or prints its URL; open it in Chrome). The shell is the top page, and the UI is the `<iframe id="frame">` inside it: pick its context in the Console's context drop-down. The UI asks the shell for its profile with a `kinora-player` message; filter on that to see it.

**Logs:** `ares-log --device lgtv -f` (webOS 6 and later; the inspector console is the more useful one).

**Without a TV:** `pnpm --filter @kinora/tv-shell dev` serves the shell on <http://localhost:5175/> in a desktop browser. It has no Luna there, so it behaves as a plain browser: no subnet scan, and the HTML5 player with hls.js.

## 6. How playback works on webOS

- On webOS, a `<video>` element with a plain `src` (not MSE) plays through LG's native media pipeline, inside the frame as well. The shell therefore bridges no player; it opens the UI with `#…&player=webos`, and the UI uses the `webos` adapter (`apps/tv/src/player/webos.ts`). That is the HTML5 adapter with two changes:
  - **HLS goes to the `<video>` itself, not to hls.js**, so the pipeline plays MPEG-TS segments with HEVC and AC-3/E-AC-3, which MSE in the TV's browser does not. The token travels in the URL (`?token=`), and the server appends it to every segment in the playlist. The player is put back on the start point if it opens at the live edge of a growing transcode.
  - **Fallback:** if the native player fails before showing a frame, the adapter retries the same stream with hls.js and keeps hls.js for converted streams until the app restarts (the console logs `native HLS failed before playing`). That rescues H.264 streams; one with HEVC copied in still fails under hls.js, so **Always convert** (which re-encodes to H.264) is the way out there.
  - It pauses when the app goes to the background (Home, input change).
- **The profile** comes from the shell (`detectWebosCapabilities` in `packages/client/src/capabilities.ts`). It asks Luna (`com.webos.service.tv.systemproperty/getSystemInfo`) for the model name (shown in Settings → Devices as "LG TV OLED55C1"), the SDK version and whether the panel is 4K. On top of that sits LG's media spec for 2020+: MP4/MOV, MKV, MPEG-TS and AVI; H.264 (8-bit), HEVC up to 10-bit, MPEG-2, MPEG-4 Part 2, plus VP9/AV1 (and WebM) where the decoder says so; AAC, MP3, AC-3, E-AC-3 (up to 7.1), PCM, plus Opus/Vorbis where the decoder says so; HDR10 and HLG on 4K panels, Dolby Vision where the decoder reports it. HLS segments may carry H.264/HEVC with AAC/MP3/AC-3/E-AC-3. The UI asks the shell again on every start; an older shell that does not answer leaves the plain HTML5 detection.
- **Subtitles** are the `<video>`'s own text tracks, styled with the size and colour from Settings (the picture is in the page, so no overlay is needed).
- **Audio tracks** come from the element's `audioTracks` list, which webOS exposes. They appear under **Audio** in the CC panel when there is more than one.
- **Live TV** plays through hls.js as before (H.264/AAC).
- **Discovery:** the shell reads the TV's IP from Luna (`com.palm.connectionmanager/getStatus`, then `com.webos.service.connectionmanager/getStatus`) and scans that /24 for `/api/health`.
- **Permissions:** `appinfo.json` declares the ACG groups for those Luna calls (`network.query`, `systemconfig.query`). webOS TV 26 enforces them once declared, and from webOS 27 the field is required.
- **Back** reaches the app (`disableBackHistoryAPI`, key code 461). Media keys need no registration on webOS.

## 7. Server-side webOS rules

`applyPlatformQuirks("webos", …)` in `packages/shared/src/capabilities.ts`:

- DTS and TrueHD are dropped (LG removed DTS from its 2020–2022 models; some 2023+ models have it again, but a file that plays silence is worse than a conversion).
- H.264 is capped at 8-bit (the hardware decoder does not do High 10).
- MKV is added when the reported profile lacks it (an older shell sends the HTML5 profile, where `canPlayType` denies Matroska).
- Dolby Vision is kept: LG TVs with a DV decoder play it.

## 8. Known quirks

From LG's documentation and reports on other players; **not yet confirmed on an LG TV with Kinora**. Note what you see in the checklist below.

| Symptom | Likely cause | What to do |
|---|---|---|
| `ares-install` fails with "connection refused" or a key error | Developer Mode expired or the TV's IP changed | Extend Dev Mode, check the IP in `ares-setup-device`, run `ares-novacom --getkey` again |
| The app disappeared from the TV | Developer Mode expired | Turn it on again and reinstall; the TV pairs again |
| The server scan finds nothing | Luna's connection manager did not answer | Enter the server's IP by hand; check the inspector console |
| Every converted film fails, or plays only after a short stall | The native HLS player does not work as expected (in the frame, or with a growing playlist); the hls.js fallback kicked in | Report it with the inspector console. For HEVC sources turn on **Always convert** for the device |
| A converted stream cannot seek ahead | The transcode playlist grows while it plays; the native player treats it as live | Seek within what is already converted, or wait; direct play has no such limit |
| HEVC MKV plays without sound | A DTS/TrueHD track, or E-AC-3 the model does not decode | Pick another track under **Audio**, or turn on **Always convert** in Settings → Devices |
| A WebM or AV1 file shows black | The decoder over-reported | Turn on **Always convert** for the device |
| Subtitles of an MKV do not show | Embedded tracks are not exposed to the page | Use an external or downloaded subtitle |

## Test checklist (LG)

The same checklist as in [smart-tv.md](../smart-tv.md#test-checklist-per-platform), plus:

- [ ] `pnpm tv:package:webos -- --install --run` installs and starts the app
- [ ] Settings → Devices names the TV by model ("LG TV …")
- [ ] An HEVC 10-bit HDR10 MKV with E-AC-3 5.1 plays **directly**, in HDR, with surround sound
- [ ] **First:** a file that needs converting plays through the native player (no `falling back to hls.js` in the console), then seek forward and back
- [ ] An HEVC file that needs converting plays, and HEVC is copied (no re-encode in the server log)
- [ ] Choosing another audio track under **Audio** switches the sound
- [ ] Home button during playback pauses it; back into the app, Play resumes
- [ ] Play/Pause, FF/RW and Stop on the remote (or the Magic Remote's on-screen controls) work
