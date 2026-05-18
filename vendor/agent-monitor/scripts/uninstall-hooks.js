#!/usr/bin/env node

/**
 * CLOSEDLOOP VENDOR ADDITION #3 (see vendor/agent-monitor/VENDOR.md).
 *
 * Upstream ships install-hooks.js but no uninstall. The host app gates hook
 * installation behind explicit user consent and must be able to fully reverse
 * it when the user disables session tracking. This removes exactly the hook
 * entries install-hooks.js writes, using the same getSettingsPath() and the
 * same "is this our entry?" predicate so install/uninstall stay symmetric.
 *
 * Mirrors install-hooks.js:isOurEntry — matches both the legacy flat
 * `entry.command` shape and the current `entry.hooks[].command` shape.
 */

const fs = require("fs");

const { getSettingsPath } = require("../server/lib/claude-home");
const SETTINGS_PATH = getSettingsPath();

function isOurEntry(entry) {
  if (entry.command && entry.command.includes("hook-handler.js")) return true;
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some(
      (h) => h.command && h.command.includes("hook-handler.js"),
    );
  }
  return false;
}

function uninstallHooks(silent = false) {
  if (!fs.existsSync(SETTINGS_PATH)) {
    if (!silent) console.log(`No settings file at ${SETTINGS_PATH} — nothing to remove.`);
    return true;
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
  } catch (err) {
    if (!silent) console.error(`Failed to parse ${SETTINGS_PATH}:`, err.message);
    return false;
  }

  if (!settings || !settings.hooks) {
    if (!silent) console.log("No hooks configured — nothing to remove.");
    return true;
  }

  let removed = 0;
  for (const hookType of Object.keys(settings.hooks)) {
    const arr = settings.hooks[hookType];
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((entry) => {
      const ours = isOurEntry(entry);
      if (ours) removed++;
      return !ours;
    });
    if (kept.length > 0) {
      settings.hooks[hookType] = kept;
    } else {
      delete settings.hooks[hookType];
    }
  }

  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  fs.writeFileSync(
    SETTINGS_PATH,
    JSON.stringify(settings, null, 2) + "\n",
    "utf8",
  );

  if (!silent) {
    console.log(`Settings file: ${SETTINGS_PATH}`);
    console.log(`Removed ${removed} dashboard hook entr${removed === 1 ? "y" : "ies"}.`);
  }

  return true;
}

if (require.main === module) {
  uninstallHooks(false);
}

module.exports = { uninstallHooks };
