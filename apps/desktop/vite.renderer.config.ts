import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const DESIGN_SYSTEM_PACKAGE = "@closedloop-ai/design-system";
const DESIGN_SYSTEM_DIST_DIR = path.resolve(
  "node_modules",
  "@closedloop-ai",
  "design-system",
  "dist",
);

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

function usePatchedDesignSystemBuild(): Plugin {
  return {
    name: "use-patched-design-system-build",
    enforce: "pre",
    resolveId(source) {
      if (source === DESIGN_SYSTEM_PACKAGE) {
        return path.join(DESIGN_SYSTEM_DIST_DIR, "index.mjs");
      }

      if (source.startsWith(`${DESIGN_SYSTEM_PACKAGE}/`)) {
        const subpath = source.slice(`${DESIGN_SYSTEM_PACKAGE}/`.length);
        if (subpath.endsWith(".css")) {
          return null;
        }
        return path.join(DESIGN_SYSTEM_DIST_DIR, `${subpath}.mjs`);
      }

      return null;
    },
    transform(code, id) {
      if (
        !id.startsWith(DESIGN_SYSTEM_DIST_DIR)
        || !id.endsWith(".mjs")
        || !code.includes("React.createElement")
        || code.includes('from "react"')
        || code.includes("from 'react'")
      ) {
        return null;
      }

      return {
        code: `import * as React from "react";\n${code}`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [usePatchedDesignSystemBuild(), tailwindcss(), react(), stripCrossorigin()],
  resolve: {
    alias: {
      "@": path.resolve("src/renderer"),
    },
  },
  optimizeDeps: {
    exclude: [DESIGN_SYSTEM_PACKAGE],
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
          if (id.includes("@closedloop-ai/design-system")) {
            return "vendor-ds";
          }
        },
      },
    },
  },
});
