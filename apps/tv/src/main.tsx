import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { listenForShellKeys, readShellLaunch } from "./host";
import "@kinora/media-ui/music.css";
import "./styles.css";

/** Flex `gap` is Chromium 84+; older TV browsers get margins instead (see flexGapFallback.ts). */
function markMissingFlexGap() {
  const probe = document.createElement("div");
  probe.style.cssText = "display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden";
  probe.appendChild(document.createElement("div"));
  probe.appendChild(document.createElement("div"));
  document.body.appendChild(probe);
  const supported = probe.scrollHeight === 1;
  probe.remove();
  if (!supported) document.documentElement.classList.add("no-flex-gap");
}

markMissingFlexGap();

// Before the router reads the address: the shell's hash carries the token and is removed right away.
readShellLaunch();
listenForShellKeys();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
