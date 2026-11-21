/** Self-contained script installed beside the shell launcher (no runtime packages). */
export const HOOK_BRIDGE_SOURCE = String.raw`
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const producerTimestamp = Date.now();
try {
  const env = process.env;
  if (!env.AGENT_NOTIFY_TOKEN) process.exit(0);
  const terminalId = env.AGENT_NOTIFY_TERMINAL_ID || env.AGENT_NOTIFY_SESSION_ID || "";
  let port = Number(env.AGENT_NOTIFY_PORT);
  if (terminalId) {
    const key = crypto.createHash("sha256").update(env.AGENT_NOTIFY_TOKEN + "\0" + terminalId).digest("hex");
    try {
      const endpoint = JSON.parse(fs.readFileSync(path.join(__dirname, "endpoints", key + ".json"), "utf8"));
      if (Number.isInteger(endpoint.port) && endpoint.port > 0 && endpoint.port <= 65535) port = endpoint.port;
    } catch { /* Legacy terminals can still use their inherited listener port. */ }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(0);
  const input = (process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8").trim()) || process.argv[2] || "";
  const payload = JSON.parse(input);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) process.exit(0);
  const field = (name) => typeof payload[name] === "string" ? payload[name] : "";
  const rawEvent = field("hook_event_name") || field("type");
  // A child hook can carry its parent's session_id. Never classify it as parent work.
  if (!rawEvent || rawEvent.startsWith("Subagent") || field("agent_id")) process.exit(0);
  if (env.AGENT_NOTIFY_AGENT === "codex" && rawEvent === "Stop") process.stdout.write("{}\n");
  const params = new URLSearchParams({
    rawEvent,
    terminalId,
    providerSessionId: field("session_id") || field("sessionID"),
    workspaceId: env.AGENT_NOTIFY_WORKSPACE_ID || "",
    cwd: field("cwd") || process.cwd(),
    agent: env.AGENT_NOTIFY_AGENT || "unknown",
    turnId: field("turn_id") || (env.AGENT_NOTIFY_AGENT === "claude" ? field("prompt_id") : ""),
    sessionSource: field("source"),
    producerTimestamp: String(producerTimestamp),
  });
  const request = http.get({ hostname: "127.0.0.1", port,
    path: "/event?" + params.toString(), headers: { Authorization: "Bearer " + env.AGENT_NOTIFY_TOKEN } },
    (response) => response.resume());
  request.setTimeout(1500, () => request.destroy());
  request.on("error", () => {});
} catch {
  // Hook telemetry must never fail the user's agent turn or print payload/secrets.
}
`;

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export function buildHookLauncher(bridgePath: string, runtimePath: string): string {
	return `#!/bin/bash
# Generated SuperiorSwarm agent lifecycle bridge.
[ -z "$AGENT_NOTIFY_TOKEN" ] && exit 0
ELECTRON_RUN_AS_NODE=1 ${quote(runtimePath)} ${quote(bridgePath)} "$@" 2>/dev/null || true
exit 0
`;
}
