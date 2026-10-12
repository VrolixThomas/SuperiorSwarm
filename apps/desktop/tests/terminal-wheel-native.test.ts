import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TerminalViewSessions } from "../src/main/terminal/view-sessions";
import { LegacyDaemon } from "./fixtures/legacy-terminal-daemon";

interface Result {
	mode: "normal" | "alternate" | "sgr" | "sgr-pixels" | "legacy-return";
	adapter: boolean;
	sensitivity: number;
	deltaY: number;
	count: number;
	cellHeight: number;
	movement: number;
	text: string[];
	events: Array<{ trusted: boolean; mode: number }>;
	buffer: string;
	mouse: string;
}

test("native Chromium wheel events scroll terminal history and application views", async () => {
	const dir = await mkdtemp(join(tmpdir(), "ss-native-wheel-"));
	let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
	try {
		const daemon = new LegacyDaemon();
		const views = new TerminalViewSessions(daemon);
		let replay = "";
		try {
			await views.create(
				"chat",
				"/tmp",
				() => {},
				() => {}
			);
			daemon.emit(`${"history\r\n".repeat(100)}\x1b[?1049h\x1b[?1003h\x1b[?1006hREADY`);
			daemon.emit("\x1b[?2026h\x1b[24;1Hstatus\x1b[?2026l".repeat(7000));
			views.detach("chat");
			daemon.emit("\x1b[1;1HUpdated while hidden");
			await views.attach(
				"chat",
				(data) => {
					replay = data;
				},
				() => {}
			);
			expect(daemon.raw).not.toContain("\x1b[?1006h");
			await writeFile(join(dir, "legacy-replay.json"), JSON.stringify(replay));
		} finally {
			views.dispose("chat");
		}
		const build = await Bun.build({
			entrypoints: [resolve(import.meta.dir, "fixtures/terminal-wheel-native-browser.ts")],
			outdir: dir,
			target: "browser",
			naming: "wheel.js",
		});
		if (!build.success) throw Error(build.logs.join("\n"));
		await writeFile(
			join(dir, "index.html"),
			`<!doctype html><html><head><link rel="stylesheet" href="${pathToFileURL(require.resolve("@xterm/xterm/css/xterm.css")).href}"></head><body><script src="wheel.js"></script></body></html>`
		);
		const electronDir = dirname(require.resolve("electron/package.json"));
		const executable = (await readFile(join(electronDir, "path.txt"), "utf8")).trim();
		const env = { ...process.env };
		// biome-ignore lint/performance/noDelete: Electron requires absence.
		delete env["ELECTRON_RUN_AS_NODE"];
		child = Bun.spawn(
			[
				join(env["ELECTRON_OVERRIDE_DIST_PATH"] || join(electronDir, "dist"), executable),
				resolve(import.meta.dir, "fixtures/terminal-wheel-native-electron.cjs"),
				dir,
			],
			{ env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
		);
		const deadline = setTimeout(() => child?.kill(), 28000);
		try {
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (code !== 0) throw Error(`${stdout}\n${stderr}`);
			const results = JSON.parse(stdout.trim().split("\n").at(-1) ?? "[]") as Result[];
			expect(results).toHaveLength(25);
			for (const result of results) {
				expect(result.events).toHaveLength(result.count);
				expect(result.events.every((event) => event.trusted && event.mode === 0)).toBe(true);
				if (!result.adapter) continue;
				if (result.mode === "legacy-return") {
					expect(result.buffer).toBe("alternate");
					expect(result.mouse).toBe("any");
				}
				const baseline = results.find(
					(r) =>
						!r.adapter &&
						r.mode === (result.mode === "legacy-return" ? "sgr" : result.mode) &&
						r.deltaY === result.deltaY &&
						r.sensitivity === 3
				);
				if (!baseline) throw Error("Missing xterm baseline");
				if (result.mode === "normal") {
					expect(result.movement).toBeLessThan(0);
					expect(result.movement).toBe(baseline.movement);
				} else {
					const countReports = (r: Result) =>
						r.text
							.join("")
							.split("\x1b")
							.filter((s) => s === "[A" || /^\[<64;\d+;\d+M$/.test(s)).length;
					const expected = Math.trunc(
						(Math.abs(result.deltaY) * result.count * 3) / result.cellHeight
					);
					expect(countReports(result)).toBe(expected);
					expect(countReports(result)).toBeGreaterThan(countReports(baseline));
					const report = baseline.text.join("");
					expect(result.text.join("")).toBe(report.repeat(expected));
					console.log(
						`${result.mode}: ${result.count} × ${result.deltaY}px → ${countReports(baseline)} reports before, ${countReports(result)} after`
					);
				}
			}
		} finally {
			clearTimeout(deadline);
		}
	} finally {
		if (child) {
			child.kill();
			await child.exited;
		}
		await rm(dir, { recursive: true, force: true });
	}
}, 30000);
