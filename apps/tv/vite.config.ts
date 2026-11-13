import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { flexGapFallback } from "./flexGapFallback";

export default defineConfig({
  plugins: [react()],
  base: "/tv/",
  css: {
    postcss: { plugins: [flexGapFallback()] },
  },
  build: {
    // TV browsers lag far behind Vite's default (Chrome 107+). Chromium 68 covers webOS 5 and Tizen 5.5 and newer.
    // Only syntax is lowered; runtime APIs newer than Chromium 68 must not be used (see docs/smart-tv.md).
    target: ["chrome68", "es2018"],
    cssTarget: "chrome68",
  },
  server: {
    port: 5174,
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
});
