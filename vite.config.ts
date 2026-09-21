import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

export default defineConfig({
  // 8080 to match what the app was already being served on.
  server: { port: 8080, host: true },
  resolve: {
    // Vite resolves the `@/*` alias straight from tsconfig.json now, so there
    // is no need for the vite-tsconfig-paths plugin.
    tsconfigPaths: true,
    // One copy of each, or hooks break across duplicated module instances.
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-store"],
  },
  plugins: [
    tailwindcss(),
    // `server.entry` points at src/server.ts, our SSR error wrapper, instead
    // of TanStack Start's bundled default.
    tanstackStart({ server: { entry: "server" } }),
    // Deliberately no `preset`. Nitro detects the platform at build time:
    // `vercel` in CI on Vercel, `node-server` locally. The previous config
    // pinned `cloudflare-module`, which only worked in production because
    // Vercel sets NITRO_PRESET and env wins over config.
    nitro(),
    viteReact(),
  ],
});
