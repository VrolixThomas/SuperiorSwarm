import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReviewSnapshotRevision } from "../../shared/review-snapshot-types";
import { readGit } from "./git-reader";

export interface RevisionSources {
	headOid: string;
	targetTipOid: string;
	headRepository?: string;
	targetRepository?: string;
}

interface AcquisitionOptions {
	/** Validate the registered workspace's provider/PR binding before returning its root. */
	resolveRoot(input: ReviewSnapshotRevision): Promise<string>;
	resolveSources(input: ReviewSnapshotRevision): Promise<RevisionSources>;
	fetchObjects?: typeof fetchRevisionObjects;
	getAuthorization?: (remote: string, input: ReviewSnapshotRevision) => Promise<string | undefined>;
	timeoutMs?: number;
}

const fullOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function fetchGit(
	root: string,
	args: string[],
	signal: AbortSignal,
	env: NodeJS.ProcessEnv
): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args],
			{
				cwd: root,
				signal,
				timeout: 45_000,
				killSignal: "SIGKILL",
				maxBuffer: 1024 * 1024,
				env,
			},
			(error) => {
				if (error || signal.aborted)
					reject(
						new Error(
							"Review revision fetch failed. Check the repository's Git authentication and retry Refresh."
						)
					);
				else resolve();
			}
		);
	});
}

/** Acquire objects without moving refs, changing files, or persisting application credentials. */
export async function fetchRevisionObjects(
	root: string,
	remote: string,
	oids: string[],
	signal: AbortSignal,
	authorization?: string
): Promise<void> {
	const fetchRemote = authorization ? canonicalBitbucketHttpsRemote(remote) : remote;
	const args = [
		"fetch",
		"--no-tags",
		"--no-recurse-submodules",
		"--no-write-fetch-head",
		"--no-auto-maintenance",
		"--refmap=",
		"--",
		fetchRemote,
		...oids,
	];
	const env: NodeJS.ProcessEnv = {
		PATH: process.env["PATH"],
		HOME: process.env["HOME"],
		USERPROFILE: process.env["USERPROFILE"],
		SystemRoot: process.env["SystemRoot"],
		SSH_AUTH_SOCK: process.env["SSH_AUTH_SOCK"],
		GIT_TERMINAL_PROMPT: "0",
		GIT_NO_REPLACE_OBJECTS: "1",
		GIT_NO_LAZY_FETCH: "1",
		GIT_ALLOW_PROTOCOL: "https:ssh",
		GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
	};
	if (!authorization) return fetchGit(root, args, signal, env);
	const auth = revisionAuthorizationEnvironment(remote, authorization);
	const objects = await realpath(
		resolve(
			root,
			(await readGit(root, ["rev-parse", "--git-path", "objects"], signal)).toString().trim()
		)
	);
	const format = (await readGit(root, ["rev-parse", "--show-object-format"], signal))
		.toString()
		.trim();
	if (format !== "sha1" && format !== "sha256")
		throw new Error("Review Git object format is unsupported");
	try {
		const tip = (await readGit(root, ["rev-parse", "--verify", "HEAD^{commit}"], signal))
			.toString()
			.trim();
		if (fullOid.test(tip)) args.splice(args.indexOf("--"), 0, `--negotiation-tip=${tip}`);
	} catch {
		signal.throwIfAborted();
	}
	const temporary = await mkdtemp(join(tmpdir(), "review-object-fetch-"));
	try {
		// A fresh bare Git directory excludes repository/global includes, URL rewrites,
		// proxies and extra headers. Only its object storage is shared with the workspace.
		const isolated = {
			...env,
			GIT_ALLOW_PROTOCOL: "https",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_SYSTEM: "/dev/null",
			GIT_CONFIG_GLOBAL: "/dev/null",
		};
		await fetchGit(
			temporary,
			["init", "--bare", "--template=", `--object-format=${format}`],
			signal,
			isolated
		);
		await fetchGit(temporary, args, signal, {
			...isolated,
			...auth,
			GIT_DIR: temporary,
			GIT_OBJECT_DIRECTORY: objects,
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export function canonicalBitbucketHttpsRemote(remote: string): string {
	const url = new URL(remote);
	if (
		url.protocol !== "https:" ||
		url.hostname !== "bitbucket.org" ||
		url.port ||
		url.search ||
		url.hash ||
		!/^\/[^/]+\/[^/]+$/.test(url.pathname)
	)
		throw new Error("Review authentication requires the verified Bitbucket HTTPS remote");
	url.username = "";
	url.password = "";
	return url.href;
}

/** Ephemeral, URL-scoped authentication; never put access tokens in argv or Git config files. */
export function revisionAuthorizationEnvironment(
	remote: string,
	authorization?: string
): NodeJS.ProcessEnv {
	if (!authorization) return {};
	const scope = `http.${canonicalBitbucketHttpsRemote(remote)}.extraHeader`;
	return {
		GIT_CONFIG_COUNT: "4",
		GIT_CONFIG_KEY_0: scope,
		GIT_CONFIG_VALUE_0: "",
		GIT_CONFIG_KEY_1: scope,
		GIT_CONFIG_VALUE_1: authorization,
		GIT_CONFIG_KEY_2: "credential.helper",
		GIT_CONFIG_VALUE_2: "",
		GIT_CONFIG_KEY_3: "http.followRedirects",
		GIT_CONFIG_VALUE_3: "false",
	};
}

/** Match a configured remote to provider-owned repository identity, including fork heads. */
export function revisionRemoteRepository(
	remote: string,
	provider: "github" | "bitbucket"
): string | null {
	const host = provider === "github" ? "github.com" : "bitbucket.org";
	const ssh = /^git@([^:]+):([^/]+\/[^/]+?)(?:\.git)?$/.exec(remote);
	if (ssh) return ssh[1] === host ? (ssh[2] ?? null) : null;
	try {
		const url = new URL(remote);
		if (
			!["https:", "ssh:"].includes(url.protocol) ||
			url.hostname !== host ||
			url.search ||
			url.hash
		)
			return null;
		const path = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
		return /^[^/]+\/[^/]+$/.test(path) ? path : null;
	} catch {
		return null;
	}
}

/** Network acquisition is separate from the local-only snapshot reader. */
export class ReviewRevisionAcquisition {
	private readonly active = new Map<string, Promise<void>>();
	constructor(private readonly options: AcquisitionOptions) {}

	acquire(input: ReviewSnapshotRevision, callerSignal?: AbortSignal): Promise<void> {
		// Runtime runs own their cancellation. Do not share their subprocess with a browser consumer.
		if (callerSignal) return this.run(input, callerSignal);
		const key = JSON.stringify(input);
		const existing = this.active.get(key);
		if (existing) return existing;
		const work = this.run(input).finally(() => this.active.delete(key));
		this.active.set(key, work);
		return work;
	}

	private run(input: ReviewSnapshotRevision, callerSignal?: AbortSignal): Promise<void> {
		const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 60_000);
		const signal = callerSignal ? AbortSignal.any([deadline, callerSignal]) : deadline;
		let onAbort = () => {};
		const cancelled = new Promise<never>((_resolve, reject) => {
			onAbort = () =>
				reject(
					new Error(
						callerSignal?.aborted
							? "Review revision acquisition cancelled"
							: "Review revision acquisition timed out. Retry Refresh."
					)
				);
			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) onAbort();
		});
		const work = Promise.race([this.prepare(input, signal), cancelled]).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
		return work;
	}

	private async prepare(input: ReviewSnapshotRevision, signal: AbortSignal): Promise<void> {
		if (!input.review || !fullOid.test(input.headOid) || !fullOid.test(input.targetTipOid))
			throw new Error("Review acquisition requires an exact PR revision");
		const review = input.review;
		const root = await realpath(await this.options.resolveRoot(input));
		signal.throwIfAborted();
		const top = (await readGit(root, ["rev-parse", "--show-toplevel"], signal)).toString().trim();
		if ((await realpath(top)) !== root)
			throw new Error("Review workspace must be a repository root");
		const missing: string[] = [];
		for (const oid of new Set([input.headOid, input.targetTipOid])) {
			try {
				const type = (await readGit(root, ["cat-file", "-t", oid], signal)).toString().trim();
				if (type !== "commit") throw Error("not a commit");
			} catch {
				signal.throwIfAborted();
				missing.push(oid);
			}
		}
		if (!missing.length) return;
		const sources = await this.options.resolveSources(input);
		signal.throwIfAborted();
		if (sources.headOid !== input.headOid || sources.targetTipOid !== input.targetTipOid)
			throw new Error("Review PR revision changed. Refresh before acquiring its commits.");
		const names = (await readGit(root, ["remote"], signal))
			.toString()
			.trim()
			.split("\n")
			.filter(Boolean);
		const remotes = await Promise.all(
			names.map(async (name) =>
				(await readGit(root, ["remote", "get-url", "--", name], signal)).toString().trim()
			)
		);
		// Preflight every missing side before fetching any object.
		const plan = missing.map((oid) => {
			const repository = oid === input.headOid ? sources.headRepository : sources.targetRepository;
			const remote =
				repository &&
				remotes.find((url) => revisionRemoteRepository(url, review.provider) === repository);
			if (!remote)
				throw new Error(
					"Review revision has no matching configured Git remote. Connect the source or target repository and retry Refresh."
				);
			return { oid, remote };
		});
		for (const { oid, remote } of plan) {
			const authorization = await this.options.getAuthorization?.(remote, input);
			if ((await realpath(await this.options.resolveRoot(input))) !== root)
				throw new Error("Review workspace changed while acquiring revisions. Reopen the PR.");
			signal.throwIfAborted();
			await (this.options.fetchObjects ?? fetchRevisionObjects)(
				root,
				remote,
				[oid],
				signal,
				authorization
			);
			try {
				if ((await readGit(root, ["cat-file", "-t", oid], signal)).toString().trim() !== "commit")
					throw Error("not a commit");
			} catch {
				throw new Error(
					"Review exact commit is still unavailable after fetching. Refresh and retry."
				);
			}
		}
		if ((await realpath(await this.options.resolveRoot(input))) !== root)
			throw new Error("Review workspace changed while acquiring revisions. Reopen the PR.");
	}
}
