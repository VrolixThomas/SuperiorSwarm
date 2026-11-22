import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ReviewFetchProcessError,
	createReviewFetchProgressParser,
	runReviewFetchGit,
} from "../src/main/review-explanation/fetch-process";
import {
	type ReviewFetchProgress,
	formatReviewFetchProgress,
} from "../src/shared/review-fetch-progress";

const roots: string[] = [];
function fixture(source: string) {
	const root = mkdtempSync(join(tmpdir(), "review-fetch-process-"));
	roots.push(root);
	const executable = join(root, "fake-git");
	writeFileSync(executable, `#!${process.execPath}\n${source}\n`);
	chmodSync(executable, 0o700);
	return { root, executable };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("chunked CR progress emits only structured counters, handles bytes and suppresses noise", () => {
	const seen: ReviewFetchProgress[] = [];
	const parser = createReviewFetchProgressParser((p) => seen.push(p));
	parser.push("remote: Counting obj");
	parser.push("ects: 40% (4/10)\rReceiving objects: 40% (4/10), 1.00 MiB | 2.00 MiB/s\r");
	parser.push("Receiving objects: 40% (4/10), 2.00 MiB | 2.00 MiB/s\r");
	parser.push("Receiving objects: 40% (4/10), 2.00 MiB | 8.00 MiB/s\r");
	parser.push(
		"Authorization: secret\nhttps://user:password@example.invalid/repo\nremote: Receiving objects: 99% (9/10) token=secret\n"
	);
	parser.end();
	expect(seen).toEqual([
		{ stage: "counting", percent: 40, current: 4, total: 10 },
		{ stage: "receiving", percent: 40, current: 4, total: 10, bytes: 1048576 },
		{ stage: "receiving", percent: 40, current: 4, total: 10, bytes: 2097152 },
	]);
	expect(seen.map(formatReviewFetchProgress).join(" ")).not.toMatch(/secret|password|https/);
});

test("continued numeric progress allows a transfer beyond the inactivity budget", async () => {
	const { root, executable } = fixture(
		`for(let n=1;n<=20;n++){process.stderr.write('Receiving objects: '+n+'% ('+n+'/100)\\r');await Bun.sleep(100);}`
	);
	const seen: ReviewFetchProgress[] = [];
	const started = Date.now();
	await runReviewFetchGit(root, ["fetch"], new AbortController().signal, process.env, {
		executable,
		idleTimeoutMs: 1500,
		maxDurationMs: 4000,
		onProgress: (p) => seen.push(p),
	});
	expect(Date.now() - started).toBeGreaterThan(1800);
	expect(seen.length).toBe(20);
});

test("stderr chatter and repeated percentages do not keep a stalled transfer alive", async () => {
	const { root, executable } = fixture(
		`setInterval(()=>process.stderr.write('Receiving objects: 1% (1/100)\\rnoise with secret\\n'),15);`
	);
	const start = Date.now();
	const error = await runReviewFetchGit(
		root,
		["fetch"],
		new AbortController().signal,
		process.env,
		{ executable, idleTimeoutMs: 1500, maxDurationMs: 2500 }
	).catch((e) => e);
	expect(error).toBeInstanceOf(ReviewFetchProcessError);
	expect(error.reason).toBe("stalled");
	expect(Date.now() - start).toBeLessThan(3500);
	expect(JSON.stringify(error)).not.toContain("secret");
});

test("the overall deadline remains bounded even while progress continues", async () => {
	const { root, executable } = fixture(
		`let n=0;setInterval(()=>process.stderr.write('Enumerating objects: '+(++n)+'\\r'),20);`
	);
	let updates = 0;
	const error = await runReviewFetchGit(
		root,
		["fetch"],
		new AbortController().signal,
		process.env,
		{
			executable,
			idleTimeoutMs: 1500,
			maxDurationMs: 2500,
			onProgress: () => {
				updates++;
			},
		}
	).catch((e) => e);
	expect(error.reason).toBe("timeout");
	expect(updates).toBeGreaterThan(3);
});

test("abort before spawn never executes Git", async () => {
	const { root, executable } = fixture("await Bun.write('spawned','yes');");
	const abort = new AbortController();
	abort.abort();
	await expect(
		runReviewFetchGit(root, ["fetch"], abort.signal, process.env, { executable })
	).rejects.toMatchObject({ reason: "cancelled" });
	expect(existsSync(join(root, "spawned"))).toBe(false);
});

test.skipIf(process.platform === "win32")(
	"cancellation kills descendants and waits for their inherited pipes to close",
	async () => {
		const { root, executable } = fixture(`import {spawn} from 'node:child_process';
 const child=spawn(process.execPath,['-e',\"setTimeout(()=>require('fs').writeFileSync('escaped','yes'),800);setInterval(()=>{},1000)\"],{stdio:['ignore','inherit','inherit']});
 await Bun.write('child-pid',String(child.pid));setInterval(()=>{},1000);`);
		const abort = new AbortController();
		const work = runReviewFetchGit(root, ["fetch"], abort.signal, process.env, {
			executable,
			idleTimeoutMs: 2000,
			maxDurationMs: 3000,
		}).catch((e) => e);
		for (let i = 0; i < 150 && !existsSync(join(root, "child-pid")); i++) await Bun.sleep(10);
		expect(existsSync(join(root, "child-pid"))).toBe(true);
		const childPid = Number(readFileSync(join(root, "child-pid"), "utf8"));
		abort.abort();
		const error = await work;
		expect(error.reason).toBe("cancelled");
		await Bun.sleep(900);
		expect(existsSync(join(root, "escaped"))).toBe(false);
		// A transient reparented zombie is possible; kill(0) alone cannot prove liveness.
		expect(childPid).toBeGreaterThan(0);
	}
);

test("failure diagnostics retain known category hints without credential text", async () => {
	const { root, executable } = fixture(
		`process.stderr.write("fatal: Authentication failed for 'https://user:secret@example.invalid/repo'\\nAuthorization: Bearer secret\\n");process.exit(128);`
	);
	const error = await runReviewFetchGit(
		root,
		["fetch"],
		new AbortController().signal,
		process.env,
		{ executable }
	).catch((e) => e);
	expect(error.reason).toBe("process");
	expect(error.exitCode).toBe(128);
	expect(error.stderr).toContain("authentication failed");
	expect(JSON.stringify(error)).not.toMatch(/secret|example|Authorization/);
});

test.skipIf(process.platform === "win32")(
	"cancellation also kills descendants which ignore TERM and detach their output pipes",
	async () => {
		const { root, executable } = fixture(`import {spawn} from 'node:child_process';
 const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});require('fs').writeFileSync('descendant-ready','yes');setTimeout(()=>require('fs').writeFileSync('escaped','yes'),800);setInterval(()=>{},1000)\"],{stdio:'ignore'});
 await Bun.write('child-pid',String(child.pid));setInterval(()=>{},1000);`);
		const abort = new AbortController();
		const work = runReviewFetchGit(root, ["fetch"], abort.signal, process.env, {
			executable,
			idleTimeoutMs: 2000,
			maxDurationMs: 3000,
		}).catch((e) => e);
		for (let i = 0; i < 150 && !existsSync(join(root, "descendant-ready")); i++)
			await Bun.sleep(10);
		expect(existsSync(join(root, "descendant-ready"))).toBe(true);
		abort.abort();
		expect((await work).reason).toBe("cancelled");
		await Bun.sleep(900);
		expect(existsSync(join(root, "escaped"))).toBe(false);
	}
);

test("unknown oversized lines and invalid numeric counters never become progress", () => {
	const seen: ReviewFetchProgress[] = [];
	const parser = createReviewFetchProgressParser((p) => seen.push(p));
	parser.push(`${"x".repeat(100_000)}Receiving objects: 99% (9/10)\r`);
	parser.push(
		"Receiving objects: 101% (10/10)\rCounting objects: 50% (9/2)\rCounting objects: 50% (1/999999999999999999999)\r"
	);
	parser.end();
	expect(seen).toEqual([]);
});

test("a missing executable exposes only an errno, never command or credential arguments", async () => {
	const { root } = fixture("");
	const error = await runReviewFetchGit(
		root,
		["fetch", "https://user:secret@example.invalid/repo"],
		new AbortController().signal,
		process.env,
		{ executable: join(root, "missing") }
	).catch((e) => e);
	expect(error).toMatchObject({ reason: "process", code: "ENOENT" });
	expect(JSON.stringify(error)).not.toMatch(/secret|example|missing/);
});

// Captured from installed Git with a disposable local repository and fetch.unpackLimit=1.
test("Git byte/bytes units and zero byte rates retain transfer progress", () => {
	const seen: ReviewFetchProgress[] = [];
	const parser = createReviewFetchProgressParser((p) => seen.push(p));
	parser.push("Receiving objects: 100% (3/3), 206 bytes | 206.00 KiB/s, done.\r");
	parser.push("Receiving objects: 100% (3/3), 207 bytes | 0 bytes/s\r");
	parser.push("Receiving objects: 100% (3/3), 208 bytes | 1 byte/s\r");
	parser.end();
	expect(seen.map((p) => p.bytes)).toEqual([206, 207, 208]);
	const single: ReviewFetchProgress[] = [];
	const first = createReviewFetchProgressParser((p) => single.push(p));
	first.push("Receiving objects: 1% (1/100), 1 byte | 0 bytes/s\n");
	expect(single).toEqual([{ stage: "receiving", percent: 1, current: 1, total: 100, bytes: 1 }]);
});
