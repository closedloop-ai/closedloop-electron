"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// components/ui/utils.ts
var utils_exports = {};
__export(utils_exports, {
  badgeClassName: () => badgeClassName,
  formatCompactNumber: () => formatCompactNumber,
  formatCurrency: () => formatCurrency,
  formatDateTime: () => formatDateTime,
  formatDurationSeconds: () => formatDurationSeconds,
  formatLocalTime: () => formatLocalTime,
  formatRelativeLabel: () => formatRelativeLabel,
  formatTokenCount: () => formatTokenCount,
  getBadgeVariant: () => getBadgeVariant,
  hasTuiTags: () => hasTuiTags,
  messagesToEnvelopes: () => messagesToEnvelopes,
  parseTuiSegments: () => parseTuiSegments,
  stringifyJsonValue: () => stringifyJsonValue,
  stripAnsi: () => stripAnsi,
  truncateMiddle: () => truncateMiddle
});
module.exports = __toCommonJS(utils_exports);
var badgeClassName = "rounded-md px-1.5 py-0.5 font-medium text-[10px]";
function getBadgeVariant(tone = "muted") {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  if (tone === "danger") {
    return "destructive";
  }
  if (tone === "info") {
    return "info";
  }
  if (tone === "accent") {
    return "accent";
  }
  if (tone === "default") {
    return "outline";
  }
  return "muted";
}
function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}
function formatRelativeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 6e4);
  const absoluteMinutes = Math.abs(diffMinutes);
  if (absoluteMinutes < 1) {
    return "just now";
  }
  if (absoluteMinutes < 60) {
    return `${absoluteMinutes}m ${diffMinutes >= 0 ? "from now" : "ago"}`;
  }
  const absoluteHours = Math.round(absoluteMinutes / 60);
  if (absoluteHours < 24) {
    return `${absoluteHours}h ${diffMinutes >= 0 ? "from now" : "ago"}`;
  }
  const absoluteDays = Math.round(absoluteHours / 24);
  return `${absoluteDays}d ${diffMinutes >= 0 ? "from now" : "ago"}`;
}
function formatDateTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
function truncateMiddle(value, max = 32) {
  if (value.length <= max) {
    return value;
  }
  const visible = max - 3;
  if (visible <= 0) {
    return "...";
  }
  const head = Math.ceil(visible / 2);
  const tail = Math.floor(visible / 2);
  const suffix = tail > 0 ? value.slice(-tail) : "";
  return `${value.slice(0, head)}...${suffix}`;
}
function formatDurationSeconds(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0s";
  }
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const seconds = Math.round(value % 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
function formatCompactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}
function formatTokenCount(count) {
  const BILLION = 1e9;
  const MILLION = 1e6;
  const THOUSAND = 1e3;
  if (count >= BILLION) {
    return `${(count / BILLION).toFixed(2)}B`;
  }
  if (count >= MILLION) {
    const divided = count / MILLION;
    if (divided >= 999.995) {
      return `${(count / BILLION).toFixed(2)}B`;
    }
    return `${divided.toFixed(2)}M`;
  }
  if (count >= THOUSAND) {
    const divided = count / THOUSAND;
    if (divided >= 999.995) {
      return `${(count / MILLION).toFixed(2)}M`;
    }
    return `${divided.toFixed(2)}k`;
  }
  return count.toString();
}
var SIMPLE_TUI_TAGS = {
  "local-command-caveat": "caveat",
  "local-command-stdout": "stdout",
  "local-command-stderr": "stderr",
  "system-reminder": "system-reminder",
  "persisted-output": "persisted-output"
};
var COMMAND_TUI_TAGS = [
  "command-name",
  "command-message",
  "command-args"
];
var KNOWN_TUI_TAG_RE = new RegExp(
  `<(?:${[...Object.keys(SIMPLE_TUI_TAGS), ...COMMAND_TUI_TAGS].join("|")})\\b`
);
var ANSI_RE = /\[[\d;]*m|\[\d+(?:;\d+)*m/g;
var COMMAND_NAME_RE = /<command-name>([^<]*)<\/command-name>/;
var COMMAND_ARGS_RE = /<command-args>([^<]*)<\/command-args>/;
function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}
function findSimpleTagMatches(input) {
  const matches = [];
  for (const [tag, kind] of Object.entries(SIMPLE_TUI_TAGS)) {
    const matcher = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
    let result;
    result = matcher.exec(input);
    while (result !== null) {
      matches.push({
        start: result.index,
        end: result.index + result[0].length,
        segment: {
          kind,
          text: result[1] ?? ""
        }
      });
      result = matcher.exec(input);
    }
  }
  return matches;
}
function findCommandMatches(input) {
  const matches = [];
  const matcher = /(?:<command-(?:name|message|args)>[^<]*<\/command-(?:name|message|args)>\s*){1,3}/g;
  let result;
  result = matcher.exec(input);
  while (result !== null) {
    const block = result[0];
    const name = COMMAND_NAME_RE.exec(block)?.[1] ?? "";
    const args = COMMAND_ARGS_RE.exec(block)?.[1] ?? "";
    if (name) {
      const trimmedArgs = args.trim();
      matches.push({
        start: result.index,
        end: result.index + block.length,
        segment: {
          kind: "command",
          display: trimmedArgs ? `${name} ${trimmedArgs}` : name
        }
      });
    }
    result = matcher.exec(input);
  }
  return matches;
}
function parseTuiSegments(input) {
  if (!KNOWN_TUI_TAG_RE.test(input)) {
    return [{ kind: "text", text: input }];
  }
  const matches = [
    ...findSimpleTagMatches(input),
    ...findCommandMatches(input)
  ].sort((left, right) => left.start - right.start);
  const segments = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) {
      continue;
    }
    if (match.start > cursor) {
      const between = input.slice(cursor, match.start);
      if (between.trim()) {
        segments.push({ kind: "text", text: between });
      }
    }
    segments.push(match.segment);
    cursor = match.end;
  }
  if (cursor < input.length) {
    const tail = input.slice(cursor);
    if (tail.trim()) {
      segments.push({ kind: "text", text: tail });
    }
  }
  return segments.length > 0 ? segments : [{ kind: "text", text: input }];
}
function hasTuiTags(input) {
  return KNOWN_TUI_TAG_RE.test(input);
}
function formatLocalTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}
function stringifyJsonValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}
function ensureConversationBlocks(message) {
  if (message.blocks && message.blocks.length > 0) {
    return message.blocks;
  }
  if (message.content.trim().length === 0) {
    return [];
  }
  return [{ type: "text", text: message.content }];
}
function messagesToEnvelopes(messages) {
  return messages.map((message) => {
    const content = ensureConversationBlocks(message);
    if (message.role === "assistant") {
      return {
        id: message.id,
        type: "assistant",
        author: message.author,
        createdAt: message.createdAt,
        content,
        usage: message.usage ? {
          inputTokens: message.usage.inputTokens,
          outputTokens: message.usage.outputTokens
        } : null
      };
    }
    if (message.role === "user") {
      return {
        id: message.id,
        type: "user",
        author: message.author,
        createdAt: message.createdAt,
        content
      };
    }
    return {
      id: message.id,
      type: message.role,
      createdAt: message.createdAt,
      data: {
        author: message.author,
        content: message.content
      }
    };
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  badgeClassName,
  formatCompactNumber,
  formatCurrency,
  formatDateTime,
  formatDurationSeconds,
  formatLocalTime,
  formatRelativeLabel,
  formatTokenCount,
  getBadgeVariant,
  hasTuiTags,
  messagesToEnvelopes,
  parseTuiSegments,
  stringifyJsonValue,
  stripAnsi,
  truncateMiddle
});
//# sourceMappingURL=utils.js.map