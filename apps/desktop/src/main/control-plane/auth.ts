import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(): string {
	return randomBytes(32).toString("hex");
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
