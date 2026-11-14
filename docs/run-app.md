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

## Android TV

No native app yet (planned, see [smart-tv.md](smart-tv.md#phase-4--android-tv--fire-tv)). Open `http://<pc-ip>:3001/tv/` in the TV's browser instead (production server, network access enabled).

For network access and running as a service, see the [README](../README.md#network-access) and [server-service.md](server-service.md).
