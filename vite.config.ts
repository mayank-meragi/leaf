import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// `base` is set for GitHub Pages deploys (https://<user>.github.io/leaf/).
export default defineConfig({
  base: process.env.LEAF_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5180, strictPort: true },
});
