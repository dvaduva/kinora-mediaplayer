import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { readShellLaunch } from "./host";
import "@kinora/media-ui/music.css";
import "./styles.css";

// Before the router reads the address: the shell's hash carries the token and is removed right away.
readShellLaunch();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
