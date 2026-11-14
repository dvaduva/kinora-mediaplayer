# Running the server

Requires Node.js 22+, ffmpeg/ffprobe in `PATH`.

## First time

```bash
corepack enable
pnpm install
```

## Development

```bash
pnpm dev
```

- Web UI: <http://localhost:5173>
- TV UI: <http://localhost:5174/tv/>
- API: <http://127.0.0.1:3001>

## Production

```bash
pnpm build
pnpm start
```

Server, UI and API on <http://127.0.0.1:3001> (TV UI at `/tv/`). Set `PORT` to change the port.

## Tizen TV app

Connect to the TV (Developer Mode on), then build, sign, install and launch:

```powershell
C:\tizen-studio\tools\sdb.exe connect <tv-ip>
corepack pnpm tv:package:tizen -- --install --run
```

Output: `apps/tv/tizen/dist/Kinora.wgt`. Details in [tv/tizen.md](tv/tizen.md).

## webOS TV app

One-time setup (Developer Mode on the TV):

```powershell
npm install -g @webos-tools/cli
ares-setup-device                     # add: name lgtv, <tv-ip>, port 9922, user prisoner
ares-novacom --device lgtv --getkey   # passphrase from the Developer Mode app
ares-setup-device --default lgtv
```

Build, package, install and launch:

```powershell
corepack pnpm tv:package:webos -- --install --run
```

Output: `apps/tv/webos/dist/com.kinora.tv_<version>_all.ipk`. Details in [tv/webos.md](tv/webos.md).

## Android TV / Fire TV app

One-time: Android SDK (Android Studio) and JDK 17+; on the device, developer options with ADB / USB debugging on. Then:

```powershell
adb connect <device-ip>:5555
corepack pnpm tv:package:android -- --install --run
```

Output: `apps/android-tv/dist/kinora-tv-<version>-debug.apk`. Details in [tv/android-tv.md](tv/android-tv.md).

For network access and running as a service, see the [README](../README.md#network-access) and [server-service.md](server-service.md).
