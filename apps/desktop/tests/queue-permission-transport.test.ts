import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("native Node HTTP and real bridge subprocess: both provider stand-ins, allow/deny/Open/timeout/cancel", async () => {
	const root = mkdtempSync(join(tmpdir(), "ss-native-permissions-"));
	try {
		const build = Bun.spawn(
			[
				process.execPath,
				resolve(import.meta.dir, "fixtures/queue-permissions/build.ts"),
				resolve(import.meta.dir, "fixtures/queue-permissions/transport.ts"),
				root,
			],
			{ stdout: "pipe", stderr: "pipe" }
		);
		const [buildError, buildCode] = await Promise.all([
			new Response(build.stderr).text(),
			build.exited,
		]);
		expect({ buildCode, buildError }).toEqual({ buildCode: 0, buildError: "" });
		const child = Bun.spawn(["node", join(root, "transport.js")], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [output, error, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect({ code, error }).toEqual({ code: 0, error: "" });
		expect(JSON.parse(output).passed).toHaveLength(10);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}, 10000);
