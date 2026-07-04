import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): string {
	return randomBytes(32).toString("hex");
}

/** SHA-256 hex digest — what we persist instead of the raw manager token. */
export function hashToken(token: string): string {
	return createHash("sha256").update(token, "utf-8").digest("hex");
}

/** Timing-safe compare of a raw token against a stored SHA-256 hex hash. */
export function tokenMatchesHash(token: string, storedHash: string | null): boolean {
	if (!storedHash) return false;
	const a = Buffer.from(hashToken(token));
	const b = Buffer.from(storedHash);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

export function isValidBearer(headerValue: string | undefined, expected: string): boolean {
	if (!headerValue) return false;
	if (!headerValue.startsWith("Bearer ")) return false;
	const provided = headerValue.slice("Bearer ".length);
	if (provided.length !== expected.length) return false;
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}
