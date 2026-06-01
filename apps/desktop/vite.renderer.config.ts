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
    chunkSizeWarningLimit: 1000,
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
      output: {
        manualChunks(id) {
          if (id.includes("recharts") || id.includes("d3-") || id.includes("d3/")) {
            return "vendor-charts";
          }
          if (id.includes("lucide-react")) {
            return "vendor-icons";
          }
          if (id.includes("radix-ui") || id.includes("@radix-ui")) {
            return "vendor-radix";
          }
          if (id.includes("vendor/design-system")) {
            return "vendor-ds";
          }
        },
      },
    },
  },
});
