import { isHermesLoopbackUrl } from "../../shared/hermes";

const DEFAULT_TOKEN_DISCOVERY_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_DASHBOARD_HTML_BYTES = 1024 * 1024;
const MAX_TOKEN_LENGTH = 8_192;
const INJECTED_TOKEN_PATTERN = /window\.__HERMES_SESSION_TOKEN__\s*=\s*("(?:\\.|[^"\\])*")/;
const RESPONSE_SIZE_ERROR = "Hermes Dashboard token discovery response exceeded the size limit";

export interface HermesDashboardTokenDiscoveryOptions {
	fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	maxResponseBytes?: number;
}

function dashboardRootUrl(baseUrl: string): URL {
	if (!isHermesLoopbackUrl(baseUrl)) {
		throw new Error("Hermes Dashboard token auto-discovery is loopback-only");
	}
	const url = new URL(baseUrl);
	if (url.protocol === "ws:") url.protocol = "http:";
	if (url.protocol === "wss:") url.protocol = "https:";
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Hermes Dashboard token discovery requires HTTP or HTTPS");
	}
	url.username = "";
	url.password = "";
	if (url.pathname.endsWith("/api/ws")) {
		url.pathname = url.pathname.slice(0, -7) || "/";
	}
	if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`;
	url.search = "";
	url.hash = "";
	return url;
}

function isValidToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_TOKEN_LENGTH &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	);
}

export function extractInjectedHermesDashboardToken(html: string): string {
	const match = INJECTED_TOKEN_PATTERN.exec(String(html || ""));
	if (match?.[1]) {
		try {
			const token: unknown = JSON.parse(match[1]);
			if (isValidToken(token)) return token;
		} catch {
			// Fall through to the same redacted error used for missing injections.
		}
	}
	throw new Error("Hermes Dashboard did not expose a valid session token");
}

async function cancelOversizedResponse(
	controller: AbortController,
	stream: ReadableStream<Uint8Array> | null
): Promise<never> {
	controller.abort();
	try {
		await stream?.cancel();
	} catch {
		// The response may already have observed the abort; the bounded error stays content-free.
	}
	throw new Error(RESPONSE_SIZE_ERROR);
}

async function readBoundedDashboardHtml(
	response: Response,
	controller: AbortController,
	maxResponseBytes: number
): Promise<string> {
	const rawContentLength = response.headers.get("Content-Length")?.trim() ?? "";
	if (/^\d+$/.test(rawContentLength) && Number(rawContentLength) > maxResponseBytes) {
		return cancelOversizedResponse(controller, response.body);
	}
	if (!response.body) return "";

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: string[] = [];
	let bytesRead = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesRead += value.byteLength;
			if (bytesRead > maxResponseBytes) {
				controller.abort();
				try {
					await reader.cancel();
				} catch {
					// The fetch body can reject cancellation after observing the abort.
				}
				throw new Error(RESPONSE_SIZE_ERROR);
			}
			chunks.push(decoder.decode(value, { stream: true }));
		}
		chunks.push(decoder.decode());
		return chunks.join("");
	} finally {
		reader.releaseLock();
	}
}

export async function discoverHermesDashboardToken(
	baseUrl: string,
	options: HermesDashboardTokenDiscoveryOptions = {}
): Promise<string> {
	const url = dashboardRootUrl(baseUrl);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TOKEN_DISCOVERY_TIMEOUT_MS;
	const configuredMaxBytes = options.maxResponseBytes ?? DEFAULT_MAX_DASHBOARD_HTML_BYTES;
	const maxResponseBytes =
		Number.isFinite(configuredMaxBytes) && configuredMaxBytes > 0
			? Math.floor(configuredMaxBytes)
			: DEFAULT_MAX_DASHBOARD_HTML_BYTES;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		let response: Response;
		try {
			response = await (options.fetchImpl ?? fetch)(url, {
				method: "GET",
				headers: { Accept: "text/html" },
				redirect: "error",
				signal: controller.signal,
			});
		} catch {
			if (controller.signal.aborted) {
				throw new Error("Hermes Dashboard token discovery timed out");
			}
			throw new Error("Hermes Dashboard token discovery failed");
		}
		if (!response.ok) {
			throw new Error(`Hermes Dashboard token discovery failed (${response.status})`);
		}
		let html: string;
		try {
			html = await readBoundedDashboardHtml(response, controller, maxResponseBytes);
		} catch (error) {
			if (error instanceof Error && error.message === RESPONSE_SIZE_ERROR) throw error;
			if (controller.signal.aborted) {
				throw new Error("Hermes Dashboard token discovery timed out");
			}
			throw new Error("Hermes Dashboard token discovery returned an unreadable response");
		}
		return extractInjectedHermesDashboardToken(html);
	} finally {
		clearTimeout(timer);
	}
}
