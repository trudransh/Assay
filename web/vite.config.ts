import { readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, ".", "").HOST_TARGET || "http://localhost:8787";
  // The host sends no CORS headers, so the dev and preview servers serve it under /host.
  const mainnet = loadEnv(mode, ".", "").HOST_TARGET_MAINNET || `${target}/mainnet`;
  const kimi = loadEnv(mode, ".", "").HOST_TARGET_KIMI || `${target}/kimi`;
  const proxy = {
    "/host-kimi": { target: kimi, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/host-kimi/, "") },
    "/host-mainnet": { target: mainnet, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/host-mainnet/, "") },
    "/host": { target, changeOrigin: true, rewrite: (p: string) => p.replace(/^\/host/, "") },
  };
  // `vite preview` sends the production headers from vercel.json, so the CSP is tested before it ships.
  const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as { headers: { headers: { key: string; value: string }[] }[] };
  const headers = Object.fromEntries(vercel.headers[0].headers.map((x) => [x.key, x.value]));
  return {
    // Two pages on one origin: the landing at / and the app at /app/, so passkeys work in both.
    build: { rolldownOptions: { input: { landing: "index.html", app: "app/index.html" } } },
    server: { proxy },
    preview: { proxy, headers },
    test: { environment: "node" },
  };
});
