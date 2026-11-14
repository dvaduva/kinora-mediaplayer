# Kinora on Android TV, Google TV and Fire TV

How to build, sideload and debug the Kinora app on Android TV devices (Google TV, NVIDIA Shield, TV boxes, Sony/Philips/TCL TVs) and on Fire TV, and what its player plays. The architecture is in [smart-tv.md](../smart-tv.md).

Target: Android 6.0 (API 23) and newer, with an up-to-date Android System WebView (Chromium 68+; any device that still gets Play Store or Amazon updates has one). Fire TV: devices on **Fire OS** (Fire TV Stick 2nd gen and later, Cube, Fire TV Edition TVs). Fire TV devices on **Vega OS** (from late 2025, e.g. Fire TV Stick 4K Select) do not run Android apps and cannot sideload an APK.

## 1. One-time setup on the PC

- **Android SDK** with *Platform 36* and *Platform-Tools* (`adb`). The easiest way is [Android Studio](https://developer.android.com/studio); its SDK lands in `%LOCALAPPDATA%\Android\Sdk` on Windows, which the build script finds on its own. Elsewhere, set `ANDROID_HOME`.
- **JDK 17 or newer.** Android Studio ships one (`<Android Studio>\jbr`), which the script also finds; otherwise set `JAVA_HOME`.
- Gradle needs no install: the project has the wrapper (`apps/android-tv/gradlew`), and the first build downloads Gradle, the Android Gradle plugin and Media3.

## 2. Developer options on the device

**Android TV / Google TV**

1. Settings → System → About (Google TV: Settings → System → About; older: Settings → Device Preferences → About).
2. Press **Build** (Android TV OS build) seven times: "You are now a developer".
3. Back in Settings → System → **Developer options**: turn on **USB debugging** (needed for network debugging as well). On Android 11+ you can also use **Wireless debugging**.
4. Note the device's IP address (Settings → Network & Internet → your network).

**Fire TV**

1. Settings → My Fire TV → About: press the device name (e.g. "Fire TV Stick 4K") seven times.
2. Settings → My Fire TV → **Developer options**: turn on **ADB debugging** and **Apps from Unknown Sources** (newer Fire OS: *Install unknown apps*, for adb no extra app needs it).
3. The IP address is under Settings → My Fire TV → About → Network.

## 3. Connect with adb

```bash
adb connect 192.168.1.50:5555     # the device's IP; the TV asks once to allow this computer: choose "Always allow"
adb devices                       # lists 192.168.1.50:5555  device
```

With Android 11+ *Wireless debugging*, pair first: `adb pair <ip>:<pairing-port>` with the code the TV shows, then `adb connect <ip>:<port>` with the port from the Wireless debugging screen. `adb` is in `<sdk>/platform-tools`.

## 4. Build, install, run

```bash
pnpm tv:package:android                                   # apps/android-tv/dist/kinora-tv-<version>-debug.apk
pnpm tv:package:android -- --install --run                # install on the connected device and start it
pnpm tv:package:android -- --install --target 192.168.1.50:5555   # one device among several (or set ANDROID_SERIAL)
pnpm tv:package:android -- --release                      # signed release APK (see below)
```

On Windows, `apps\android-tv\build-apk.bat` does the same through a menu: debug or release, which device (from `adb devices`, or connect one by IP), and whether to start the app. With arguments it skips the questions (`build-apk.bat --release --install --run`).

The script builds the shell (`pnpm tv:shell`, which also copies it into `apps/android-tv/app/src/main/assets/shell/`), runs Gradle (`assembleDebug` or `assembleRelease`), copies the APK into `apps/android-tv/dist/`, then `adb install -r` and `adb shell am start`. It writes `apps/android-tv/local.properties` (the SDK path) the first time. Build outputs, `dist/`, the copied shell and `local.properties` are ignored by git.

The UI is not in the APK: it is loaded from the Kinora server, so a server update reaches the TV on the next start. Reinstall only when the shell or the native app changes.

To open the project in Android Studio: **Open** `apps/android-tv`, and run `pnpm tv:shell` once so the assets exist (the build stops with a message when they are missing).

**Signed release.** The debug APK is signed with the SDK's debug key, which is enough to sideload. A release APK is signed with your own keystore, kept outside the repository. Create it once:

```bash
keytool -genkeypair -v -keystore C:/Users/<you>/keystores/kinora-tv-release.jks -storetype PKCS12 -alias kinora -keyalg RSA -keysize 4096 -validity 10000
```

and put its settings in Gradle's user-wide `~/.gradle/gradle.properties` (`%USERPROFILE%\.gradle\gradle.properties` on Windows), which every build on the machine reads:

```properties
KINORA_RELEASE_STORE_FILE=C:/Users/<you>/keystores/kinora-tv-release.jks
KINORA_RELEASE_STORE_PASSWORD=…
KINORA_RELEASE_KEY_ALIAS=kinora
KINORA_RELEASE_KEY_PASSWORD=…
```

Environment variables with the same names work too (CI), and `build-apk.bat` asks for them when neither is set. **Back up the keystore and its passwords**: an APK signed with another key cannot update an installed one; you would have to uninstall first (`adb uninstall com.kinora.tv`), which also forgets the pairing.

The version is in `apps/android-tv/gradle.properties` (`kinora.versionName`, `kinora.versionCode`).

## 5. Debugging

**DevTools.** Debug builds allow WebView debugging. With the device connected over adb, open `chrome://inspect/#devices` in Chrome on the PC: the Kinora page appears under the device. The shell is the top page; the UI is the `<iframe id="frame">` inside it (pick its context in the Console's context drop-down). Bridge messages carry `source: "kinora-player"`.

**Logs.** `adb logcat -s Kinora` shows the WebView console (debug builds) and the app's own warnings (NSD, renderer crashes). The player's log (`exoplayer #<session> …`: open, ready, first frame, video size, errors with ExoPlayer's error code) goes to the server log like AVPlay's, since a TV has no console at hand.

**Without a device.** The app runs on an emulator too (a phone image works; an *Android TV* image is closer). The emulator sits behind NAT: NSD and the subnet scan cannot see the PC, so type `10.0.2.2:3001` as the server address (10.0.2.2 is the PC).

## 6. How it works

- **One WebView, the same shell.** `MainActivity` loads the shell from the APK's assets at `http://appassets.androidplatform.net/assets/shell/index.html` (`WebViewAssetLoader`; a real http origin, so the known servers and the device token in `localStorage` persist). From there it is the shell of the Tizen and webOS packages: discovery, pairing, offline screen, version check, and the UI from the server in a frame.
- **The bridge.** The activity adds `window.KinoraAndroid` (`ShellBridge.kt`). The interface is visible in every frame, the UI's too, so each call carries a nonce the activity put in the shell's hash, which the frame (another origin) cannot read. Native answers come back through `window.kinoraNative.receive(...)`, called with `evaluateJavascript` in the main frame only. The JS side is `apps/tv-shell/src/android.ts`.
- **Playback: ExoPlayer (Media3).** The shell opens the UI with `#…&player=exoplayer`; the UI's `exoplayer-bridge` adapter (`apps/tv/src/player/bridge.ts`, the same as for AVPlay) sends `PlayerCommand`s, which the shell passes on, and gets `PlayerReport`s back. `NativePlayer.kt` plays files (progressive) and HLS (remux/transcode). A converted film's playlist grows while it plays (an `EVENT` playlist, "live" to ExoPlayer), so it is opened at the requested start instead of the live edge, and its duration is reported as growing until the playlist ends. Errors carry ExoPlayer's code (`ERROR_CODE_DECODING_FORMAT_UNSUPPORTED`…).
- **Picture.** ExoPlayer draws on a `SurfaceView` under the WebView, shown only while a source is loaded; the shell and the UI put `avplay-active` on `<html>` and clear their backgrounds meanwhile, as on Tizen. Text tracks of the file are not rendered by ExoPlayer: Kinora's subtitle overlay draws them, with the size and colour from Settings.
- **Audio tracks** come from ExoPlayer ("eng · E-AC-3 5.1"), under **Audio** in the CC panel when there is more than one. Surround goes out as a bitstream (passthrough) when the TV or receiver takes it, otherwise through the device's decoder.
- **The profile** (`Capabilities.kt`, `player: "exoplayer"`): containers are ExoPlayer's (MP4/MOV, MKV, WebM, MPEG-TS, AVI); video codecs are the device's **hardware** decoders from `MediaCodecList` (H.264, HEVC and its 10-bit profile, VP9 profile 2, AV1, MPEG-2, MPEG-4 Part 2); audio is AAC, MP3 and PCM always, AC-3/E-AC-3/DTS when the device decodes them **or** the HDMI sink takes them as passthrough (ExoPlayer has no software decoder for those), and FLAC/Opus/Vorbis from the platform. 4K needs a 4K decoder and a 4K display mode; HDR10/HLG/Dolby Vision come from the display's HDR capabilities (Dolby Vision also needs a DV decoder). HLS segments may carry HEVC and AC-3/E-AC-3, since ExoPlayer plays HLS itself. Sent at pairing and on every start.
- **Discovery.** `ServerDiscovery.kt` browses `_kinora._tcp` with NSD while the app is open; the shell checks what it found first (up to 3 s) and falls back to scanning the device's /24 (its IPv4 address comes from `ConnectivityManager`). The device's name in Settings → Devices is the one the user gave it (Settings → Device name), else maker and model.
- **Keys.** D-pad and OK reach the WebView as arrow keys and Enter. **Back** is turned into Escape for the page: the UI goes back, and from Home asks before leaving (the shell then closes the activity). **Media and channel keys** (Play/Pause, Stop, FF/RW, next/previous, channel up/down) are taken by the activity, because not every WebView turns them into DOM keys; the shell hands them to the UI (`{ type: "key" }`, `SHELL_KEYS` in `@kinora/shared`), which replays them as a `keydown`.
- **Lifecycle.** Home, another app or input pauses the film; the UI shows it paused on return. A crashed WebView renderer restarts the activity instead of closing the app. HDMI mode changes do not reload the page.
- **Launcher.** `LEANBACK_LAUNCHER` with a 320×180 banner (Android TV home), `LAUNCHER` with the icon (Fire TV, phones). Neither a touchscreen nor leanback is required, so the APK installs on any of them.

## 7. Server-side Android rules

`applyPlatformQuirks("android", …)` in `packages/shared/src/capabilities.ts` drops TrueHD (no ExoPlayer decoder, and few sinks take it without a dedicated setup). DTS is kept: it is in the profile only when the device or the receiver says it plays it. No bit-depth cap: the profile already lists what the hardware decoder reports.

## 8. Known quirks

From the Android and Fire TV documentation and reports on other players; **not yet confirmed on a device with Kinora**. Note what you see in the checklist below.

| Symptom | Likely cause | What to do |
|---|---|---|
| `adb connect` is refused | ADB / USB debugging is off, or the prompt on the TV was dismissed | Turn it on again and accept "Always allow" on the TV |
| The app is not on the Fire TV home row | Sideloaded apps sit under **Your Apps & Channels** | Open it from there, or move it to the front with the Menu key |
| The server list stays empty | Multicast blocked (guest Wi-Fi, some mesh routers) and the server on another subnet | Enter the server's IP by hand |
| A film with AC-3/E-AC-3 plays without sound, or the server converts the audio | The device has no Dolby decoder and the TV/receiver did not report passthrough (HDMI-CEC off, receiver asleep at start) | Turn the receiver on before Kinora; check the device's *Surround sound* setting (Fire TV: Display & Sounds → Audio → Surround Sound: Best available) |
| HDR files are converted on an HDR TV | The device's output is set to SDR, so the display reports no HDR | Enable *Match content dynamic range* (Android TV) or *Dynamic range: Adaptive* (Fire TV) |
| Black picture with sound on a 4K HEVC file | The decoder over-reports, or the box overheats/throttles | Turn on **Always convert** or a resolution cap for the device |
| The UI is slow on an older stick | Weak CPU and WebView | Report the model; a fully native UI stays an option (smart-tv.md) |
| A converted stream cannot seek ahead | The transcode playlist grows while it plays | Seek within what is already converted, or wait; direct play has no such limit |

## Test checklist (Android TV / Fire TV)

The same checklist as in [smart-tv.md](../smart-tv.md#test-checklist-per-platform), plus:

- [ ] `pnpm tv:package:android -- --install --run` installs and starts the app; the banner shows on the Android TV home screen
- [ ] A fresh install finds the server through NSD (no subnet scan in the status line) and pairs
- [ ] Settings → Devices shows the device's name, platform Android, and a profile from `exoplayer`
- [ ] An HEVC 10-bit HDR10 MKV with E-AC-3 5.1 plays **directly**, in HDR, with surround sound (passthrough to a receiver, or the TV's decoder)
- [ ] A file that needs converting plays from the right start point, then seek forward and back
- [ ] Choosing another audio track under **Audio** switches the sound
- [ ] Back from a film returns to its page; Back on Home asks before leaving, and leaving closes the app
- [ ] Play/Pause, FF/RW and Stop on the remote work during playback
- [ ] Home during playback pauses it; back into the app, Play resumes
- [ ] On a Fire TV (Fire OS): the APK installs, starts from Your Apps, pairs and plays a film
