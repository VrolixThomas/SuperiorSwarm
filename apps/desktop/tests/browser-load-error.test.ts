import { expect, test } from "bun:test";
import { describeBrowserLoadError } from "../src/shared/browser-load-error";

test("DNS failures explain the hostname and offer a distinct, explicit homepage alternative", () => {
	const failure = describeBrowserLoadError(
		-105,
		"https://www.superiorswarm.com/private?token=secret#fragment"
	);
	expect(failure.kind).toBe("dns");
	expect(failure.message).toContain("www.superiorswarm.com");
	expect(failure.message).toContain("DNS");
	expect(failure.message).not.toContain("token");
	expect(failure.suggestedUrl).toBe("https://superiorswarm.com/");
	expect(failure.url).toBe("https://www.superiorswarm.com/private?token=secret#fragment");
});

test("never suggests a different hostname for certificates, non-www names, or credentials", () => {
	for (const [code, url] of [
		[-202, "https://www.example.com"],
		[-105, "https://example.com"],
		[-105, "https://www.localhost"],
		[-105, "https://user:password@www.example.com"],
		[-102, "https://www.example.com"],
	] as const) {
		expect(describeBrowserLoadError(code, url).suggestedUrl).toBeUndefined();
	}
});

test("distinguishes refused local servers, offline connections, TLS errors, and timeouts", () => {
	expect(describeBrowserLoadError(-102, "http://127.0.0.1:5173").message).toContain("local server");
	expect(describeBrowserLoadError(-102, "https://example.com").message).not.toContain(
		"local server"
	);
	expect(describeBrowserLoadError(-106, "https://example.com").kind).toBe("offline");
	expect(describeBrowserLoadError(-202, "https://example.com").kind).toBe("certificate");
	expect(describeBrowserLoadError(-118, "https://example.com").kind).toBe("timeout");
	expect(describeBrowserLoadError(-2, "").message).toContain("this address");
});
