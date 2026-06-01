import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

function stripCrossorigin(): Plugin {
  return {
    name: "strip-crossorigin",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return html.replace(/\s+crossorigin(=["\'][^"\']*["\'])?/g, "");
      },
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [tailwindcss(), react(), stripCrossorigin()],
  resolve: {
    alias: {
      "@": path.resolve("src/renderer"),
    },
  },
  build: {
    outDir: path.resolve("dist/renderer"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      onLog(level, log) {
        if (
          level === "warn" &&
          log.code === "MODULE_LEVEL_DIRECTIVE" &&
          log.message.includes("use client")
        ) {
          return;
        }
      },
    },
  },
});
