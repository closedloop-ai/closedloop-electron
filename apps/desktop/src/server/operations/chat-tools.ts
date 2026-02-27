const MCP_TOOLS = "mcp__closedloop__*";

export const ENGINEER_CHAT_TOOLS = [
  "Bash",
  "Grep",
  "Glob",
  "Read",
  "Edit",
  "Write",
  "Task",
  "TodoWrite",
  "WebSearch",
  "WebFetch",
  MCP_TOOLS
].join(",");

export const READONLY_CODEBASE_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "WebSearch",
  "WebFetch",
  MCP_TOOLS
].join(",");

export const WEB_ONLY_TOOLS = ["WebSearch", "WebFetch", MCP_TOOLS].join(",");

export function withMcpTools(tools: string): string {
  return `${tools},${MCP_TOOLS}`;
}

