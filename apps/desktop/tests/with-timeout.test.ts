import { describe, expect, test } from "bun:test";
import { withTimeout } from "../src/main/util/with-timeout";

describe("withTimeout", () => {
	test("resolves with the inner value when it finishes before the deadline", async () => {
		const result = await withTimeout(Promise.resolve("done"), 1000, "fallback");
		expect(result).toBe("done");
	});

	test("resolves with the fallback when the inner promise hangs past the deadline", async () => {
		const never = new Promise<string>(() => {});
		const start = Date.now();
		const result = await withTimeout(never, 50, "fallback");
		expect(result).toBe("fallback");
		expect(Date.now() - start).toBeLessThan(500);
	});

	test("does not reject when the inner promise rejects", async () => {
		const rejected = Promise.reject(new Error("boom"));
		const result = await withTimeout(rejected, 1000, "fallback");
		expect(result).toBe("fallback");
	});
});
