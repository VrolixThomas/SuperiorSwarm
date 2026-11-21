import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test.skipIf(process.env["SS_PERMISSION_LIVE"] !== "1")(
	"real Claude/Codex PermissionRequest protocol: exact synthetic operation and cancellation/loss",
	async () => {
		const root = mkdtempSync(join(tmpdir(), "ss-permission-live-build-"));
		const build = Bun.spawn(
			[
				process.execPath,
				resolve(import.meta.dir, "fixtures/queue-permissions/build.ts"),
				resolve(import.meta.dir, "fixtures/queue-permissions/live.ts"),
				root,
			],
			{ stdout: "pipe", stderr: "pipe" }
		);
		const [buildError, buildCode] = await Promise.all([
			new Response(build.stderr).text(),
			build.exited,
		]);
		expect({ buildCode, buildError }).toEqual({ buildCode: 0, buildError: "" });
		const child = Bun.spawn(["node", join(root, "live.js")], {
			env: {
				...process.env,
				SS_PERMISSION_PROVIDERS: process.env["SS_PERMISSION_PROVIDERS"] ?? "claude,codex",
				SS_PERMISSION_ACTIONS:
					process.env["SS_PERMISSION_ACTIONS"] ?? "allow-once,deny,open,timeout,cancel,stale,loss",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [output, error, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		console.log(output);
		expect({ code, error }).toEqual({ code: 0, error: "" });
	},
	240000
);
