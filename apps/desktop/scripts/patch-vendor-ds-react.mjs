// Patches vendored @closedloop-ai/design-system dist files that reference
// `React` as a bare global (missing/incorrect import/require statements).
// Run after pnpm install or by build:renderer.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const VENDOR_DIST = new URL(
  "../vendor/design-system/dist",
  import.meta.url,
).pathname;

const REACT_CJS_LINE = 'var React = require("react");\n';
const REACT_ESM_LINE = 'import React from "react";\n';

function hasScopeImport(code) {
  return (
    /\bvar\s+React\b\s*=/.test(code) ||
    /import\s+(?:\*\s+as\s+)?React\s+from\s/.test(code) ||
    /\bimport\s+\{[^}]*\bReact\b[^}]*\}\s+from\s/.test(code)
  );
}

function walk(dir) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (entry.endsWith(".js") || entry.endsWith(".cjs") || entry.endsWith(".mjs")) {
      patch(full);
    }
  }
}

function patch(file) {
  let code = readFileSync(file, "utf-8");
  const ext = extname(file);

  // --- Step 1: Deduplicate stale patches from earlier tool runs ---
  // If our patch line is present AND there's already a proper React import,
  // remove the stale patch line.
  const lines = code.split("\n");
  let changed = false;

  // For ESM: check if line 1 is our patch and another React import exists
  if (
    ext === ".mjs" &&
    (lines[0] === 'import React from "react"' || lines[0] === 'import React from "react";') &&
    hasScopeImport(code.slice(code.indexOf("\n") + 1))
  ) {
    code = lines.slice(1).join("\n");
    changed = true;
  }

  // For CJS: check if line 2 (after "use strict") is our patch
  if (
    ext !== ".mjs" &&
    lines[0] === '"use strict"' &&
    (lines[1] === 'var React = require("react")' || lines[1] === 'var React = require("react");') &&
    hasScopeImport(code.slice(code.indexOf("\n", code.indexOf("\n") + 1) + 1))
  ) {
    code = '"use strict";\n' + lines.slice(2).join("\n");
    changed = true;
  }

  // --- Step 2: Re-check if already patched (dedup may have just cleaned it) ---
  if (code.includes(REACT_ESM_LINE) || code.includes(REACT_CJS_LINE)) {
    if (changed) {
      writeFileSync(file, code);
      console.log(`  dedup: ${file.replace(VENDOR_DIST, "")}`);
    }
    return;
  }

  // If dedup removed our patch but the file already has its own React import, we're done.
  if (changed && hasScopeImport(code)) {
    writeFileSync(file, code);
    console.log(`  dedup: ${file.replace(VENDOR_DIST, "")}`);
    return;
  }

  // --- Step 3: Check if file needs patching ---
  if (!/\bReact\s*[\.\(]/.test(code)) {
    return;
  }

  // Skip if React is already properly in scope
  if (hasScopeImport(code)) {
    return;
  }

  const line = ext === ".mjs" ? REACT_ESM_LINE : REACT_CJS_LINE;
  if (code.startsWith('"use strict";\n')) {
    code = code.replace('"use strict";\n', '"use strict";\n' + line);
  } else {
    code = line + code;
  }
  writeFileSync(file, code);
  console.log(`  patched: ${file.replace(VENDOR_DIST, "")}`);
}

walk(VENDOR_DIST);
