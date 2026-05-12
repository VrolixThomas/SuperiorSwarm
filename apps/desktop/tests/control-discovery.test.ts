import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	readControlDiscovery,
	writeControlDiscovery,
} from "../src/main/services/control-discovery";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ctrl-disc-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("control-discovery", () => {
	test("write then read round-trips", () => {
		writeControlDiscovery(dir, { port: 12345, token: "tok", pid: 999 });
		const out = readControlDiscovery(dir);
		expect(out?.port).toBe(12345);
		expect(out?.token).toBe("tok");
		expect(out?.pid).toBe(999);
		expect(typeof out?.updatedAt).toBe("string");
	});

	test("write creates parent dir", () => {
		const nested = join(dir, "deep");
		writeControlDiscovery(nested, { port: 1, token: "t", pid: 2 });
		expect(readFileSync(join(nested, "control.json"), "utf-8")).toMatch(/"port":/);
	});

	test("file mode is 0600 on POSIX", () => {
		if (process.platform === "win32") return;
		writeControlDiscovery(dir, { port: 1, token: "t", pid: 2 });
		const mode = statSync(join(dir, "control.json")).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	test("read returns null when file missing", () => {
		expect(readControlDiscovery(dir)).toBeNull();
	});

	test("read returns null when file malformed", () => {
		writeFileSync(join(dir, "control.json"), "not json");
		expect(readControlDiscovery(dir)).toBeNull();
	});
});
