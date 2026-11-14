# Kinora on Samsung TVs (Tizen)

How to build, sign, install and debug the Kinora app on a Samsung TV, and what to expect from its native player. The architecture is in [smart-tv.md](../smart-tv.md).

Target: Samsung TVs from 2021 on (Tizen 6.0+, set by `required_version` in [config.xml](../../apps/tv/tizen/config.xml)). The UI itself builds for Chromium 68 (Tizen 5.5), so lowering `required_version` to `5.5` is the first thing to try for a 2020 model.

## 1. One-time setup on the PC

1. Install [Tizen Studio](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html) (the CLI-only installer is enough).
2. In the **Package Manager**, install:
   - *Tizen SDK tools* (main tab),
   - *Extension SDK → TV Extensions-x.y* and *Samsung Certificate Extension*.
3. Put `tizen-studio/tools/ide/bin` and `tizen-studio/tools` on `PATH` (for `tizen` and `sdb`), or set `TIZEN_CLI` to the full path of `tizen` / `tizen.bat`.

## 2. Developer Mode on the TV

1. Open **Apps** on the TV.
2. On the remote, type `1 2 3 4 5` (on the remote's number pad, or the on-screen one with the colour/123 button).
3. Turn **Developer mode** on and enter the **IP address of the PC** that will install the app.
4. Restart the TV (hold the power button until the logo appears).

Developer Mode stays on, but the PC IP must be entered again if it changes.

## 3. Author certificate

Samsung TVs only install packages signed with a *Samsung* certificate that names the TV's DUID.

1. Connect to the TV once so Tizen Studio can read its DUID:
   ```bash
   sdb connect <tv-ip>
   sdb devices          # the TV should be listed as "device"
   ```
2. Open **Tools → Certificate Manager** in Tizen Studio, **+**, choose **Samsung**, **TV**, create a new author certificate (sign in with a Samsung account), then a distributor certificate with privilege level **Public**. The connected TV's DUID is added automatically; add others by hand.
3. The new security profile becomes the active one. To use another, set `TIZEN_PROFILE=<profile name>`.

The certificate lives in your Tizen Studio data folder (`~/SamsungCertificate`, `tizen-studio-data/profile/`). Never copy it into the repo. A new TV needs its DUID added to the distributor certificate.

## 4. Build, sign, install

```bash
pnpm tv:package:tizen                          # apps/tv/tizen/dist/Kinora.wgt
pnpm tv:package:tizen -- --install             # and install it on the connected TV
pnpm tv:package:tizen -- --install --run       # and start it
pnpm tv:package:tizen -- --install --target <serial>   # when several devices are connected (serial from `sdb devices`)
```

The script builds the shell (`pnpm tv:shell`), copies only the app's files (`config.xml`, `icon.png`, `index.html`, `shell.js`, `shell.css`) into `apps/tv/tizen/dist/app`, signs them with `tizen package -t wgt`, and installs with `tizen install`. Everything in `dist/` is ignored by git.

The UI itself is not in the package: it is loaded from the Kinora server, so after a server update the TV gets the new UI on its next start without reinstalling. Reinstall only when the shell or `config.xml` changes.

**From CI.** A `v*` tag also builds and signs the `.wgt` on GitHub Actions (`kinora-tv-<version>.wgt` in the release) when the repository has these secrets, each the base64 of a file from `SamsungCertificate/<profile>/`:

```bash
D=~/SamsungCertificate/kinora
base64 -w0 $D/author.p12      | gh secret set TIZEN_AUTHOR_P12
base64 -w0 $D/author.pwd      | gh secret set TIZEN_AUTHOR_PWD
base64 -w0 $D/distributor.p12 | gh secret set TIZEN_DISTRIBUTOR_P12
base64 -w0 $D/distributor.pwd | gh secret set TIZEN_DISTRIBUTOR_PWD
```

The `.pwd` files hold the passwords as Tizen Studio encrypts them. The package installs only on the TVs whose DUIDs are in the distributor certificate: after adding a TV, update `TIZEN_DISTRIBUTOR_P12` and `TIZEN_DISTRIBUTOR_PWD`.

## 5. Debugging

**Remote inspector** (DevTools for the app on the TV):

```bash
tizen run -p KinoraTVap.Kinora                # or start it from the TV
sdb shell 0 debug KinoraTVap.Kinora           # prints "... port: 7011"
sdb forward tcp:7011 tcp:7011
```

Open `chrome://inspect` in Chrome on the PC, add `localhost:7011` under **Configure…**, and inspect the app. The shell is the top page; the UI is the `<iframe id="frame">` inside it (pick its context in the Console's context menu). Player messages travel between them with `postMessage`; filter on `kinora-player` to see them.

**Logs from the shell:** `sdb dlog | grep -i -E "kinora|avplay|ConsoleMessage"`.

**Without a TV:** `pnpm --filter @kinora/tv-shell dev` serves the shell on <http://localhost:5175/> in a desktop browser. There is no `webapis` there, so it uses the HTML5 player; the AVPlay controller is covered by `apps/tv-shell/src/avplay.test.ts` with a fake player.

## 6. How playback works on Tizen

- The shell finds `webapis.avplay` and opens the UI with `#…&player=avplay`. The UI then uses the `avplay` player adapter (`apps/tv/src/player/bridge.ts`), which sends commands to the shell (`load`, `play`, `pause`, `seek`, `audio`, `unload`; see `PlayerCommand` in `packages/shared/src/playerBridge.ts`). The shell drives AVPlay (`apps/tv-shell/src/avplay.ts`) and reports state, time, duration and audio tracks back.
- AVPlay draws the picture on a video plane **under** the page. While a source is loaded, the shell and the UI set `avplay-active` on `<html>` and clear their backgrounds so the picture shows through the player's controls.
- **What plays directly** (the profile is `detectAvplayCapabilities` in `packages/client/src/capabilities.ts`): MP4/MOV, MKV, WebM, MPEG-TS and AVI; H.264 (8-bit), HEVC up to 10-bit, MPEG-2, MPEG-4 Part 2, and VP9/AV1 where the TV's decoder has them; AAC, MP3, AC-3, E-AC-3 (up to 7.1), PCM, Opus, Vorbis; HDR10 and HLG on HDR panels; 4K on UHD panels.
- **Remux and transcode** go through HLS as before, but AVPlay plays HLS natively, so HEVC and E-AC-3 are **copied** into the segments instead of being re-encoded. The token travels in the URL (`?token=`), and the server appends it to every segment in the playlist, since AVPlay cannot send headers.
- **Subtitles** are drawn by Kinora over the picture (`SubtitleOverlay`): the WebVTT is fetched from the server, follows the subtitle size and colour from Settings and the per-file delay. Subtitles embedded in the file are not shown by AVPlay (they are unavailable in the player menu, as with the HTML5 player).
- **Audio tracks** of the file appear under **Audio** in the player's CC panel when there is more than one.
- **Leaving the app** (Home, source change) suspends AVPlay and restores it on return.
- **Live TV** still plays through hls.js in the `<video>` element; it is HLS with H.264/AAC, which both players handle.

## 7. Server-side Tizen rules

`applyPlatformQuirks("tizen", …)` in `packages/shared/src/capabilities.ts` corrects what a Samsung TV reports, so a server update fixes them without reinstalling the app:

- DTS and TrueHD are dropped (no Samsung TV since 2018 decodes DTS; it plays silence).
- H.264 is capped at 8-bit (High 10 is reported but shows a black picture).
- Dolby Vision is dropped (Samsung has none). A DV profile 8 file still plays directly through its HDR10 base layer; a DV-only file (profile 5) is transcoded.

## 8. Known model quirks

From Samsung's documentation and reports on other players; **not yet confirmed on a Samsung TV with Kinora**. Note what you see in the checklist below.

| Symptom | Likely cause | What to do |
|---|---|---|
| The package does not install: "certificate" or "DUID" error | The TV's DUID is not in the distributor certificate | Add it in Certificate Manager and package again |
| The app installs but the PC cannot connect (`sdb connect` fails) | Developer Mode has another PC's IP, or the TV was not restarted | Set the IP again in Apps → `12345` and restart the TV |
| Black screen with sound | The page is not transparent over the video plane | Check that `<html>` has `avplay-active` in the inspector; a page style with a background on top of `.player` covers it |
| HEVC MKV plays without sound | E-AC-3/TrueHD/DTS track the TV does not decode | Pick another track under **Audio**, or turn on **Always convert** for the TV in Settings → Devices |
| A converted stream cannot seek ahead | The transcode playlist grows while it plays; AVPlay treats it as live | Seek within what is already converted, or wait; direct play has no such limit |
| 10-bit H.264 (anime "Hi10P") shows black | Hardware decoders on TVs are 8-bit for H.264 | Already transcoded by the server rule above |
| HDR content looks washed out | The panel is SDR but the TV reported HDR | Set a **max resolution** or **Always convert** for the device |
| The remote's media keys do nothing | Keys not registered (older firmware) | Check the inspector console for `registerKeyBatch` errors |

## Test checklist (Samsung)

The same checklist as in [smart-tv.md](../smart-tv.md#test-checklist-per-platform), plus:

- [ ] `pnpm tv:package:tizen -- --install --run` installs and starts the app
- [ ] An HEVC 10-bit HDR10 MKV with E-AC-3 5.1 plays **directly** (Settings → Devices shows `direct`), in HDR, with surround sound
- [ ] Choosing another audio track under **Audio** switches the sound
- [ ] Subtitles drawn over AVPlay follow the size and colour from Settings and the delay buttons
- [ ] A file that needs converting plays, and HEVC is copied (no re-encode in the server log)
- [ ] Home button during playback, then back into the app: playback resumes
- [ ] Play/Pause, FF/RW and Stop on the remote work during AVPlay playback
