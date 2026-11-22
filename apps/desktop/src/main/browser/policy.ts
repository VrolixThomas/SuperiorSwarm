import { isBrowserURL } from "../../shared/browser";

/** Only ordinary GET links become tabs. POST forms and opener-dependent windows stay blocked. */
export function isBrowserTabRequest(details: {
	url: string;
	disposition: string;
	features: string;
	postBody?: unknown;
}): boolean {
	return (
		isBrowserURL(details.url) &&
		!details.postBody &&
		["foreground-tab", "background-tab"].includes(details.disposition) &&
		details.features
			.split(",")
			.every((value) => ["", "noopener", "noreferrer"].includes(value.trim()))
	);
}

/** Subresources and WebSocket handshakes need a different policy from navigation. */
export function allowedBrowserRequest(value: string): boolean {
	if (isBrowserURL(value)) return true;
	try {
		const url = new URL(value);
		if (url.protocol === "wss:" || url.protocol === "ws:") {
			url.protocol = url.protocol === "wss:" ? "https:" : "http:";
			return isBrowserURL(url.href);
		}
		return url.protocol === "data:" || (url.protocol === "blob:" && isBrowserURL(url.pathname));
	} catch {
		return false;
	}
}
