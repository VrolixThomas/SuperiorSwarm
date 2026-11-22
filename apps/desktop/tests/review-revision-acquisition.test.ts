import { afterEach, beforeEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ReviewRevisionAcquisition,
	canonicalBitbucketHttpsRemote,
	fetchRevisionObjects,
	revisionRemoteRepository,
} from "../src/main/review-explanation/revision-acquisition";
import { ReviewSnapshotService } from "../src/main/review-explanation/snapshot";
import type { ReviewSnapshotRevision } from "../src/shared/review-snapshot-types";
import { fixtureGitEnv, snapshotFixture } from "./helpers/review-snapshot-fixture";

let fixture: ReturnType<typeof snapshotFixture>;
let root: string;
let input: ReviewSnapshotRevision;
const git = (...args: string[]) =>
	execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
		cwd: root,
		env: fixtureGitEnv,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
beforeEach(() => {
	fixture = snapshotFixture();
	root = join(fixture.directory, "consumer");
	mkdirSync(root);
	git("init", "--initial-branch=working");
	git("config", "user.name", "Fixture");
	git("config", "user.email", "fixture@example.invalid");
	writeFileSync(join(root, "work.txt"), "preserve this work");
	git("add", ".");
	git("-c", "commit.gpgsign=false", "commit", "-m", "local");
	writeFileSync(join(root, "work.txt"), "uncommitted user work");
	git("remote", "add", "origin", "git@bitbucket.org:org/repo.git");
	input = {
		workspaceId: "registered",
		headOid: fixture.head,
		targetTipOid: fixture.target,
		review: { provider: "bitbucket", owner: "org", repo: "repo", number: 1 },
	};
});
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }));

function harness(
	options: { headRepository?: string; moved?: boolean; rootMismatch?: boolean } = {}
) {
	const fetches: Array<{ remote: string; oids: string[] }> = [];
	const service = new ReviewRevisionAcquisition({
		resolveRoot: async (revision) => {
			if (options.rootMismatch || revision.workspaceId !== "registered")
				throw Error("Review workspace mismatch");
			return root;
		},
		resolveSources: async () => ({
			headOid: options.moved ? "a".repeat(40) : fixture.head,
			targetTipOid: fixture.target,
			headRepository: options.headRepository ?? "org/repo",
			targetRepository: "org/repo",
		}),
		fetchObjects: async (cwd, remote, oids) => {
			expect(cwd).toBe(realpathSync(root));
			fetches.push({ remote, oids });
			git("fetch", "--no-tags", "--no-write-fetch-head", "--refmap=", "--", fixture.root, ...oids);
		},
	});
	return { service, fetches };
}

test("acquires exact missing objects and then reads snapshot without changing worktree or refs", async () => {
	const snapshots = new ReviewSnapshotService({ resolveRoot: async () => root });
	await expect(snapshots.create(input)).rejects.toThrow("unavailable locally");
	const refs = git("show-ref");
	const head = git("rev-parse", "HEAD");
	const { service, fetches } = harness();
	await Promise.all([service.acquire(input), service.acquire(input)]);
	expect(fetches).toHaveLength(2);
	expect(fetches.flatMap((fetch) => fetch.oids).sort()).toEqual(
		[fixture.head, fixture.target].sort()
	);
	const snapshot = await snapshots.create(input);
	expect(snapshot).toMatchObject({ headOid: fixture.head, targetTipOid: fixture.target });
	expect(snapshot.files.some((file) => file.path === "renamed.ts")).toBe(true);
	expect(git("show-ref")).toBe(refs);
	expect(git("rev-parse", "HEAD")).toBe(head);
	expect(readFileSync(join(root, "work.txt"), "utf8")).toBe("uncommitted user work");
	await service.acquire(input);
	expect(fetches).toHaveLength(2);
});

test.each(["workspace", "revision", "fork"])(
	"rejects %s mismatch before any fetch",
	async (failure) => {
		const { service, fetches } = harness({
			rootMismatch: failure === "workspace",
			moved: failure === "revision",
			headRepository: failure === "fork" ? "someone/fork" : "org/repo",
		});
		await expect(service.acquire(input)).rejects.toThrow("Review ");
		expect(fetches).toHaveLength(0);
	}
);

test("uses the configured fork connection for the head and target connection for the base", async () => {
	git("remote", "add", "fork", "https://bitbucket.org/someone/fork.git");
	const { service, fetches } = harness({ headRepository: "someone/fork" });
	await service.acquire(input);
	expect(fetches).toEqual([
		{ remote: "https://bitbucket.org/someone/fork.git", oids: [fixture.head] },
		{ remote: "git@bitbucket.org:org/repo.git", oids: [fixture.target] },
	]);
});

test("never resolves mutable branches or a supplied filesystem root", async () => {
	const { service, fetches } = harness();
	await expect(service.acquire({ ...input, headOid: "HEAD" })).rejects.toThrow("exact PR revision");
	expect(fetches).toHaveLength(0);
});

test("remote identities must match the provider host and repository", () => {
	expect(revisionRemoteRepository("git@bitbucket.org:org/repo.git", "bitbucket")).toBe("org/repo");
	expect(revisionRemoteRepository("https://bitbucket.org/org/repo.git", "bitbucket")).toBe(
		"org/repo"
	);
	expect(revisionRemoteRepository("ssh://git@github.com/org/repo.git", "github")).toBe("org/repo");
	for (const remote of [
		"https://other.example/org/repo",
		"file:///tmp/repo",
		"ext::helper",
		"https://bitbucket.org/org/repo?other",
	])
		expect(revisionRemoteRepository(remote, "bitbucket")).toBeNull();
});

test("workspace rebinding during provider lookup prevents every fetch", async () => {
	let rebound = false;
	let fetches = 0;
	const service = new ReviewRevisionAcquisition({
		resolveRoot: async () => {
			if (rebound) throw Error("Review workspace changed");
			return root;
		},
		resolveSources: async () => {
			rebound = true;
			return {
				headOid: fixture.head,
				targetTipOid: fixture.target,
				headRepository: "org/repo",
				targetRepository: "org/repo",
			};
		},
		fetchObjects: async () => {
			fetches++;
		},
	});
	await expect(service.acquire(input)).rejects.toThrow("workspace changed");
	expect(fetches).toBe(0);
});

test("stalled provider lookup times out and cannot fetch when it eventually returns", async () => {
	let finish!: (
		value: import("../src/main/review-explanation/revision-acquisition").RevisionSources
	) => void;
	let entered = false;
	let fetches = 0;
	const service = new ReviewRevisionAcquisition({
		timeoutMs: 300,
		resolveRoot: async () => root,
		resolveSources: async () => {
			entered = true;
			return new Promise((resolve) => {
				finish = resolve;
			});
		},
		fetchObjects: async () => {
			fetches++;
		},
	});
	await expect(service.acquire(input)).rejects.toThrow("timed out");
	expect(entered).toBe(true);
	finish({
		headOid: fixture.head,
		targetTipOid: fixture.target,
		headRepository: "org/repo",
		targetRepository: "org/repo",
	});
	await new Promise((resolve) => setTimeout(resolve, 10));
	expect(fetches).toBe(0);
});

test("application-auth fetch isolates hostile config and shares only Git objects", async () => {
	const originalPath = process.env["PATH"];
	const originalGlobalConfig = process.env["GIT_CONFIG_GLOBAL"];
	const realGit = execFileSync("/usr/bin/which", ["git"], { encoding: "utf8" }).trim();
	const bin = join(fixture.directory, "bin");
	const capture = join(fixture.directory, "calls.jsonl");
	const trace = join(fixture.directory, "trace.jsonl");
	mkdirSync(bin);
	const hostile = `[url "https://wrong.invalid/"]\n insteadOf = https://bitbucket.org/\n[http]\n extraHeader = X-Untrusted: true\n[trace2]\n envVars = GIT_CONFIG_VALUE_1\n eventTarget = ${trace}\n`;
	writeFileSync(join(fixture.directory, ".gitconfig"), hostile);
	git("config", "url.https://wrong.invalid/.insteadOf", "https://bitbucket.org/");
	const beforeRefs = git("show-ref");
	writeFileSync(
		join(bin, "git"),
		`#!${process.execPath}
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const args=process.argv.slice(2);
const realGit=${JSON.stringify(realGit)};
if(args.includes('fetch')) {
 const config=(...a)=>{try{return execFileSync(realGit,['config',...a],{env:process.env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()}catch{return ''}};
 fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args,cwd:process.cwd(),objects:process.env.GIT_OBJECT_DIRECTORY,hasHeader:config('--get-urlmatch','http.extraHeader','https://bitbucket.org/org/repo.git')===process.env.GIT_CONFIG_VALUE_1,redirects:config('--get','http.followRedirects'),rewrites:config('--get-regexp','^url\\\\.'),global:process.env.GIT_CONFIG_GLOBAL,protocol:process.env.GIT_ALLOW_PROTOCOL})+'\\n');
 // Only the transport is substituted: real Git fetch writes into the production-selected object directory.
 args[args.indexOf('--')+1]=${JSON.stringify(fixture.root)};
 execFileSync(realGit,args,{env:{...process.env,GIT_ALLOW_PROTOCOL:'file'},stdio:'pipe'});
} else {
 const output=execFileSync(realGit,args,{env:process.env,stdio:['ignore','pipe','pipe']});
 process.stdout.write(output);
}
`,
		{ mode: 0o700 }
	);
	process.env["PATH"] = `${bin}:${originalPath}`;
	process.env["GIT_CONFIG_GLOBAL"] = join(fixture.directory, ".gitconfig");
	try {
		await fetchRevisionObjects(
			root,
			"https://user:configured-secret@bitbucket.org/org/repo.git",
			[fixture.head, fixture.target],
			AbortSignal.timeout(5000),
			"Authorization: Basic synthetic-test-token"
		);
		const record = JSON.parse(readFileSync(capture, "utf8"));
		expect(record.args.join(" ")).not.toContain("synthetic-test-token");
		expect(record.args.join(" ")).not.toContain("configured-secret");
		expect(record).toMatchObject({
			hasHeader: true,
			redirects: "false",
			rewrites: "",
			global: "/dev/null",
			protocol: "https",
		});
		expect(record.objects).toBe(realpathSync(join(root, ".git", "objects")));
		expect(() => readFileSync(join(record.cwd, "config"))).toThrow();
		expect(git("show-ref")).toBe(beforeRefs);
		expect(git("cat-file", "-t", fixture.head)).toBe("commit");
		expect(readFileSync(join(root, "work.txt"), "utf8")).toBe("uncommitted user work");
		try {
			expect(readFileSync(trace, "utf8")).not.toContain("synthetic-test-token");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	} finally {
		process.env["PATH"] = originalPath;
		if (originalGlobalConfig === undefined)
			Reflect.deleteProperty(process.env, "GIT_CONFIG_GLOBAL");
		else process.env["GIT_CONFIG_GLOBAL"] = originalGlobalConfig;
	}
});

test("app authentication rejects altered HTTPS destinations", () => {
	for (const url of [
		"https://bitbucket.org:8443/org/repo",
		"https://evil.invalid/org/repo",
		"https://bitbucket.org/org/repo?token=x",
		"https://bitbucket.org/org/repo#fragment",
	])
		expect(() => canonicalBitbucketHttpsRemote(url)).toThrow("verified Bitbucket HTTPS remote");
});

test("runtime cancellation aborts its fetch and cannot cancel a browser acquisition", async () => {
	const controller = new AbortController();
	const signals: AbortSignal[] = [];
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	const service = new ReviewRevisionAcquisition({
		resolveRoot: async () => root,
		resolveSources: async () => ({
			headOid: fixture.head,
			targetTipOid: fixture.target,
			headRepository: "org/repo",
			targetRepository: "org/repo",
		}),
		fetchObjects: async (_root, _remote, oids, signal) => {
			signals.push(signal);
			await Promise.race([
				wait,
				new Promise<never>((_resolve, reject) =>
					signal.addEventListener("abort", () => reject(Error("cancelled")), { once: true })
				),
			]);
			git("fetch", "--no-tags", "--no-write-fetch-head", "--refmap=", "--", fixture.root, ...oids);
		},
	});
	const runtime = service.acquire(input, controller.signal).then(
		() => false,
		() => true
	);
	for (let i = 0; signals.length < 1 && i < 100; i++)
		await new Promise((resolve) => setTimeout(resolve, 5));
	const browser = service.acquire(input);
	for (let i = 0; signals.length < 2 && i < 100; i++)
		await new Promise((resolve) => setTimeout(resolve, 5));
	controller.abort();
	expect(await runtime).toBe(true);
	expect(signals[0]?.aborted).toBe(true);
	expect(signals[1]?.aborted).toBe(false);
	release();
	await browser;
	expect(git("cat-file", "-t", fixture.target)).toBe("commit");
});
