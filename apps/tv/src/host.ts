import { SHELL_MESSAGE_SOURCE, type ShellMessageType } from "@kinora/shared";

const SHELL_KEY = "kinora.tv.inShell";

/**
 * What the TV shell passed in the URL hash when it opened this UI: `#shell=1&token=…`.
 * The hash never reaches the server; it is read once at start and removed from the address bar.
 */
export type ShellLaunch = { inShell: boolean; token: string | null };

let launch: ShellLaunch | null = null;

export function readShellLaunch(): ShellLaunch {
  if (launch) return launch;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  let inShell = params.get("shell") === "1";
  const token = params.get("token");
  try {
    // A reload inside the frame loses the hash; the session remembers that a shell is around.
    if (inShell) sessionStorage.setItem(SHELL_KEY, "1");
    else inShell = sessionStorage.getItem(SHELL_KEY) === "1";
  } catch {
    // storage unavailable
  }
  inShell = inShell && window.parent !== window;
  if (params.has("shell") || params.has("token")) {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
  launch = { inShell, token };
  return launch;
}

export function inShell() {
  return readShellLaunch().inShell;
}

export function notifyShell(type: ShellMessageType) {
  if (!inShell()) return false;
  // The shell's page is packaged with the app (file:// or app://), so there is no origin to name.
  window.parent.postMessage({ source: SHELL_MESSAGE_SOURCE, type }, "*");
  return true;
}

/** Leaves the app: through the shell on a TV, or the platform API when this page is the app itself. */
export function exitApp() {
  if (notifyShell("exit")) return;
  const host = window as unknown as {
    tizen?: { application?: { getCurrentApplication?: () => { exit: () => void } } };
    webOS?: { platformBack?: () => void };
  };
  try {
    const app = host.tizen?.application?.getCurrentApplication?.();
    if (app) return app.exit();
    if (host.webOS?.platformBack) return host.webOS.platformBack();
  } catch {
    // fall through
  }
  window.close();
}
