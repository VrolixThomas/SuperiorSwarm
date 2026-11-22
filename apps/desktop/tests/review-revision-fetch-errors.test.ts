import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	classifyRevisionFetchFailure,
	fetchRevisionObjects,
} from "../src/main/review-explanation/revision-acquisition";

let directory: string;
let previousPath: string | undefined;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "review-fetch-errors-"));
	previousPath = process.env["PATH"];
	process.env["PATH"] = directory;
});
afterEach(() => {
	process.env["PATH"] = previousPath;
	rmSync(directory, { recursive: true, force: true });
});

test.each([
	[
		"fatal: Authentication failed for https://user:synthetic-secret@bitbucket.org/private/repo",
		"authentication",
		"credentials or repository permissions",
	],
	[
		"fatal: unable to access https://user:synthetic-secret@bitbucket.org/private/repo: Could not resolve host: bitbucket.org",
		"network",
		"network connection",
	],
	[
		"fatal: remote error: upload-pack: not our ref aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"revision-unavailable",
		"requested commit",
	],
	[
		"fatal: cannot write pack file: No space left on device",
		"local-git",
		"local Git or disk access",
	],
	["fatal: unrelated failure with synthetic-secret", "unknown", "fetch failed. Retry preparation"],
])(
	"classifies subprocess failure without exposing raw output: %s",
	async (stderr, code, message) => {
		writeFileSync(
			join(directory, "git"),
			`#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr)}); process.exit(128);\n`,
			{ mode: 0o700 }
		);
		const failure = await fetchRevisionObjects(
			directory,
			"https://bitbucket.org/org/repo.git",
			["a".repeat(40)],
			new AbortController().signal
		).then(
			() => null,
			(error: unknown) => error
		);
		expect(failure).toBeInstanceOf(Error);
		expect((failure as Error).message).toContain(message);
		expect((failure as { code: string }).code).toBe(code);
		expect(JSON.stringify(failure)).not.toContain("synthetic-secret");
		expect((failure as Error).message).not.toContain("https://");
	}
);

test("cancelled subprocess is not reported as a credential failure", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		fetchRevisionObjects(
			directory,
			"https://bitbucket.org/org/repo.git",
			["a".repeat(40)],
			controller.signal
		)
	).rejects.toThrow("cancelled");
});

test("timeout, cancellation, initialization and output limits stay distinct", () => {
	const timeout = {
		operation: "fetch" as const,
		aborted: false,
		killed: true,
		signal: "SIGKILL",
		stderr: "",
	};
	expect(classifyRevisionFetchFailure(timeout)).toBe("timeout");
	expect(classifyRevisionFetchFailure({ ...timeout, aborted: true })).toBe("cancelled");
	expect(
		classifyRevisionFetchFailure({ ...timeout, code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" })
	).toBe("local-git");
	expect(classifyRevisionFetchFailure({ ...timeout, killed: false, operation: "init" })).toBe(
		"local-git"
	);
	expect(
		classifyRevisionFetchFailure({
			...timeout,
			killed: false,
			stderr: "fatal: repository not found",
		})
	).toBe("repository-unavailable");
	expect(
		classifyRevisionFetchFailure({
			...timeout,
			killed: false,
			stderr: "SSL certificate problem: certificate verification failed",
		})
	).toBe("network");
});

test("diagnostics contain only fixed categories, timing and exit code", async () => {
	const warning = spyOn(console, "warn").mockImplementation(() => {});
	writeFileSync(
		join(directory, "git"),
		`#!${process.execPath}\nprocess.stderr.write('fatal: Authentication failed for https://user:synthetic-secret@bitbucket.org/private/repo'); process.exit(128);\n`,
		{ mode: 0o700 }
	);
	try {
		await expect(
			fetchRevisionObjects(
				directory,
				"https://bitbucket.org/org/repo.git",
				["a".repeat(40)],
				new AbortController().signal
			)
		).rejects.toThrow("access was denied");
		expect(warning).toHaveBeenCalledTimes(1);
		expect(warning.mock.calls[0]?.[1]).toEqual({
			operation: "fetch",
			category: "authentication",
			elapsedMs: expect.any(Number),
			exitCode: 128,
		});
		expect(JSON.stringify(warning.mock.calls)).not.toContain("synthetic-secret");
		expect(JSON.stringify(warning.mock.calls)).not.toContain("https://");
	} finally {
		warning.mockRestore();
	}
});
