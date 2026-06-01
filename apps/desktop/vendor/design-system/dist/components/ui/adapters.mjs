import {
  messagesToEnvelopes
} from "../../chunk-UGNO5UUO.mjs";
import "../../chunk-LZOMFHX3.mjs";

// components/ui/adapters.ts
function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function asJsonValue(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => asJsonValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, asJsonValue(entry)])
    );
  }
  return String(value);
}
function parseJsonRecord(input) {
  if (!input) {
    return null;
  }
  try {
    return asRecord(JSON.parse(input));
  } catch {
    return null;
  }
}
function basename(path) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
function shortPath(path) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 1) {
    return parts[0] ?? path;
  }
  return parts.slice(-2).join("/");
}
function stringField(record, key) {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
function toolInput(event) {
  return asRecord(parseJsonRecord(event.data)?.tool_input);
}
function toolUseId(event) {
  return stringField(parseJsonRecord(event.data), "tool_use_id");
}
function statusFromEventType(eventType) {
  switch (eventType) {
    case "PreToolUse":
      return "working";
    case "SubagentStop":
    case "Compaction":
      return "completed";
    case "error":
    case "APIError":
      return "error";
    default:
      return "waiting";
  }
}
function formatGroupDuration(durationMs) {
  if (durationMs === null) {
    return void 0;
  }
  if (durationMs < 1e3) {
    return `${durationMs}ms`;
  }
  if (durationMs < 6e4) {
    return `${(durationMs / 1e3).toFixed(1)}s`;
  }
  const minutes = Math.floor(durationMs / 6e4);
  const seconds = Math.floor(durationMs % 6e4 / 1e3);
  return `${minutes}m ${seconds}s`;
}
function projectFromRawEvent(event) {
  const cwd = stringField(parseJsonRecord(event.data), "cwd");
  return cwd ? basename(cwd) : null;
}
function buildEventTitle(event) {
  const input = toolInput(event);
  if (!event.tool_name) {
    return event.summary || event.event_type;
  }
  switch (event.tool_name) {
    case "Read": {
      const filePath = stringField(input, "file_path");
      return filePath ? `Read \xB7 ${shortPath(filePath)}` : "Read";
    }
    case "Write": {
      const filePath = stringField(input, "file_path");
      return filePath ? `Write \xB7 ${shortPath(filePath)}` : "Write";
    }
    case "Edit":
    case "NotebookEdit": {
      const filePath = stringField(input, "file_path");
      return filePath ? `${event.tool_name} \xB7 ${shortPath(filePath)}` : event.tool_name;
    }
    case "Grep": {
      const pattern = stringField(input, "pattern");
      const path = stringField(input, "path");
      if (!pattern) {
        return "Grep";
      }
      return path ? `Grep \xB7 "${pattern}" in ${basename(path)}` : `Grep \xB7 "${pattern}"`;
    }
    case "Glob": {
      const pattern = stringField(input, "pattern");
      return pattern ? `Glob \xB7 "${pattern}"` : "Glob";
    }
    case "WebFetch": {
      const url = stringField(input, "url");
      if (!url) {
        return "WebFetch";
      }
      try {
        return `WebFetch \xB7 ${new URL(url).host}`;
      } catch {
        return `WebFetch \xB7 ${url}`;
      }
    }
    case "Bash":
    case "PowerShell": {
      const command = stringField(input, "command");
      return command ? `${event.tool_name} \xB7 ${command}` : event.tool_name;
    }
    default: {
      if (event.tool_name.startsWith("mcp__")) {
        return event.tool_name.replaceAll("__", " \xB7 ").replace(/^mcp · /, "MCP \xB7 ");
      }
      return event.summary ? `${event.tool_name} \xB7 ${event.summary}` : event.tool_name;
    }
  }
}
function buildEventDetailFromRawEvent(event) {
  const parsed = parseJsonRecord(event.data);
  if (!parsed && !event.data) {
    return null;
  }
  const fields = [];
  if (parsed) {
    for (const [key, value] of Object.entries(parsed)) {
      fields.push({
        key,
        label: key.replaceAll("_", " "),
        value: asJsonValue(value)
      });
    }
  } else if (event.data) {
    fields.push({
      key: "data",
      label: "raw data",
      value: event.data
    });
  }
  const bullets = [
    event.tool_name ? `Tool: ${event.tool_name}` : null,
    event.summary ? event.summary : null,
    toolUseId(event) ? `Grouped by ${toolUseId(event)}` : null
  ].filter((value) => Boolean(value));
  return {
    summary: {
      headline: buildEventTitle(event),
      bullets
    },
    fields
  };
}
function adaptRawDashboardEvent(event) {
  return {
    id: String(event.id),
    sessionId: event.session_id,
    agentId: event.agent_id,
    eventType: event.event_type,
    status: statusFromEventType(event.event_type),
    toolName: event.tool_name,
    title: buildEventTitle(event),
    summary: event.summary,
    createdAt: event.created_at,
    rawData: event.data,
    project: projectFromRawEvent(event),
    detail: buildEventDetailFromRawEvent(event) ?? void 0
  };
}
function adaptGroupedRawDashboardEvents(events) {
  const groups = /* @__PURE__ */ new Map();
  for (const event of events) {
    const key = toolUseId(event) ?? `single:${event.id}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(event);
    } else {
      groups.set(key, [event]);
    }
  }
  return Array.from(groups.entries()).map(([key, grouped]) => {
    const sorted = [...grouped].sort(
      (left, right) => left.created_at.localeCompare(right.created_at)
    );
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const durationMs = sorted.length > 1 ? Math.max(
      0,
      new Date(last.created_at).getTime() - new Date(first.created_at).getTime()
    ) : null;
    return {
      id: key,
      title: buildEventTitle(first),
      durationLabel: formatGroupDuration(durationMs),
      events: sorted.map((event) => adaptRawDashboardEvent(event))
    };
  }).sort(
    (left, right) => right.events[0].createdAt.localeCompare(left.events[0].createdAt)
  );
}
function adaptRawTranscriptMessages(messages, author = "Assistant") {
  return messages.map((message, index) => ({
    id: `${message.type}-${index}-${message.timestamp ?? "unknown"}`,
    role: message.type,
    author: message.type === "user" ? "You" : author,
    createdAt: message.timestamp ?? (/* @__PURE__ */ new Date()).toISOString(),
    content: message.content.map((block) => block.text ?? block.name ?? block.output ?? "").filter(Boolean).join("\n"),
    model: message.model,
    usage: message.usage ? {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens
    } : null,
    blocks: message.content.map((block) => {
      if (block.type === "tool_use") {
        return {
          type: "tool_use",
          id: block.id || `tool-use-${index}`,
          name: block.name || "tool",
          input: asJsonValue(block.input || {})
        };
      }
      if (block.type === "tool_result") {
        return {
          type: "tool_result",
          id: block.id || `tool-result-${index}`,
          output: asJsonValue(block.output || ""),
          isError: block.is_error
        };
      }
      if (block.type === "thinking") {
        return {
          type: "thinking",
          text: block.text || ""
        };
      }
      return {
        type: "text",
        text: block.text || ""
      };
    })
  }));
}
function adaptRawTranscriptToEnvelopes(messages, author) {
  return messagesToEnvelopes(adaptRawTranscriptMessages(messages, author));
}
export {
  adaptGroupedRawDashboardEvents,
  adaptRawDashboardEvent,
  adaptRawTranscriptMessages,
  adaptRawTranscriptToEnvelopes,
  buildEventDetailFromRawEvent,
  buildEventTitle,
  formatGroupDuration,
  projectFromRawEvent,
  statusFromEventType
};
//# sourceMappingURL=adapters.mjs.map