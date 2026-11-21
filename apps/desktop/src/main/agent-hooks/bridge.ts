import { admitAgentEvidence } from "../../shared/agent-evidence";
import { permissionActionSummary } from "../../shared/queue-permission-summary";
import {
	findPermissionProviderProcess,
	inspectPermissionProcess,
	permissionProcessAlive,
} from "./permission-process";

/** Self-contained script installed beside the shell launcher (no runtime packages). */
export const HOOK_BRIDGE_SOURCE = String.raw`
const http = require("node:http");
const {execFileSync} = require("node:child_process");
const inspectPermissionProcess = ${inspectPermissionProcess.toString()};
const findPermissionProviderProcess = ${findPermissionProviderProcess.toString()};
const permissionProcessAlive = ${permissionProcessAlive.toString()};
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const producerTimestamp = Date.now();
const admitAgentEvidence = ${admitAgentEvidence.toString()};
const permissionActionSummary = ${permissionActionSummary.toString()};
try {
  const env = process.env;
  if (!env.AGENT_NOTIFY_TOKEN) process.exit(0);
  const terminalId = env.AGENT_NOTIFY_TERMINAL_ID || env.AGENT_NOTIFY_SESSION_ID || "";
  let port = Number(env.AGENT_NOTIFY_PORT);
  let permissionResponse = false;
  if (terminalId) {
    const key = crypto.createHash("sha256").update(env.AGENT_NOTIFY_TOKEN + "\0" + terminalId).digest("hex");
    try {
      const endpoint = JSON.parse(fs.readFileSync(path.join(__dirname, "endpoints", key + ".json"), "utf8"));
      permissionResponse = endpoint.permissionResponse === 1;
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
  const providerProcess = permissionResponse && rawEvent === "PermissionRequest" ? findPermissionProviderProcess(env.AGENT_NOTIFY_AGENT) : null;
  const permissionRequest = !!providerProcess && permissionResponse && rawEvent === "PermissionRequest" && ["claude", "codex"].includes(env.AGENT_NOTIFY_AGENT);
  const requestId = permissionRequest ? crypto.randomUUID() : undefined;
  const action = permissionRequest ? permissionActionSummary(payload) : null;
  const params = {
    permissionResponse: permissionRequest ? 1 : undefined,
    providerProcess: permissionRequest ? providerProcess : undefined,
    actionSummary: action?.text,
    actionReviewable: action?.reviewable,
    rawEvent,
    launchId: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(env.AGENT_NOTIFY_LAUNCH_ID || "") ? env.AGENT_NOTIFY_LAUNCH_ID.toLowerCase() : undefined,
    terminalId,
    providerSessionId: field("session_id") || field("sessionID"),
    workspaceId: env.AGENT_NOTIFY_WORKSPACE_ID || "",
    cwd: field("cwd") || process.cwd(),
    agent: env.AGENT_NOTIFY_AGENT || "unknown",
    turnId: field("turn_id") || (env.AGENT_NOTIFY_AGENT === "claude" ? field("prompt_id") : ""),
    sessionSource: field("source"),
    producerTimestamp: String(producerTimestamp),
    providerEventId: field("event_id"),
    promptHash: rawEvent === "UserPromptSubmit" && typeof payload.prompt === "string" && Buffer.byteLength(payload.prompt, "utf8") <= 56000 ? crypto.createHash("sha256").update(payload.prompt).digest("hex") : undefined,
    providerTimestamp: typeof payload.event_timestamp === "number" ? String(payload.event_timestamp) : "",
    evidence: admitAgentEvidence(payload, env.AGENT_NOTIFY_AGENT || "unknown", rawEvent),
    permission: rawEvent === "PermissionRequest" ? {
      requestId: requestId || field("permission_request_id") || field("tool_use_id") || undefined,
      outcome: "pending",
    } : undefined,
  };
  const body = JSON.stringify(params);
  const request = http.request({ method: "POST", hostname: "127.0.0.1", port,
    path: "/event", headers: { Authorization: "Bearer " + env.AGENT_NOTIFY_TOKEN, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
    (response) => {
      if (!permissionRequest || response.statusCode !== 200) { response.resume(); return; }
      let received = "";
      response.on("data", chunk => { received += chunk; if (received.length > 2048) response.destroy(); });
      response.on("error", () => {});
      response.on("end", () => {
        try {
          const value = JSON.parse(received);
          if (!permissionProcessAlive(providerProcess) || Date.now() - producerTimestamp > 31000 || value.requestId !== requestId || !["allow", "deny"].includes(value.behavior) || typeof value.receipt !== "string") return;
          const output = {hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:value.behavior,...(value.behavior === "deny" ? {message:"Denied for this request in SuperiorSwarm Queue."} : {})}}};
          process.stdout.write(JSON.stringify(output) + "\n", error => {
            if (error) return;
            const receiptBody = JSON.stringify({requestId,receipt:value.receipt});
            const ack = http.request({method:"POST",hostname:"127.0.0.1",port,path:"/permission-receipt",headers:{Authorization:"Bearer " + env.AGENT_NOTIFY_TOKEN,"Content-Type":"application/json","Content-Length":Buffer.byteLength(receiptBody)}}, res => res.resume());
            ack.setTimeout(1000, () => ack.destroy()); ack.on("error",()=>{}); ack.end(receiptBody);
          });
        } catch { /* Empty/legacy/lost response leaves normal provider approval flow. */ }
      });
    });
  if (permissionRequest) {
    const watchdog = setInterval(() => { if (!permissionProcessAlive(providerProcess)) { request.destroy(); process.exit(0); } }, 250);
    watchdog.unref();
    request.on("close", () => clearInterval(watchdog));
  }
  request.setTimeout(permissionRequest ? 32000 : 1500, () => request.destroy());
  request.on("error", () => {});
  request.end(body);
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
