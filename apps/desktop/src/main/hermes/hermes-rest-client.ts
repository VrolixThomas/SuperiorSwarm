import type { HermesSessionHistory, HermesSessionSummary } from "../../shared/hermes";
import {
	normalizeHermesHistory,
	normalizeHermesMessagePage,
	normalizeHermesSessionList,
	sanitizeHermesPayload,
} from "./hermes-protocol";

type JsonRecord = Record<string, unknown>;

export type HermesRestErrorKind =
	| "unauthorized"
	| "not-found"
	| "http"
	| "timeout"
	| "network"
	| "malformed-response"
	| "transcript-too-large";

export class HermesRestError extends Error {
	constructor(
		message: string,
		readonly kind: HermesRestErrorKind,
		readonly status: number | null = null,
		readonly backendHint: string | null = null
	) {
		super(message);
		this.name = "HermesRestError";
	}
}

export interface HermesStockSessionDetail {
	durableSessionId: string;
	profileId: string;
	source: string;
	displayName: string | null;
	sessionKey: string | null;
	chatId: string | null;
	chatType: string | null;
	threadId: string | null;
	originJson: unknown;
}

export interface HermesRestClientOptions {
	baseUrl: string;
	profileId: string;
	token: string;
	fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	maxTranscriptPages?: number;
}

function record(value: unknown): JsonRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

function stringValue(...values: unknown[]): string | null {
	return (
		values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null
	);
}

function safeMessage(value: unknown, fallback: string): string {
	const sanitized = sanitizeHermesPayload(value instanceof Error ? value.message : value);
	return typeof sanitized === "string" && sanitized ? sanitized : fallback;
}

function safeBackendHint(value: unknown): string | null {
	const sanitized = sanitizeHermesPayload(value);
	try {
		const hint = typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
		return hint ? hint.slice(0, 2_000) : null;
	} catch {
		return null;
	}
}

function isUnsupportedDurableView(error: unknown): boolean {
	if (
		!(error instanceof HermesRestError) ||
		!error.status ||
		![400, 422].includes(error.status) ||
		!error.backendHint
	) {
		return false;
	}
	let payload: unknown = error.backendHint;
	try {
		payload = JSON.parse(error.backendHint);
	} catch {
		// Plain-text backend errors are matched by the same exact phrase below.
	}
	const root = record(payload);
	const detail = root?.["detail"];
	if (
		Array.isArray(detail) &&
		detail.some((item) => {
			const validation = record(item);
			const location = validation?.["loc"];
			return (
				validation?.["type"] === "extra_forbidden" &&
				Array.isArray(location) &&
				location.length === 2 &&
				location[0] === "query" &&
				location[1] === "view"
			);
		})
	) {
		return true;
	}
	const strings: string[] = [];
	const visit = (value: unknown) => {
		if (typeof value === "string") {
			strings.push(value);
			return;
		}
		if (Array.isArray(value)) {
			for (const child of value) visit(child);
			return;
		}
		const values = record(value);
		if (values) {
			for (const child of Object.values(values)) visit(child);
		}
	};
	visit(payload);
	return strings.some((value) =>
		/\b(?:unknown|unsupported|unrecognized) query parameter(?:\s+(?:named|called))?\s*(?::|=)?\s*["'`]?view["'`]?(?:\b|$)/i.test(
			value
		)
	);
}

function dashboardBaseUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol === "ws:") url.protocol = "http:";
	if (url.protocol === "wss:") url.protocol = "https:";
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new HermesRestError("Hermes Dashboard URL must use HTTP or HTTPS", "network");
	}
	url.username = "";
	url.password = "";
	url.hash = "";
	url.search = "";
	if (url.pathname.endsWith("/api/ws")) url.pathname = url.pathname.slice(0, -7) || "/";
	return url;
}

export class HermesRestClient {
	private readonly baseUrl: URL;
	private readonly profileId: string;
	private readonly token: string;
	private readonly fetchImpl: NonNullable<HermesRestClientOptions["fetchImpl"]>;
	private readonly timeoutMs: number;
	private readonly maxTranscriptPages: number;

	constructor(options: HermesRestClientOptions) {
		this.baseUrl = dashboardBaseUrl(options.baseUrl);
		this.profileId = options.profileId;
		this.token = options.token;
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.timeoutMs = options.timeoutMs ?? 15_000;
		this.maxTranscriptPages = options.maxTranscriptPages ?? 200;
	}

	async status(signal?: AbortSignal): Promise<unknown> {
		return await this.requestJson("/api/status", {}, signal);
	}

	async listSessions(signal?: AbortSignal): Promise<HermesSessionSummary[]> {
		let payload: unknown;
		try {
			payload = await this.requestJson(
				"/api/profiles/sessions/sidebar",
				{
					recents_profile: "all",
					recents_limit: "500",
					recents_exclude:
						"cron,kanban,subagent,tool,telegram,discord,slack,mattermost,matrix,signal,whatsapp,bluebubbles,photon,homeassistant,email,sms,webhook,api_server,weixin,wecom,qqbot,yuanbao,dingtalk,feishu",
					cron_limit: "500",
					messaging_limit: "500",
					messaging_exclude:
						"cron,cli,codex,desktop,gateway,kanban,local,tui,superiorswarm,tool,subagent",
				},
				signal
			);
		} catch (error) {
			if (
				!(error instanceof HermesRestError) ||
				!error.status ||
				![404, 405, 501].includes(error.status)
			) {
				throw error;
			}
			payload = await this.requestJson(
				"/api/profiles/sessions",
				{
					profile: "all",
					limit: "500",
					offset: "0",
					order: "recent",
					archived: "include",
				},
				signal
			);
		}
		return normalizeHermesSessionList(payload, this.profileId).sort(
			(left, right) => right.updatedAt - left.updatedAt
		);
	}

	async setSessionArchived(
		durableSessionId: string,
		profileId: string,
		archived: boolean,
		signal?: AbortSignal
	): Promise<void> {
		await this.requestJson(
			`/api/sessions/${encodeURIComponent(durableSessionId)}`,
			{ profile: profileId },
			signal,
			{ method: "PATCH", body: { archived } }
		);
	}

	async deleteSession(
		durableSessionId: string,
		profileId = this.profileId,
		signal?: AbortSignal
	): Promise<void> {
		await this.requestJson(
			`/api/sessions/${encodeURIComponent(durableSessionId)}`,
			{ profile: profileId },
			signal,
			{ method: "DELETE" }
		);
	}

	async getSessionDetail(
		durableSessionId: string,
		profileId = this.profileId,
		signal?: AbortSignal
	): Promise<HermesStockSessionDetail> {
		const payload = record(
			await this.requestJson(
				`/api/sessions/${encodeURIComponent(durableSessionId)}`,
				{ profile: profileId },
				signal
			)
		);
		if (!payload) {
			throw new HermesRestError("Hermes returned malformed session detail", "malformed-response");
		}
		const resolvedId = stringValue(payload["id"], payload["stored_session_id"]);
		if (!resolvedId) {
			throw new HermesRestError(
				"Hermes session detail omitted the durable session ID",
				"malformed-response"
			);
		}
		return {
			durableSessionId: resolvedId,
			profileId: stringValue(payload["profile"], payload["profile_name"]) ?? profileId,
			source: stringValue(payload["source"]) ?? "local",
			displayName: stringValue(payload["display_name"]),
			sessionKey: stringValue(payload["session_key"]),
			chatId: stringValue(payload["chat_id"]),
			chatType: stringValue(payload["chat_type"]),
			threadId: stringValue(payload["thread_id"]),
			originJson: payload["origin_json"] ?? null,
		};
	}

	async getTranscript(
		durableSessionId: string,
		profileId = this.profileId,
		signal?: AbortSignal
	): Promise<HermesSessionHistory> {
		try {
			return await this.getDurableTranscript(durableSessionId, profileId, signal);
		} catch (error) {
			if (!isUnsupportedDurableView(error)) throw error;
			return await this.getActiveTranscript(durableSessionId, profileId, signal);
		}
	}

	private async getDurableTranscript(
		durableSessionId: string,
		profileId: string,
		signal?: AbortSignal
	): Promise<HermesSessionHistory> {
		const pages: HermesSessionHistory["messages"][] = [];
		let offset = 0;
		let resolvedDurableSessionId = durableSessionId;
		for (let pageIndex = 0; pageIndex < this.maxTranscriptPages; pageIndex++) {
			const payload = await this.requestJson(
				`/api/sessions/${encodeURIComponent(durableSessionId)}/messages`,
				{
					profile: profileId,
					limit: "500",
					offset: String(offset),
					order: "oldest",
					view: "durable",
				},
				signal
			);
			const page = this.normalizeMessagePage(payload, 500);
			const responseView = record(payload)?.["view"];
			if (pageIndex === 0 && (responseView === undefined || responseView === "active")) {
				return await this.getActiveTranscript(durableSessionId, profileId, signal);
			}
			if (responseView !== "durable") {
				throw new HermesRestError(
					"Hermes returned an unknown transcript view",
					"malformed-response"
				);
			}
			resolvedDurableSessionId = page.durableSessionId;
			if (page.hasMore && page.returned === 0) {
				throw new HermesRestError(
					"Hermes transcript pagination made no progress",
					"malformed-response"
				);
			}
			pages.push(page.messages);
			offset += page.returned;
			if (page.returned < 500 || (page.hasMoreIsAuthoritative && !page.hasMore)) {
				return normalizeHermesHistory(resolvedDurableSessionId, pages.flat(), "durable");
			}
		}
		throw new HermesRestError(
			"Hermes transcript exceeded the configured pagination bound",
			"transcript-too-large"
		);
	}

	private async getActiveTranscript(
		durableSessionId: string,
		profileId: string,
		signal?: AbortSignal
	): Promise<HermesSessionHistory> {
		const pages: HermesSessionHistory["messages"][] = [];
		let offset = 0;
		let resolvedDurableSessionId = durableSessionId;
		for (let pageIndex = 0; pageIndex < this.maxTranscriptPages; pageIndex++) {
			const payload = await this.requestJson(
				`/api/sessions/${encodeURIComponent(durableSessionId)}/messages`,
				{
					profile: profileId,
					limit: "500",
					offset: String(offset),
				},
				signal
			);
			const page = this.normalizeMessagePage(payload, 500);
			resolvedDurableSessionId = page.durableSessionId;
			if (page.hasMore && page.returned === 0) {
				throw new HermesRestError(
					"Hermes transcript pagination made no progress",
					"malformed-response"
				);
			}
			pages.push(page.messages);
			offset += page.returned;
			if (!page.hasMore) {
				const byId = new Map<string, HermesSessionHistory["messages"][number]>();
				for (const message of pages.flat()) byId.set(message.id, message);
				return normalizeHermesHistory(resolvedDurableSessionId, [...byId.values()], "active");
			}
		}
		throw new HermesRestError(
			"Hermes transcript exceeded the configured pagination bound",
			"transcript-too-large"
		);
	}

	private normalizeMessagePage(payload: unknown, requestedLimit: number) {
		const root = record(payload);
		if (!root || (!Array.isArray(root["messages"]) && !Array.isArray(root["data"]))) {
			throw new HermesRestError("Hermes returned a malformed messages page", "malformed-response");
		}
		try {
			return normalizeHermesMessagePage(payload, requestedLimit);
		} catch (error) {
			throw new HermesRestError(
				safeMessage(error, "Hermes returned a malformed messages page"),
				"malformed-response"
			);
		}
	}

	private requestUrl(pathname: string, query: Record<string, string>): URL {
		const url = new URL(this.baseUrl);
		const prefix = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
		url.pathname = `${prefix}${pathname}`;
		url.search = "";
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		return url;
	}

	private async requestJson(
		pathname: string,
		query: Record<string, string>,
		externalSignal?: AbortSignal,
		request: { method?: "GET" | "PATCH" | "DELETE"; body?: JsonRecord } = {}
	): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		const onExternalAbort = () => controller.abort();
		externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
		let response: Response;
		try {
			const body = request.body === undefined ? undefined : JSON.stringify(request.body);
			response = await this.fetchImpl(this.requestUrl(pathname, query), {
				method: request.method ?? "GET",
				headers: {
					Accept: "application/json",
					...(body === undefined ? {} : { "Content-Type": "application/json" }),
					"X-Hermes-Session-Token": this.token,
				},
				body,
				signal: controller.signal,
			});
		} catch (error) {
			if (controller.signal.aborted) {
				throw new HermesRestError("Hermes Dashboard request timed out or was cancelled", "timeout");
			}
			throw new HermesRestError(safeMessage(error, "Hermes Dashboard request failed"), "network");
		} finally {
			clearTimeout(timer);
			externalSignal?.removeEventListener("abort", onExternalAbort);
		}

		if (!response.ok) {
			let backendHint: string | null = null;
			try {
				backendHint = safeBackendHint(await response.clone().json());
			} catch {
				// The HTTP status remains authoritative when the error body is not JSON.
			}
			const kind: HermesRestErrorKind =
				response.status === 401 || response.status === 403
					? "unauthorized"
					: response.status === 404
						? "not-found"
						: "http";
			throw new HermesRestError(
				kind === "unauthorized"
					? "Hermes Dashboard authentication failed"
					: `Hermes Dashboard request failed (${response.status})`,
				kind,
				response.status,
				backendHint
			);
		}

		if (response.status === 204) return null;

		try {
			return await response.json();
		} catch {
			throw new HermesRestError("Hermes Dashboard returned malformed JSON", "malformed-response");
		}
	}
}
