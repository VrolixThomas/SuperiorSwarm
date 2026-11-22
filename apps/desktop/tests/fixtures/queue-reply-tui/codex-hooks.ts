import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import TOML from "@iarna/toml";
/** Read-only catalog; trust is returned for invocation-local exact synthetic hook definitions only. */
export async function codexHookTrust(
	binary: string,
	cwd: string,
	events: Record<string, Parameters<typeof TOML.stringify.value>[0]>,
	env: NodeJS.ProcessEnv,
	expectedCommand: string
) {
	const child = spawn(
		binary,
		[
			"--no-daemon",
			"-c",
			`hooks=${TOML.stringify.value(events)}`,
			"-c",
			`projects=${TOML.stringify.value({ [cwd]: { trust_level: "trusted" } })}`,
			"-c",
			"mcp_servers={}",
			"app-server",
			"--stdio",
		],
		{ cwd, env, stdio: ["pipe", "pipe", "pipe"] }
	);
	let next = 0;
	const pending = new Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: unknown) => void }
	>();
	const rpc = (method: string, params: unknown) =>
		new Promise<unknown>((resolve, reject) => {
			const id = ++next;
			pending.set(id, { resolve, reject });
			child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
		});
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		try {
			const value = JSON.parse(line);
			const request = pending.get(value.id);
			if (request) {
				pending.delete(value.id);
				value.error ? request.reject(value.error) : request.resolve(value.result);
			}
		} catch {}
	});
	child.stderr.resume();
	const timer = setTimeout(() => {
		for (const request of pending.values()) request.reject(Error("Hook catalog timed out"));
		child.kill();
	}, 15000);
	try {
		await rpc("initialize", {
			clientInfo: { name: "queue_reply_fixture", version: "1" },
			capabilities: { experimentalApi: true },
		});
		const result = (await rpc("hooks/list", { cwds: [cwd] })) as {
			data: { hooks: { key: string; command?: string; currentHash: string }[] }[];
		};
		const hooks = result.data.flatMap((row) => row.hooks);
		assert.equal(hooks.length, 4, "Isolated fixture must expose only its four reviewed hooks");
		assert(hooks.every((hook) => hook.command === expectedCommand));
		const state: Record<string, Record<string, boolean | string>> = {};
		for (const hook of hooks) {
			if (hook.command === expectedCommand) {
				state[hook.key] = { enabled: true, trusted_hash: hook.currentHash };
			} else {
				state[hook.key] = { enabled: false };
			}
		}
		return state;
	} finally {
		clearTimeout(timer);
		lines.close();
		child.kill();
	}
}
