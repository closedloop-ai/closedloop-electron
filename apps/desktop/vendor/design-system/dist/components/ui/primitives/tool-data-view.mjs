import React from "react";
import {
  UnifiedDiff
} from "../../../chunk-WCPI6B5C.mjs";
import {
  TerminalBlock
} from "../../../chunk-OXJN6TZY.mjs";
import {
  FileList
} from "../../../chunk-SAHR6O6N.mjs";
import {
  KeyValueGrid
} from "../../../chunk-5U35WVIE.mjs";
import {
  MatchList
} from "../../../chunk-6VXOUNUH.mjs";
import {
  CodeBlock
} from "../../../chunk-BPFSJREZ.mjs";
import "../../../chunk-L5AZJM2L.mjs";
import "../../../chunk-TT7DUYOP.mjs";
import "../../../chunk-522NBUZJ.mjs";
import "../../../chunk-JHIJKM5E.mjs";
import "../../../chunk-LZOMFHX3.mjs";

// components/ui/primitives/tool-data-view.tsx
function str(value) {
  return typeof value === "string" ? value : "";
}
function obj(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return null;
}
function isMcp(toolName) {
  return toolName.startsWith("mcp__");
}
function diffFromStrings(oldValue, newValue) {
  if (!oldValue && !newValue) {
    return [];
  }
  const oldLines = oldValue ? oldValue.split(/\r?\n/) : [];
  const newLines = newValue ? newValue.split(/\r?\n/) : [];
  const lines = [
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`)
  ];
  return [
    {
      oldStart: 1,
      newStart: 1,
      oldLines: oldLines.length,
      newLines: newLines.length,
      lines
    }
  ];
}
function parseStructuredPatch(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => {
    const patch = obj(entry);
    if (!patch) {
      return null;
    }
    const lines = Array.isArray(patch.lines) ? patch.lines.filter((line) => typeof line === "string") : [];
    return {
      oldStart: typeof patch.oldStart === "number" ? patch.oldStart : 1,
      newStart: typeof patch.newStart === "number" ? patch.newStart : 1,
      oldLines: typeof patch.oldLines === "number" ? patch.oldLines : lines.length,
      newLines: typeof patch.newLines === "number" ? patch.newLines : lines.length,
      lines
    };
  }).filter((entry) => entry !== null);
}
function toMatch(raw) {
  if (typeof raw === "string") {
    const match = raw.match(/^(.+?):(\d+):(.*)$/);
    if (match) {
      return {
        file: match[1],
        line: Number(match[2]),
        text: match[3]
      };
    }
    return { text: raw };
  }
  const record = obj(raw);
  if (!record) {
    return null;
  }
  const next = {};
  if (typeof record.file === "string") {
    next.file = record.file;
  } else if (typeof record.path === "string") {
    next.file = record.path;
  }
  if (typeof record.line === "number") {
    next.line = record.line;
  } else if (typeof record.line_number === "number") {
    next.line = record.line_number;
  }
  if (typeof record.text === "string") {
    next.text = record.text;
  } else if (typeof record.match === "string") {
    next.text = record.match;
  } else if (typeof record.content === "string") {
    next.text = record.content;
  }
  return next;
}
function parseGrepMatches(value) {
  if (Array.isArray(value)) {
    return value.map(toMatch).filter((entry) => entry !== null);
  }
  const record = obj(value);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.matches)) {
    return record.matches.map(toMatch).filter((entry) => entry !== null);
  }
  if (Array.isArray(record.files)) {
    return record.files.filter((file) => typeof file === "string").map((file) => ({ file }));
  }
  return [];
}
function parseFileList(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => typeof entry === "string");
  }
  const record = obj(value);
  if (!record) {
    return [];
  }
  if (Array.isArray(record.files)) {
    return record.files.filter((entry) => typeof entry === "string");
  }
  if (Array.isArray(record.paths)) {
    return record.paths.filter((entry) => typeof entry === "string");
  }
  return [];
}
function ToolInputView({
  toolName,
  input
}) {
  if (!toolName) {
    return null;
  }
  const record = obj(input);
  if (!record) {
    return null;
  }
  if (isMcp(toolName)) {
    return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record });
  }
  switch (toolName) {
    case "Bash":
    case "PowerShell": {
      const command = str(record.command);
      if (!command) {
        return null;
      }
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command,
          description: str(record.description) || void 0
        }
      );
    }
    case "Read": {
      const path = str(record.file_path);
      const flags = [
        record.offset != null ? `--offset=${record.offset}` : null,
        record.limit != null ? `--limit=${record.limit}` : null
      ].filter(Boolean);
      if (!path) {
        return null;
      }
      return /* @__PURE__ */ React.createElement(TerminalBlock, { command: `read ${path}${flags.length ? ` ${flags.join(" ")}` : ""}` });
    }
    case "Write": {
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, str(record.file_path) ? /* @__PURE__ */ React.createElement(TerminalBlock, { command: `write ${str(record.file_path)}` }) : null, str(record.content) ? /* @__PURE__ */ React.createElement(
        CodeBlock,
        {
          code: str(record.content),
          label: "content",
          showLineNumbers: true
        }
      ) : null);
    }
    case "Edit":
    case "NotebookEdit": {
      const hunks = diffFromStrings(str(record.old_string), str(record.new_string));
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, str(record.file_path) ? /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `edit ${str(record.file_path)}${record.replace_all === true ? " --replace-all" : ""}`
        }
      ) : null, hunks.length > 0 ? /* @__PURE__ */ React.createElement(UnifiedDiff, { hunks }) : null);
    }
    case "Grep": {
      const pattern = str(record.pattern);
      const path = str(record.path);
      const flags = [
        record.glob ? `--glob=${str(record.glob)}` : null,
        record.type ? `--type=${str(record.type)}` : null,
        record.output_mode ? `--mode=${str(record.output_mode)}` : null,
        record["-i"] ? "-i" : null,
        record["-n"] ? "-n" : null
      ].filter(Boolean);
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `grep "${pattern}"${path ? ` ${path}` : ""}${flags.length ? ` ${flags.join(" ")}` : ""}`
        }
      );
    }
    case "Glob":
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `glob "${str(record.pattern)}"${str(record.path) ? ` ${str(record.path)}` : ""}`
        }
      );
    case "WebFetch":
      return /* @__PURE__ */ React.createElement(
        TerminalBlock,
        {
          command: `fetch ${str(record.url)}`,
          description: str(record.prompt) || void 0
        }
      );
    case "Task":
    case "Agent":
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, /* @__PURE__ */ React.createElement(
        KeyValueGrid,
        {
          data: {
            ...str(record.description) ? { description: str(record.description) } : {},
            ...str(record.subagent_type) ? { subagent_type: str(record.subagent_type) } : {}
          }
        }
      ), str(record.prompt) ? /* @__PURE__ */ React.createElement(
        CodeBlock,
        {
          code: str(record.prompt),
          label: "prompt",
          maxHeight: "16rem",
          showLineNumbers: true
        }
      ) : null);
    case "AskUserQuestion": {
      if (!Array.isArray(record.questions)) {
        return null;
      }
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, record.questions.map((question, index) => {
        const value = obj(question);
        if (!value) {
          return null;
        }
        return /* @__PURE__ */ React.createElement(
          KeyValueGrid,
          {
            data: value,
            key: `question-${index}`
          }
        );
      }));
    }
    default:
      return null;
  }
}
function ToolResponseView({
  toolName,
  response
}) {
  if (!toolName) {
    return null;
  }
  if (isMcp(toolName)) {
    const record = obj(response);
    return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
  }
  switch (toolName) {
    case "Bash":
    case "PowerShell": {
      const record = obj(response);
      if (!record) {
        return null;
      }
      const stdout = str(record.stdout);
      const stderr = str(record.stderr);
      const exitCode = typeof record.exitCode === "number" ? `exit ${record.exitCode}` : null;
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, stdout ? /* @__PURE__ */ React.createElement(TerminalBlock, { stream: "stdout", text: stdout }) : null, stderr ? /* @__PURE__ */ React.createElement(TerminalBlock, { stream: "stderr", text: stderr }) : null, record.interrupted === true ? /* @__PURE__ */ React.createElement(CodeBlock, { code: "interrupted", compact: true, tone: "danger" }) : null, !record.interrupted && exitCode ? /* @__PURE__ */ React.createElement(CodeBlock, { code: exitCode, compact: true, tone: "danger" }) : null);
    }
    case "Edit":
    case "NotebookEdit": {
      const record = obj(response);
      if (!record) {
        return null;
      }
      const hunks = parseStructuredPatch(record.structuredPatch);
      return /* @__PURE__ */ React.createElement("div", { className: "space-y-2" }, hunks.length > 0 ? /* @__PURE__ */ React.createElement(UnifiedDiff, { hunks }) : null, str(record.originalFile) ? /* @__PURE__ */ React.createElement(
        CodeBlock,
        {
          code: str(record.originalFile),
          label: "original file",
          maxHeight: "24rem",
          showLineNumbers: true
        }
      ) : null);
    }
    case "Read": {
      if (typeof response === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: response, showLineNumbers: true });
      }
      const record = obj(response);
      return record && typeof record.content === "string" ? /* @__PURE__ */ React.createElement(CodeBlock, { code: record.content, showLineNumbers: true }) : null;
    }
    case "Write": {
      const record = obj(response);
      return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
    }
    case "Grep": {
      const matches = parseGrepMatches(response);
      return matches.length > 0 ? /* @__PURE__ */ React.createElement(MatchList, { matches }) : null;
    }
    case "Glob": {
      const files = parseFileList(response);
      return files.length > 0 ? /* @__PURE__ */ React.createElement(FileList, { paths: files }) : null;
    }
    case "WebFetch": {
      if (typeof response === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: response, showLineNumbers: true });
      }
      const record = obj(response);
      if (!record) {
        return null;
      }
      if (typeof record.content === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: record.content, showLineNumbers: true });
      }
      return /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record });
    }
    case "Task":
    case "Agent": {
      if (typeof response === "string") {
        return /* @__PURE__ */ React.createElement(CodeBlock, { code: response, label: "output", showLineNumbers: true });
      }
      const record = obj(response);
      return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
    }
    case "AskUserQuestion": {
      const record = obj(response);
      return record ? /* @__PURE__ */ React.createElement(KeyValueGrid, { data: record }) : null;
    }
    default:
      return null;
  }
}
export {
  ToolInputView,
  ToolResponseView
};
//# sourceMappingURL=tool-data-view.mjs.map