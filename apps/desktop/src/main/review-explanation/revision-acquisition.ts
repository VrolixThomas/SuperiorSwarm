import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ReviewFetchProgress } from "../../shared/review-fetch-progress";
import type { ReviewSnapshotRevision } from "../../shared/review-snapshot-types";
import { ReviewFetchProcessError, runReviewFetchGit } from "./fetch-process";
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
	lookupTimeoutMs?: number;
}

const fullOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const FETCH_FAILURE_MESSAGES = {
	cancelled: "Review revision acquisition was cancelled.",
	timeout: "Review revision fetch exceeded its overall time limit. Retry preparation.",
	stalled:
		"Review revision fetch stopped making progress for 2 minutes. Check the connection and retry preparation.",
	authentication:
		"Review repository access was denied. Check credentials or repository permissions and retry preparation.",
	"repository-unavailable":
		"Review repository could not be found or accessed. Verify the repository and access permissions.",
	network:
		"Review repository connection failed. Check the network connection and retry preparation.",
	"revision-unavailable":
		"Review repository did not provide the requested commit. Refresh the PR revision and retry preparation.",
	"local-git":
		"Review revision preparation failed. Check local Git or disk access and retry preparation.",
	unknown: "Review revision fetch failed. Retry preparation.",
} as const;

export type RevisionFetchFailureCode = keyof typeof FETCH_FAILURE_MESSAGES;

export class RevisionFetchError extends Error {
	constructor(readonly code: RevisionFetchFailureCode) {
		super(FETCH_FAILURE_MESSAGES[code]);
		this.name = "RevisionFetchError";
	}
}

/** Classify known Git failures without retaining raw stderr, which can contain credentials. */
export function classifyRevisionFetchFailure(input: {
	operation: "init" | "fetch";
	aborted: boolean;
	code?: string | number | null;
	killed?: boolean;
	signal?: string | null;
	stderr: string;
}): RevisionFetchFailureCode {
	if (input.aborted) return "cancelled";
	if (input.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "local-git";
	if (
		(input.killed && input.signal === "SIGKILL") ||
		input.code === "ETIMEDOUT" ||
		/(?:operation|connection) timed out/i.test(input.stderr)
	)
		return "timeout";
	if (
		input.operation === "init" ||
		["ENOENT", "EACCES", "ENOSPC", "EROFS"].includes(String(input.code))
	)
		return "local-git";
	if (
		/authentication failed|could not read (?:username|password)|permission denied \(publickey|requested URL returned error: (?:401|403)\b|HTTP[^\n]*(?:401|403)\b/i.test(
			input.stderr
		)
	)
		return "authentication";
	if (/repository[^\n]*not found|requested URL returned error: 404\b/i.test(input.stderr))
		return "repository-unavailable";
	if (
		/not our ref|could(?:n't| not) find remote ref|unadvertised object|no such ref/i.test(
			input.stderr
		)
	)
		return "revision-unavailable";
	if (
		/could not resolve (?:host|proxy)|failed to connect|couldn't connect|connection (?:reset|refused|closed)|network is unreachable|SSL (?:certificate|connect)|certificate verification failed|RPC failed|early EOF|requested URL returned error: 5\d\d\b/i.test(
			input.stderr
		)
	)
		return "network";
	if (
		/no space left|read-only file system|cannot (?:write|mkdir)|unable to (?:create|write)|not a git repository|not a valid object|insufficient permission/i.test(
			input.stderr
		)
	)
		return "local-git";
	return "unknown";
}

async function fetchGit(
	root: string,
	args: string[],
	signal: AbortSignal,
	env: NodeJS.ProcessEnv,
	onProgress?: (progress: ReviewFetchProgress) => void
): Promise<void> {
	const started = Date.now();
	const operation = args[0] === "init" ? "init" : "fetch";
	try {
		await runReviewFetchGit(root, args, signal, env, { onProgress });
	} catch (error) {
		const failure = error instanceof ReviewFetchProcessError ? error : undefined;
		const category: RevisionFetchFailureCode =
			signal.aborted || failure?.reason === "cancelled"
				? "cancelled"
				: failure?.reason === "timeout"
					? "timeout"
					: failure?.reason === "stalled"
						? "stalled"
						: classifyRevisionFetchFailure({
								operation,
								aborted: false,
								code: failure?.code ?? failure?.exitCode,
								signal: failure?.signal,
								stderr: failure?.stderr ?? "",
							});
		console.warn("[review-acquisition] Git operation failed", {
			operation,
			category,
			elapsedMs: Math.max(0, Date.now() - started),
			exitCode: failure?.exitCode ?? null,
		});
		throw new RevisionFetchError(category);
	}
}

/** Acquire objects without moving refs, changing files, or persisting application credentials. */
export async function fetchRevisionObjects(
	root: string,
	remote: string,
	oids: string[],
	signal: AbortSignal,
	authorization?: string,
	onProgress?: (progress: ReviewFetchProgress) => void
): Promise<void> {
	const fetchRemote = authorization ? canonicalBitbucketHttpsRemote(remote) : remote;
	const args = [
		"fetch",
		"--progress",
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
	if (!authorization) return fetchGit(root, args, signal, env, onProgress);
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
	// Share the knowledge of every local branch, not only the checked-out HEAD.
	// A user may be on an old branch while remote-tracking refs already contain the PR history.
	const haveLines = (
		await readGit(
			root,
			["for-each-ref", "--format=%(objecttype) %(objectname)", "refs/heads", "refs/remotes"],
			signal
		)
	)
		.toString()
		.trim()
		.split("\n");
	const haves = new Set(
		haveLines.flatMap((line) => {
			const [type, oid] = line.split(" ");
			return type === "commit" && oid && fullOid.test(oid) ? [oid] : [];
		})
	);
	try {
		const head = (await readGit(root, ["rev-parse", "--verify", "HEAD^{commit}"], signal))
			.toString()
			.trim();
		if (fullOid.test(head)) haves.add(head);
	} catch {
		signal.throwIfAborted();
	}
	// Preserve shallow traversal boundaries when advertising shallow branch tips.
	// Copy only validated object IDs; never copy repository configuration or update its shallow file.
	let shallow: string | undefined;
	if (
		(await readGit(root, ["rev-parse", "--is-shallow-repository"], signal)).toString().trim() ===
		"true"
	) {
		const shallowPath = (await readGit(root, ["rev-parse", "--git-path", "shallow"], signal))
			.toString()
			.trim();
		const boundaries = (await readFile(resolve(root, shallowPath), "utf8")).trim().split("\n");
		if (
			!boundaries.length ||
			boundaries.some((oid) => !fullOid.test(oid) || oid.length !== (format === "sha1" ? 40 : 64))
		)
			throw new RevisionFetchError("local-git");
		shallow = `${boundaries.join("\n")}\n`;
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
		if (shallow) await writeFile(join(temporary, "shallow"), shallow);
		// Generated refs exist only in the disposable credential-isolated repository.
		// Default fetch negotiation can now advertise all known branch histories.
		await writeFile(
			join(temporary, "packed-refs"),
			[
				"# pack-refs with: peeled fully-peeled sorted",
				...[...haves].map(
					(oid, index) => `${oid} refs/review-haves/${String(index).padStart(10, "0")}`
				),
				"",
			].join("\n")
		);
		signal.throwIfAborted();
		await fetchGit(
			temporary,
			args,
			signal,
			{
				...isolated,
				...auth,
				GIT_DIR: temporary,
				GIT_OBJECT_DIRECTORY: objects,
			},
			onProgress
		);
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

	acquire(
		input: ReviewSnapshotRevision,
		callerSignal?: AbortSignal,
		onProgress?: (progress: ReviewFetchProgress) => void
	): Promise<void> {
		// Runtime runs own their cancellation. Do not share their subprocess with a browser consumer.
		if (callerSignal || onProgress) return this.run(input, callerSignal, onProgress);
		const key = JSON.stringify(input);
		const existing = this.active.get(key);
		if (existing) return existing;
		const work = this.run(input).finally(() => this.active.delete(key));
		this.active.set(key, work);
		return work;
	}

	private run(
		input: ReviewSnapshotRevision,
		callerSignal?: AbortSignal,
		onProgress?: (progress: ReviewFetchProgress) => void
	): Promise<void> {
		const deadline = AbortSignal.timeout(this.options.timeoutMs ?? 12 * 60_000);
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
		const work = Promise.race([this.prepare(input, signal, onProgress), cancelled]).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
		return work;
	}

	private async lookup<T>(
		operation: () => Promise<T>,
		signal: AbortSignal,
		kind: "metadata" | "authorization"
	): Promise<T> {
		signal.throwIfAborted();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let abort = () => {};
		const interrupted = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error(`Review revision ${kind} lookup timed out. Retry preparation.`)),
				this.options.lookupTimeoutMs ?? 60_000
			);
			timer.unref?.();
			abort = () => reject(new Error("Review revision acquisition cancelled."));
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
		});
		try {
			return await Promise.race([operation(), interrupted]);
		} finally {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
		}
	}

	private async prepare(
		input: ReviewSnapshotRevision,
		signal: AbortSignal,
		onProgress?: (progress: ReviewFetchProgress) => void
	): Promise<void> {
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
		const sources = await this.lookup(() => this.options.resolveSources(input), signal, "metadata");
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
		const grouped = new Map<string, string[]>();
		for (const { oid, remote } of plan) grouped.set(remote, [...(grouped.get(remote) ?? []), oid]);
		for (const [remote, oids] of grouped) {
			const authorization = await this.lookup(
				async () => this.options.getAuthorization?.(remote, input),
				signal,
				"authorization"
			);
			if ((await realpath(await this.options.resolveRoot(input))) !== root)
				throw new Error("Review workspace changed while acquiring revisions. Reopen the PR.");
			signal.throwIfAborted();
			await (this.options.fetchObjects ?? fetchRevisionObjects)(
				root,
				remote,
				oids,
				signal,
				authorization,
				onProgress
			);
			for (const oid of oids)
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
