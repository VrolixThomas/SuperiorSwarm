export interface BrowserLoadError {
	code: number;
	kind: "dns" | "connection" | "offline" | "certificate" | "timeout" | "blocked" | "other";
	url: string;
	host: string;
	message: string;
	suggestedUrl?: string;
}

/** Describe Chromium failures without leaking URL credentials/query strings into the message. */
export function describeBrowserLoadError(code: number, value: string): BrowserLoadError {
	let url: URL | undefined;
	try {
		url = new URL(value);
	} catch {
		/* An interrupted page may not expose its URL. */
	}
	const host = url?.host ?? "this address";
	const base = { code, url: value, host };
	if (code === -105 || code === -137) {
		const result: BrowserLoadError = {
			...base,
			kind: "dns",
			message: `Could not find ${host}. The website address could not be resolved (DNS).`,
		};
		if (
			url?.protocol === "https:" &&
			!url.username &&
			!url.password &&
			url.hostname.startsWith("www.") &&
			url.hostname.slice(4).includes(".")
		) {
			// This is a user-selected alternative homepage, never an automatic redirect.
			// Do not forward paths, query tokens or fragments to a different hostname.
			url.hostname = url.hostname.slice(4);
			result.suggestedUrl = `${url.origin}/`;
		}
		return result;
	}
	if (code === -106)
		return {
			...base,
			kind: "offline",
			message: "You appear to be offline. Check your internet connection, then retry.",
		};
	if (code <= -200 && code > -300)
		return {
			...base,
			kind: "certificate",
			message: `The secure connection to ${host} could not be verified. The website's certificate needs attention.`,
		};
	if (code === -7 || code === -118)
		return {
			...base,
			kind: "timeout",
			message: `${host} took too long to respond. Check the connection and retry.`,
		};
	if (code === -102 || code === -101 || code === -100) {
		const local = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
		return {
			...base,
			kind: "connection",
			message: local
				? `Could not connect to ${host}. Make sure your local server is running, then retry.`
				: `Could not connect to ${host}. The website may be unavailable; try again shortly.`,
		};
	}
	if (code === -20 || code === -22 || code === -30)
		return {
			...base,
			kind: "blocked",
			message: `The request to ${host} was blocked. Check the address and browser policy.`,
		};
	return {
		...base,
		kind: "other",
		message: `Could not load ${host}. Check the address and retry.`,
	};
}
