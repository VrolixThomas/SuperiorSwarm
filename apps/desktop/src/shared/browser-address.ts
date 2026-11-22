import { normalizeBrowserURL } from "./browser";

const SEARCH_URL = "https://www.google.com/search?q=";
const EXPLICIT_URL = /^[a-z][a-z\d+.-]*:\/\//i;
const RESERVED_SCHEME =
	/^(?:https?|about|blob|chrome|data|file|ftp|javascript|mailto|sms|ssh|tel|view-source|wss?):/i;
const LOCAL_ADDRESS = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/** Resolve human address-bar input; agent navigation still requires an explicit URL. */
export function resolveBrowserAddress(value: string): string | null {
	const input = value.trim();
	if (!input) return null;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Reject controls before URL parsing can silently strip them.
	if (/[\u0000-\u001f\u007f]/.test(input))
		throw new Error("Enter an address or search on a single line.");
	let url: string;
	if (EXPLICIT_URL.test(input) || RESERVED_SCHEME.test(input) || LOCAL_ADDRESS.test(input)) {
		url = normalizeBrowserURL(input);
	} else {
		const authority = input.split(/[/?#]/, 1)[0] ?? "";
		if (/^[^\s]*@/.test(authority))
			throw new Error("Enter an address without embedded credentials.");
		const looksLikeAddress =
			!/\s/.test(input) &&
			(authority.split(":", 1)[0]?.includes(".") ||
				/^\[[\da-f:]+\](?::\d+)?$/i.test(authority) ||
				/^[^:@]+:\d+$/.test(authority));
		url = looksLikeAddress
			? normalizeBrowserURL(`https://${input}`)
			: `${SEARCH_URL}${encodeURIComponent(input)}`;
	}
	if (url.length > 8192) throw new Error("The address or search is too long.");
	return url;
}
