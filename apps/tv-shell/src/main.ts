import { detectLocale, isPlayerCommand, isShellMessage, PLAYER_BRIDGE_SOURCE, type HealthInfo, type PairPoll, type PairStart, type PlayerReport } from "@kinora/shared";
import { shellCopy } from "@kinora/client/shell-copy";
import { detectAvplayCapabilities, detectCapabilities, detectWebosCapabilities, hasAvplay, type WebosInfo } from "@kinora/client/capabilities";
import { createAvplayController, type Avplay, type AvplayController } from "./avplay";
import { compatibility, isHealth, scan, scanTargets, type Found } from "./discovery";
import { focusFirst, focusRoot, handleFocusKey } from "./focus";
import { request } from "./net";
import { detectPlatform, deviceName, exitApp, isBackKey, localAddress, registerKeys, webosInfo } from "./platform";
import { qrSvg } from "./qr";
import { clearCurrent, currentServer, hostOf, knownServers, normalizeServerUrl, rememberServer, setToken } from "./servers";
import "./styles.css";

const t = shellCopy[detectLocale(navigator.language)];
const platform = detectPlatform();

const HEALTH_TIMEOUT = 4000;
const PROBE_TIMEOUT = 1500;
const HEARTBEAT_MS = 10_000;
const OFFLINE_RETRY_S = 5;
const PAIR_POLL_MS = 2000;

const view = document.getElementById("view") as HTMLElement;
const frame = document.getElementById("frame") as HTMLIFrameElement;
focusRoot(view);

type Screen = "checking" | "servers" | "pair" | "offline" | "incompatible" | "app";
let screen: Screen = "checking";
/** Bumped on every screen change; async work started for an older screen sees the mismatch and stops. */
let generation = 0;
let timers: number[] = [];
let activeUrl: string | null = null;

/**
 * Samsung's native player, when this is the Tizen package: it plays MKV, HEVC, HDR and Dolby audio the
 * <video> element cannot. It exists only in this page, so the UI in the frame drives it by message.
 */
const avplay: AvplayController | null = platform === "tizen" && hasAvplay() ? setupAvplay() : null;

/**
 * On webOS the UI's own <video> plays through LG's native pipeline (MKV, HEVC, HDR, Dolby audio, HLS),
 * so nothing is bridged; the shell only knows the TV's model and panel (Luna), which shape the profile.
 * Asked once, at start.
 */
const webos: Promise<WebosInfo> | null = platform === "webos" ? webosInfo() : null;

/** The player the UI is told to use, in the launch hash. */
const launchPlayer = avplay ? "avplay" : webos ? "webos" : null;

function setupAvplay() {
  const player = (window as unknown as { webapis: { avplay: Avplay } }).webapis.avplay;
  // AVPlay renders into this element's video plane; it sits under the frame, which turns transparent while playing.
  const plane = document.createElement("object");
  plane.id = "avplayer";
  plane.setAttribute("type", "application/avplayer");
  document.body.insertBefore(plane, frame);
  const controller = createAvplayController(player, {
    send: (report: PlayerReport) => {
      if (!frame.contentWindow || !activeUrl) return;
      frame.contentWindow.postMessage({ source: PLAYER_BRIDGE_SOURCE, ...report }, originOf(activeUrl));
    },
    onActive: (active) => {
      if (active) document.documentElement.classList.add("avplay-active");
      else document.documentElement.classList.remove("avplay-active");
    },
  });
  document.addEventListener("visibilitychange", () => controller.visibility(document.hidden));
  return controller;
}

function originOf(url: string) {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return match ? match[1]!.toLowerCase() : "*";
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => escapeHtml(String(values[key] ?? "")));
}

function enter(next: Screen) {
  generation += 1;
  for (const timer of timers) {
    window.clearTimeout(timer);
    window.clearInterval(timer);
  }
  timers = [];
  screen = next;
  if (next !== "app") {
    avplay?.stop();
    frame.hidden = true;
    // Leaving the UI stops whatever it was playing.
    if (frame.getAttribute("src") !== "about:blank") frame.setAttribute("src", "about:blank");
  }
  return generation;
}

function render(html: string, preferred?: string) {
  view.hidden = false;
  view.innerHTML = `<div class="card">${html}</div>`;
  focusFirst(preferred);
}

function on(selector: string, handler: () => void) {
  const element = view.querySelector<HTMLElement>(selector);
  element?.addEventListener("click", (event) => {
    event.preventDefault();
    handler();
  });
}

function onSubmit(selector: string, handler: (value: string) => void) {
  const form = view.querySelector<HTMLFormElement>(selector);
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    handler(input ? input.value : "");
  });
}

function setText(selector: string, text: string, tone?: "error") {
  const element = view.querySelector<HTMLElement>(selector);
  if (!element) return;
  element.textContent = text;
  element.className = tone === "error" ? "note error" : "note";
}

async function health(url: string, timeout = HEALTH_TIMEOUT): Promise<HealthInfo | null> {
  const response = await request("GET", `${url}/api/health`, { timeout });
  return response.status === 200 && isHealth(response.body) ? response.body : null;
}

// ---------------------------------------------------------------- connect

async function connect(url: string) {
  const gen = enter("checking");
  activeUrl = url;
  render(`<p class="eyebrow">Kinora</p><h1>${fill(t.connectingTo, { server: hostOf(url) })}</h1><div class="spinner"></div>`);
  const info = await health(url);
  if (gen !== generation) return;
  if (!info) return showOffline(url);
  if (compatibility(info) !== "ok") return showIncompatible(url, info);
  const server = rememberServer(url, { version: info.serverVersion });
  if (!server.token) return startPairing(url);
  const me = await request("GET", `${url}/api/devices/me`, { token: server.token, timeout: HEALTH_TIMEOUT });
  if (gen !== generation) return;
  if (me.status === 401) {
    setToken(url, null);
    return startPairing(url);
  }
  if (me.status !== 200) return showOffline(url);
  // Signed in with the shared access key: trade it for a device token, so the server knows what this TV decodes.
  if (!isDeviceToken(server.token)) {
    const token = await pairWithKey(url, server.token);
    if (gen !== generation) return;
    if (token) {
      setToken(url, token);
      return openApp(url, token);
    }
  }
  openApp(url, server.token);
}

// ---------------------------------------------------------------- the UI, in a frame

function openApp(url: string, token: string) {
  const gen = enter("app");
  view.hidden = true;
  view.innerHTML = "";
  frame.hidden = false;
  frame.onload = () => {
    frame.focus();
    frame.contentWindow?.focus();
  };
  frame.setAttribute("src", `${url}/tv/#shell=1&token=${encodeURIComponent(token)}${launchPlayer ? `&player=${launchPlayer}` : ""}`);
  // The heartbeat tells "server gone" (offline screen, then back on its own) from "device revoked" (pairing).
  let misses = 0;
  const beat = async () => {
    const response = await request("GET", `${url}/api/devices/me`, { token, timeout: HEALTH_TIMEOUT });
    if (gen !== generation) return;
    if (response.status === 401) {
      setToken(url, null);
      startPairing(url);
      return;
    }
    misses = response.status === 0 ? misses + 1 : 0;
    if (misses >= 2) showOffline(url);
  };
  timers.push(window.setInterval(() => void beat(), HEARTBEAT_MS));
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || screen !== "app") return;
  if (isPlayerCommand(event.data)) return handlePlayerCommand(event.data);
  if (!isShellMessage(event.data)) return;
  const url = activeUrl;
  if (event.data.type === "exit") exitApp();
  else if (event.data.type === "ready") frame.focus();
  else if (event.data.type === "change-server") showServers(false);
  else if (event.data.type === "unauthorized" && url) {
    setToken(url, null);
    startPairing(url);
  }
});

function handlePlayerCommand(command: Parameters<AvplayController["handle"]>[0]) {
  const url = activeUrl;
  if (!launchPlayer || !url || !frame.contentWindow) return;
  if (command.command === "capabilities") {
    const request = command.request;
    void safeCapabilities().then((profile) => {
      if (activeUrl !== url || !frame.contentWindow) return;
      const report: PlayerReport = { event: "capabilities", request, profile };
      frame.contentWindow.postMessage({ source: PLAYER_BRIDGE_SOURCE, ...report }, originOf(url));
    });
    return;
  }
  if (!avplay) return;
  // The player opens media from the connected server only, never an address the page made up.
  if (command.command === "load" && originOf(command.url) !== originOf(url)) return;
  avplay.handle(command);
}

// ---------------------------------------------------------------- offline

function showOffline(url: string) {
  const gen = enter("offline");
  render(
    `<p class="eyebrow">Kinora</p>
     <h1>${escapeHtml(t.offlineTitle)}</h1>
     <p class="lede">${fill(t.offlineHelp, { server: hostOf(url) })}</p>
     <p class="note" id="countdown"></p>
     <div class="actions">
       <button id="retry" class="primary">${escapeHtml(t.retry)}</button>
       <button id="change">${escapeHtml(t.changeServer)}</button>
     </div>`,
    "#retry",
  );
  on("#retry", () => void connect(url));
  on("#change", () => showServers(false));
  // Probes quietly in the background and reconnects by itself once the server answers again.
  let seconds = OFFLINE_RETRY_S;
  const tick = async () => {
    if (gen !== generation) return;
    seconds -= 1;
    if (seconds > 0) {
      setText("#countdown", fill(t.retryIn, { seconds }));
      return;
    }
    setText("#countdown", fill(t.connectingTo, { server: hostOf(url) }));
    const info = await health(url);
    if (gen !== generation) return;
    if (info) void connect(url);
    else seconds = OFFLINE_RETRY_S;
  };
  setText("#countdown", fill(t.retryIn, { seconds }));
  timers.push(window.setInterval(() => void tick(), 1000));
}

// ---------------------------------------------------------------- incompatible

function showIncompatible(url: string, info: HealthInfo) {
  enter("incompatible");
  const message = compatibility(info) === "server-too-old" ? t.serverTooOld : t.appTooOld;
  render(
    `<p class="eyebrow">Kinora · ${escapeHtml(hostOf(url))}</p>
     <h1>${escapeHtml(t.incompatibleTitle)}</h1>
     <p class="lede">${fill(message, { version: info.serverVersion })}</p>
     <div class="actions">
       <button id="retry" class="primary">${escapeHtml(t.retry)}</button>
       <button id="change">${escapeHtml(t.changeServer)}</button>
     </div>`,
  );
  on("#retry", () => void connect(url));
  on("#change", () => showServers(false));
}

// ---------------------------------------------------------------- servers and discovery

function serverButton(url: string, detail: string | null) {
  return `<button class="server" data-url="${escapeHtml(url)}"><strong>${escapeHtml(hostOf(url))}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</button>`;
}

function showServers(autoConnect: boolean) {
  const gen = enter("servers");
  clearCurrent();
  const known = knownServers();
  render(
    `<p class="eyebrow">Kinora</p>
     <h1>${escapeHtml(t.serversTitle)}</h1>
     <p class="lede">${escapeHtml(t.serversHelp)}</p>
     ${known.length ? `<h2>${escapeHtml(t.knownServers)}</h2><div class="servers" id="known">${known.map((server) => serverButton(server.url, server.version ? `Kinora ${server.version}` : null)).join("")}</div>` : ""}
     <h2>${escapeHtml(t.foundServers)}</h2>
     <div class="servers" id="found"></div>
     <p class="note" id="scan-status"></p>
     <button id="rescan" hidden>${escapeHtml(t.scanAgain)}</button>
     <form id="manual" class="manual">
       <label>${escapeHtml(t.manualAddress)}
         <input id="address" placeholder="${escapeHtml(t.manualPlaceholder)}" autocomplete="off" spellcheck="false" inputmode="url" />
       </label>
       <button type="submit" class="primary">${escapeHtml(t.connect)}</button>
     </form>
     <p class="note" id="manual-status"></p>`,
    known.length ? "#known .server" : "#address",
  );
  const pick = (url: string) => void connect(url);
  view.querySelectorAll<HTMLElement>("#known .server").forEach((button) => {
    button.addEventListener("click", () => pick(button.getAttribute("data-url")!));
  });
  onSubmit("#manual", (value) => {
    const url = normalizeServerUrl(value);
    if (!url) return setText("#manual-status", t.badAddress, "error");
    setText("#manual-status", fill(t.connectingTo, { server: hostOf(url) }));
    void health(url).then((info) => {
      if (gen !== generation) return;
      if (!info) setText("#manual-status", t.notKinora, "error");
      else void connect(url);
    });
  });
  on("#rescan", () => void runScan(gen, false));
  void runScan(gen, autoConnect && known.length === 0);
}

async function runScan(gen: number, autoConnect: boolean) {
  const found = view.querySelector<HTMLElement>("#found");
  const rescan = view.querySelector<HTMLButtonElement>("#rescan");
  if (!found || !rescan) return;
  found.innerHTML = "";
  rescan.hidden = true;
  const ip = await localAddress(platform);
  if (gen !== generation) return;
  const targets = ip ? scanTargets(ip, knownServers().map((server) => server.url)) : [];
  if (targets.length === 0) {
    setText("#scan-status", t.scanUnavailable);
    return;
  }
  const results: Found[] = await scan(
    targets,
    async (url) => {
      const response = await request("GET", `${url}/api/health`, { timeout: PROBE_TIMEOUT });
      return response.status === 200 ? response.body : null;
    },
    {
      cancelled: () => gen !== generation,
      onProgress: (done, total) => setText("#scan-status", fill(t.scanning, { done, total })),
      onFound: (entry) => {
        const holder = document.createElement("div");
        holder.innerHTML = serverButton(entry.url, `Kinora ${entry.health.serverVersion}`);
        const button = holder.firstElementChild as HTMLElement;
        button.addEventListener("click", () => void connect(entry.url));
        found.appendChild(button);
      },
    },
  );
  if (gen !== generation) return;
  rescan.hidden = false;
  setText("#scan-status", results.length === 0 ? t.scanNone : "");
  // A fresh TV that finds exactly one server goes straight on to pairing.
  if (autoConnect && results.length === 1) void connect(results[0]!.url);
  else if (results.length > 0 && document.activeElement === document.body) focusFirst("#found .server");
}

// ---------------------------------------------------------------- pairing

/** Device tokens are issued by pairing; anything else the shell holds is the shared access key. */
function isDeviceToken(token: string) {
  return token.startsWith("kd_");
}

/**
 * Pairs this TV with the access key standing in for the approval on a phone. Without a device token the
 * server cannot tell a TV from a browser: it serves the browser profile and transcodes what AVPlay plays.
 */
async function pairWithKey(url: string, key: string): Promise<string | null> {
  const name = deviceName(platform, webos ? await webos : null);
  const capabilities = await safeCapabilities();
  const started = await request("POST", `${url}/api/pair`, { body: { name, platform, capabilities }, timeout: HEALTH_TIMEOUT });
  if (started.status !== 201) return null;
  const pair = started.body as PairStart;
  const approved = await request("POST", `${url}/api/pair/${pair.code}/approve`, { token: key, body: {}, timeout: HEALTH_TIMEOUT });
  if (approved.status !== 200) return null;
  const polled = await request("GET", `${url}/api/pair/${pair.code}?secret=${encodeURIComponent(pair.secret)}`, { timeout: HEALTH_TIMEOUT });
  const result = polled.status === 200 ? (polled.body as PairPoll) : null;
  return result?.status === "approved" ? result.token : null;
}

/** What this TV decodes, sent with the pairing request; the TV UI sends it again on every start. */
async function safeCapabilities() {
  try {
    if (avplay) return detectAvplayCapabilities();
    if (webos) return detectWebosCapabilities(await webos);
    return detectCapabilities();
  } catch {
    return null;
  }
}

function formatCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function formatLeft(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${(seconds % 60 < 10 ? "0" : "") + (seconds % 60)}`;
}

async function startPairing(url: string) {
  const gen = enter("pair");
  activeUrl = url;
  render(`<p class="eyebrow">Kinora · ${escapeHtml(hostOf(url))}</p><h1>${escapeHtml(t.pairTitle)}</h1><div class="spinner"></div>`);
  const name = deviceName(platform, webos ? await webos : null);
  const capabilities = await safeCapabilities();
  if (gen !== generation) return;
  const started = await request("POST", `${url}/api/pair`, { body: { name, platform, capabilities }, timeout: HEALTH_TIMEOUT });
  if (gen !== generation) return;
  if (started.status === 0) return showOffline(url);
  if (started.status !== 201) {
    render(
      `<p class="eyebrow">Kinora · ${escapeHtml(hostOf(url))}</p>
       <h1>${escapeHtml(t.pairTitle)}</h1>
       <p class="note error">${escapeHtml(t.pairFailed)}</p>
       <div class="actions"><button id="retry" class="primary">${escapeHtml(t.retry)}</button><button id="change">${escapeHtml(t.changeServer)}</button></div>`,
    );
    on("#retry", () => void startPairing(url));
    on("#change", () => showServers(false));
    return;
  }
  const pair = started.body as PairStart;
  const link = `${url}/pair?code=${pair.code}`;
  render(
    `<p class="eyebrow">Kinora · ${escapeHtml(hostOf(url))}</p>
     <h1>${escapeHtml(t.pairTitle)}</h1>
     <div class="pair">
       <div>
         <p class="lede">${escapeHtml(t.pairHelp)}</p>
         <p class="code" aria-label="${escapeHtml(pair.code)}">${escapeHtml(formatCode(pair.code))}</p>
         <p class="link">${escapeHtml(link.replace(/^https?:\/\//, ""))}</p>
         <p class="note" id="pair-status">${escapeHtml(t.pairWaiting)}</p>
       </div>
       <div class="qr">${qrSvg(link)}</div>
     </div>
     <div class="actions">
       <button id="key">${escapeHtml(t.useAccessKey)}</button>
       <button id="change">${escapeHtml(t.changeServer)}</button>
     </div>
     <form id="key-form" class="manual" hidden>
       <label>${escapeHtml(t.accessKey)}<input id="access" type="password" autocomplete="off" /></label>
       <button type="submit" class="primary">${escapeHtml(t.connect)}</button>
     </form>
     <p class="note" id="key-status"></p>`,
    "#key",
  );
  on("#change", () => showServers(false));
  on("#key", () => {
    const form = view.querySelector<HTMLFormElement>("#key-form");
    if (!form) return;
    form.hidden = false;
    form.querySelector("input")?.focus();
  });
  // Typing the shared access key stays as a fallback for when no phone or computer is at hand.
  onSubmit("#key-form", (value) => {
    const key = value.trim();
    if (!key) return;
    void request("GET", `${url}/api/devices/me`, { token: key, timeout: HEALTH_TIMEOUT }).then(async (response) => {
      if (gen !== generation) return;
      if (response.status === 200) {
        const token = (await pairWithKey(url, key)) ?? key;
        if (gen !== generation) return;
        setToken(url, token);
        openApp(url, token);
      } else setText("#key-status", response.status === 0 ? fill(t.offlineHelp, { server: hostOf(url) }) : t.wrongKey, "error");
    });
  });

  let misses = 0;
  // Chained rather than on an interval, so a slow answer never overlaps the next poll.
  const again = () => timers.push(window.setTimeout(() => void poll(), PAIR_POLL_MS));
  const poll = async () => {
    const response = await request("GET", `${url}/api/pair/${pair.code}?secret=${encodeURIComponent(pair.secret)}`, { timeout: HEALTH_TIMEOUT });
    if (gen !== generation) return;
    if (response.status === 0) {
      misses += 1;
      if (misses >= 3) showOffline(url);
      else again();
      return;
    }
    misses = 0;
    const result = response.status === 200 ? (response.body as PairPoll) : null;
    if (result?.status === "approved") {
      setToken(url, result.token);
      openApp(url, result.token);
    } else if (result?.status !== "pending") {
      // Expired, or the server restarted and forgot the code: ask for a fresh one.
      void startPairing(url);
    } else {
      setText("#pair-status", `${t.pairWaiting} ${fill(t.pairExpires, { time: formatLeft(pair.expiresAt - Date.now()) })}`);
      again();
    }
  };
  again();
}

// ---------------------------------------------------------------- keys

function confirmExit() {
  if (document.getElementById("exit")) return;
  const previous = document.activeElement as HTMLElement | null;
  const overlay = document.createElement("div");
  overlay.id = "exit";
  overlay.className = "overlay";
  overlay.innerHTML = `<div class="card small"><h1>${escapeHtml(t.exitTitle)}</h1><div class="actions"><button id="exit-stay" class="primary">${escapeHtml(t.exitStay)}</button><button id="exit-leave">${escapeHtml(t.exitLeave)}</button></div></div>`;
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    focusRoot(view);
    previous?.focus();
  };
  focusRoot(overlay);
  overlay.querySelector<HTMLElement>("#exit-stay")?.addEventListener("click", close);
  overlay.querySelector<HTMLElement>("#exit-leave")?.addEventListener("click", exitApp);
  focusFirst("#exit-stay");
}

document.addEventListener("keydown", (event) => {
  if (screen === "app") {
    // Keys belong to the UI in the frame; a stray one here just hands focus back to it.
    frame.focus();
    return;
  }
  if (isBackKey(event)) {
    event.preventDefault();
    const overlay = document.getElementById("exit");
    if (overlay) {
      overlay.remove();
      focusRoot(view);
      focusFirst();
      return;
    }
    const keyForm = view.querySelector<HTMLFormElement>("#key-form");
    if (keyForm && !keyForm.hidden) {
      keyForm.hidden = true;
      focusFirst("#key");
      return;
    }
    confirmExit();
    return;
  }
  handleFocusKey(event);
});

// ---------------------------------------------------------------- start

registerKeys();
const last = currentServer();
if (last) void connect(last.url);
else showServers(true);
