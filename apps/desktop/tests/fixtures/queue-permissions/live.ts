// Real CLI protocol probe. Native Node HTTP and synthetic MCP operation, no TUI/GUI claim.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { claudeConfig } from "../../../src/main/agent-hooks/agents/claude";
import { codexConfig } from "../../../src/main/agent-hooks/agents/codex";
import { HOOK_BRIDGE_SOURCE } from "../../../src/main/agent-hooks/bridge";
import { createAlertListener } from "../../../src/main/agent-hooks/listener";
import { QueuePermissions } from "../../../src/main/agent-hooks/queue-permissions";
import type { WorkspaceQueueItem } from "../../../src/shared/activity-queue";
import { agentRegistry } from "../../../src/shared/agent-events";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const root = mkdtempSync(join(tmpdir(), "ss-live-permissions-"));
console.log(JSON.stringify({ root }));
const results: unknown[] = [];
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const baseEnv = Object.fromEntries(
	Object.entries(process.env).filter(
		([key]) => !/^(SUPERIORSWARM_|AGENT_NOTIFY_|CLAUDECODE$)/.test(key)
	)
);
writeFileSync(join(root, "bridge.cjs"), HOOK_BRIDGE_SOURCE);
writeFileSync(
	join(root, "mcp.cjs"),
	`const fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{try{const r=JSON.parse(line);if(r.id===undefined)return;let result;if(r.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'queue-permission-fixture',version:'1'}};else if(r.method==='tools/list')result={tools:[{name:'fixture_permission',description:'Perform the exact authorized synthetic marker operation once.',inputSchema:{type:'object',properties:{description:{type:'string',enum:['Write QUEUE_FIXTURE_ONCE marker to temporary fixture file']}},required:['description'],additionalProperties:false}}]};else if(r.method==='tools/call'){if(r.params.name!=='fixture_permission'||JSON.stringify(r.params.arguments)!==JSON.stringify({description:'Write QUEUE_FIXTURE_ONCE marker to temporary fixture file'}))throw Error('Unexpected operation');fs.writeFileSync(process.env.FIXTURE_MARKER,'executed',{flag:'wx'});result={content:[{type:'text',text:'QUEUE_FIXTURE_EXECUTED'}]};}else result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(line).id,error:{code:-32602,message:'Exact synthetic arguments required'}})+'\\n');}});`
);

const toml = (value: unknown): string =>
	typeof value === "string"
		? JSON.stringify(value)
		: typeof value === "boolean"
			? String(value)
			: typeof value === "number"
				? String(value)
				: Array.isArray(value)
					? `[${value.map(toml).join(",")}]`
					: `{${Object.entries(value as object)
							.map(([key, v]) => `${JSON.stringify(key)}=${toml(v)}`)
							.join(",")}}`;
async function codexTrust(cwd: string, events: Record<string, unknown>, env: NodeJS.ProcessEnv) {
	// Read-only installed protocol catalog. Trust only the exact fixture definitions, invocation-local.
	const child = spawn("codex", ["app-server", "--stdio", "-c", `hooks=${toml(events)}`], {
		cwd,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let next = 0;
	const pending = new Map<number, { resolve: (v: any) => void; reject: (v: any) => void }>();
	const rpc = (method: string, params: unknown) =>
		new Promise<any>((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	createInterface({ input: child.stdout }).on("line", (line) => {
		try {
			const v = JSON.parse(line);
			const p = pending.get(v.id);
			if (p) {
				pending.delete(v.id);
				v.error ? p.reject(v.error) : p.resolve(v.result);
			}
		} catch {}
	});
	const timer = setTimeout(() => child.kill(), 15000);
	try {
		await rpc("initialize", {
			clientInfo: { name: "queue_permission_fixture", version: "1" },
			capabilities: { experimentalApi: true },
		});
		const list = await rpc("hooks/list", { cwds: [cwd] });
		writeFileSync(join(root, "hook-catalog.json"), JSON.stringify(list, null, 2));
		const hooks = list.data
			.flatMap((v: any) => v.hooks)
			.filter((v: any) => v.command?.includes(join(root, "bridge.cjs")));
		assert.ok(hooks.length > 0);
		return Object.fromEntries(
			hooks.map((h: any) => [h.key, { enabled: true, trusted_hash: h.currentHash }])
		);
	} finally {
		clearTimeout(timer);
		child.kill();
	}
}
for (const provider of (process.env["SS_PERMISSION_PROVIDERS"] ?? "claude").split(","))
	for (const action of (
		process.env["SS_PERMISSION_ACTIONS"] ?? "allow-once,deny,open,timeout"
	).split(",")) {
		const cwd = join(root, `${provider}-${action}`);
		mkdirSync(cwd);
		const marker = join(cwd, "marker");
		const token = randomUUID();
		const session = randomUUID();
		const terminal = randomUUID();
		const target = {
			type: "terminal" as const,
			entity: { kind: "workspace" as const, id: "fixture" },
			workspaceId: "fixture",
			terminalId: terminal,
			provider,
			providerSessionId: session,
		};
		let generation: string | null = "g";
		const service = new QueuePermissions({
			currentGeneration: () => generation,
			timeoutMs: action === "timeout" ? 250 : 30_000,
		});
		agentRegistry.set(provider, provider === "claude" ? claudeConfig : codexConfig);
		let item: WorkspaceQueueItem | undefined;
		const events: unknown[] = [];
		const listener = createAlertListener(0, token, {
			service,
			resolve: (event) => ({
				target: { ...target, providerSessionId: event.providerSessionId },
				generation: "g",
			}),
		});
		listener.onEvent((event) => {
			events.push({
				event: event.rawEvent,
				session: event.providerSessionId,
				turn: event.turnId,
				request: event.permission?.requestId,
			});
			if (event.rawEvent === "PermissionRequest")
				item = {
					id: "source",
					revision: 1,
					target: { ...target, providerSessionId: event.providerSessionId },
					permission: event.permission,
					situation: "agent-permission",
					stale: false,
				} as WorkspaceQueueItem;
		});
		await listener.start();
		let proxy: ReturnType<typeof createServer> | undefined;
		let port = listener.getPort();
		if (action === "loss") {
			proxy = createServer((req, res) => {
				const upstream = httpRequest(
					{
						hostname: "127.0.0.1",
						port: listener.getPort()!,
						path: req.url,
						method: req.method,
						headers: req.headers,
					},
					(response) => {
						let body = "";
						response.on("data", (d) => {
							body += String(d);
						});
						response.on("end", () => {
							if (body.includes('"behavior":"allow"')) res.destroy();
							else {
								res.writeHead(response.statusCode ?? 500);
								res.end(body);
							}
						});
					}
				);
				upstream.on("error", () => res.destroy());
				req.pipe(upstream);
			});
			await new Promise<void>((resolve) => proxy!.listen(0, "127.0.0.1", resolve));
			port = (proxy.address() as { port: number }).port;
		}
		mkdirSync(join(root, "endpoints"), { recursive: true });
		writeFileSync(
			join(
				root,
				"endpoints",
				`${createHash("sha256").update(`${token}\0${terminal}`).digest("hex")}.json`
			),
			JSON.stringify({ port, permissionResponse: 1 })
		);
		const hookCommand = [process.execPath, join(root, "bridge.cjs")].map(quote).join(" ");
		const hookEvents = Object.fromEntries(
			["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop"].map((event) => [
				event,
				[{ hooks: [{ type: "command", command: hookCommand, timeout: 35 }] }],
			])
		);
		writeFileSync(join(cwd, "settings.json"), JSON.stringify({ hooks: hookEvents }));
		const mcp = {
			command: process.execPath,
			args: [join(root, "mcp.cjs")],
			env: { FIXTURE_MARKER: marker },
		};
		const env = {
			...baseEnv,
			AGENT_NOTIFY_AGENT: provider,
			AGENT_NOTIFY_TOKEN: token,
			AGENT_NOTIFY_PORT: String(listener.getPort()),
			AGENT_NOTIFY_TERMINAL_ID: terminal,
			AGENT_NOTIFY_WORKSPACE_ID: "fixture",
		};
		const prompt =
			'This is a synthetic permission protocol test. Call queue_fixture fixture_permission exactly once with arguments exactly {"description":"Write QUEUE_FIXTURE_ONCE marker to temporary fixture file"}. Do not use any other tool or retry a denied call. If denied or unavailable, say BLOCKED and end. If it succeeds, say EXECUTED and end.';
		let args: string[];
		if (provider === "claude")
			args = [
				"-p",
				"--setting-sources",
				"",
				"--settings",
				join(cwd, "settings.json"),
				"--strict-mcp-config",
				"--mcp-config",
				JSON.stringify({ mcpServers: { queue_fixture: mcp } }),
				"--tools",
				"",
				"--disable-slash-commands",
				"--no-session-persistence",
				"--session-id",
				session,
				"--output-format",
				"json",
				prompt,
			];
		else {
			// TOML inline tables are serialized by the wrapper before this fixture runs.
			// hooks/list must see valid TOML, same declaration as the CLI invocation.
			mkdirSync(join(cwd, ".codex"));
			writeFileSync(join(cwd, ".codex", "hooks.json"), JSON.stringify({ hooks: hookEvents }));
			const trust = await codexTrust(cwd, hookEvents, env);
			args = [
				"exec",
				"--ignore-user-config",
				"--ignore-rules",
				"--skip-git-repo-check",
				"--sandbox",
				"read-only",
				"-c",
				`hooks=${toml({ ...hookEvents, state: trust })}`,
				"-c",
				`mcp_servers=${toml({ queue_fixture: { ...mcp, required: true, enabled_tools: ["fixture_permission"] } })}`,
				"--json",
				prompt,
			];
		}
		const child = spawn(provider, args, {
			cwd,
			env,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (d) => {
			output += d;
		});
		child.stderr.on("data", (d) => {
			output += d;
		});
		const finished = new Promise<void>((r) => child.on("exit", () => r()));
		let exited = false;
		void finished.then(() => {
			exited = true;
		});
		const stop = () => {
			if (!exited && child.pid)
				try {
					process.kill(-child.pid, "SIGTERM");
				} catch {}
		};
		const timeout = setTimeout(stop, 60_000);
		try {
			for (let i = 0; i < 500 && !item && !exited; i++) await sleep(action === "loss" ? 2200 : 350);
			assert.ok(item, `No PermissionRequest ${provider} ${action}: ${output.slice(-1200)}`);
			const current = item;
			assert.equal(service.capability(current).capability, "hook-response");
			let decision: unknown = null;
			if (action === "stale") generation = "replaced";
			if (action === "cancel") stop();
			else if (action !== "timeout")
				decision = service.decide(
					{
						id: current.id,
						revision: current.revision,
						requestId: current.permission?.requestId ?? "",
						action: ["stale", "loss"].includes(action)
							? "allow-once"
							: (action as "allow-once" | "deny" | "open"),
					},
					current
				);
			await finished;
			await sleep(action === "loss" ? 2200 : 350);
			assert.equal(
				existsSync(marker),
				action === "allow-once",
				`${provider} ${action} actual operation`
			);
			if (action === "cancel") assert.equal(service.capability(current).state, "cancelled");
			if (action === "stale") assert.equal((decision as { status: string }).status, "conflict");
			if (action === "loss") assert.equal(service.capability(current).state, "uncertain");
			const result = {
				provider,
				action,
				actualOperation: existsSync(marker),
				decision,
				receipt: service.capability(current).state,
				events,
			};
			results.push(result);
			console.log(JSON.stringify(result));
		} finally {
			clearTimeout(timeout);
			stop();
			listener.stop();
			proxy?.close();
			writeFileSync(join(cwd, "cli-output.txt"), output);
			writeFileSync(join(root, "results.json"), JSON.stringify(results, null, 2));
		}
	}
