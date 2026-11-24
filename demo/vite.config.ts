import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.DEMO_BASE ?? "/",
  publicDir: "../assets",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "index.html"),
        react: resolve(import.meta.dirname, "react.html"),
      },
    },
  },
});
