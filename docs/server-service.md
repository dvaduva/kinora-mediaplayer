# Running the Kinora server as a service

TV apps are clients of the Kinora server ([smart-tv.md](smart-tv.md)), so the server has to be running whenever someone turns on the TV. This page sets it up to start with the computer and restart if it crashes.

## Before you start

1. Make the server reachable from the network (see "Network access" in the [README](../README.md#network-access)): set an access key in **Settings → Network**, bind to `0.0.0.0`, and restart once by hand to check that it works.
2. Build the UIs, so the server serves them itself:

   ```bash
   pnpm install
   pnpm build
   ```

3. Note the absolute path of the repository. The examples below use `C:\Kinora` on Windows and `/opt/kinora` on Linux.

The service runs the same command as `pnpm start`, but without pnpm: `node --import tsx src/index.ts` in `apps/server`. The database and caches stay in `data/` in the repository, so the account that runs the service needs write access there.

**Firewall.** Allow TCP on the server port (3001 by default) from the local network. TV discovery also uses mDNS (UDP 5353) for the Android TV app; Tizen and webOS find the server by scanning the subnet on the server port, so the TCP rule is enough for them.

## Windows (NSSM)

[NSSM](https://nssm.cc/) wraps any program as a Windows service, with restarts and log files. Install it (`winget install NSSM.NSSM`), then in an **administrator** PowerShell:

```powershell
$repo = "C:\Kinora"
$node = (Get-Command node).Source

nssm install Kinora $node "--import tsx src/index.ts"
nssm set Kinora AppDirectory "$repo\apps\server"
nssm set Kinora AppEnvironmentExtra PORT=3001
nssm set Kinora AppStdout "$repo\data\service.log"
nssm set Kinora AppStderr "$repo\data\service.log"
nssm set Kinora AppRotateFiles 1
nssm set Kinora AppRotateBytes 10485760
nssm set Kinora Start SERVICE_AUTO_START

# Run as your own user, not LocalSystem: see below.
nssm set Kinora ObjectName "$env:COMPUTERNAME\$env:USERNAME" "<your Windows password>"

New-NetFirewallRule -DisplayName "Kinora" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private

nssm start Kinora
```

**Why your own account.** Services run as LocalSystem by default. That account cannot open network shares mapped or authenticated by your user (NAS libraries), and it does not see an ffmpeg installed with winget, which lives in your user profile. Running the service as your user avoids both. If you prefer a dedicated account, give it read access to the library folders, write access to `data\`, and put ffmpeg in the system `PATH`.

Useful commands: `nssm restart Kinora` after an update, `nssm edit Kinora` for the settings dialog, `nssm remove Kinora confirm` to uninstall. Stopping the service sends Ctrl+C, which Kinora handles like a normal shutdown (Live TV relays are stopped, the mDNS announcement is withdrawn).

**Without NSSM.** A Task Scheduler task works too: trigger "At startup", action `node.exe` with arguments `--import tsx src/index.ts` and "Start in" `C:\Kinora\apps\server`, "Run whether user is logged on or not", and in Settings, "If the task fails, restart every 1 minute". It does not restart on crashes as reliably as a service.

## Linux (systemd)

Create a user for the service (or use your own), and give it the repository:

```bash
sudo useradd --system --home /opt/kinora --shell /usr/sbin/nologin kinora
sudo chown -R kinora: /opt/kinora
```

`/etc/systemd/system/kinora.service`:

```ini
[Unit]
Description=Kinora media server
After=network-online.target remote-fs.target
Wants=network-online.target

[Service]
Type=simple
User=kinora
Group=kinora
WorkingDirectory=/opt/kinora/apps/server
Environment=PORT=3001
ExecStart=/usr/bin/node --import tsx src/index.ts
Restart=on-failure
RestartSec=5
# Kinora writes only its own data folder.
ProtectSystem=full
ReadWritePaths=/opt/kinora/data
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

Use the path that `which node` prints for `ExecStart` (nvm installs live under the user's home, which the `kinora` user cannot read; install Node from your distribution or NodeSource instead). `remote-fs.target` waits for NFS/SMB mounts in `/etc/fstab`, so libraries on a NAS are there when the first scan starts.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kinora
journalctl -u kinora -f        # logs
sudo ufw allow from 192.168.0.0/16 to any port 3001 proto tcp   # if ufw is on
```

After `git pull && pnpm install && pnpm build`, run `sudo systemctl restart kinora`.

## Checking it works

From another device on the network:

```bash
curl http://<server-ip>:3001/api/health
# {"name":"kinora","apiVersion":1,"serverVersion":"0.0.1"}
```

This route needs no key and returns nothing sensitive; it is what the TV apps use to find the server and check that their version matches.
