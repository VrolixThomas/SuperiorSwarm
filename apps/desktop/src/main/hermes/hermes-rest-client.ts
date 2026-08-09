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
		readonly status: number | null = null
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

	async listSessions(signal?: AbortSignal): Promise<HermesSessionSummary[]> {
		let payload: unknown;
		try {
			payload = await this.requestJson(
				"/api/profiles/sessions/sidebar",
				{
					recents_profile: "all",
					recents_limit: "500",
					cron_limit: "500",
					messaging_limit: "500",
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
					order: "latest",
				},
				signal
			);
			const page = normalizeHermesMessagePage(payload, 500);
			resolvedDurableSessionId = page.durableSessionId;
			pages.unshift(page.messages);
			offset += page.messages.length;
			if (!page.hasMore) {
				const byId = new Map<string, HermesSessionHistory["messages"][number]>();
				for (const message of pages.flat()) byId.set(message.id, message);
				return normalizeHermesHistory(resolvedDurableSessionId, [...byId.values()]);
			}
		}
		throw new HermesRestError(
			"Hermes transcript exceeded the configured pagination bound",
			"transcript-too-large"
		);
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
		externalSignal?: AbortSignal
	): Promise<unknown> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.timeoutMs);
		const onExternalAbort = () => controller.abort();
		externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
		let response: Response;
		try {
			response = await this.fetchImpl(this.requestUrl(pathname, query), {
				method: "GET",
				headers: {
					Accept: "application/json",
					"X-Hermes-Session-Token": this.token,
				},
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
				response.status
			);
		}

		try {
			return await response.json();
		} catch {
			throw new HermesRestError("Hermes Dashboard returned malformed JSON", "malformed-response");
		}
	}
}
