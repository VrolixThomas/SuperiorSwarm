import { createHash } from "node:crypto";
import type { HermesOriginProjection } from "../../shared/hermes";
import type { HermesStockSessionDetail } from "./hermes-rest-client";

type JsonRecord = Record<string, unknown>;

export interface HermesSlackTarget {
	channelId: string;
	threadId: string;
}

export interface ResolvedHermesOrigin {
	projection: HermesOriginProjection;
	target: HermesSlackTarget | null;
	originFingerprint: string;
}

export interface HermesOriginResolverOptions {
	connectionMode: "loopback" | "remote";
	senderAvailable: boolean;
	manualOpenUrl?: string | null;
}

function record(value: unknown): JsonRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

function parseOriginJson(value: unknown): JsonRecord | null {
	if (typeof value === "string") {
		if (!value || value.length > 64 * 1024) return null;
		try {
			return record(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return record(value);
}

function hasControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127;
	});
}

function validDisplayLabel(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const label = value.trim();
	if (!label || label.length > 160 || hasControlCharacter(label)) return null;
	return label;
}

function validTeamId(value: unknown): string | null {
	return typeof value === "string" && /^T[A-Z0-9]{2,31}$/.test(value) ? value : null;
}

function validChannelId(value: unknown): string | null {
	return typeof value === "string" && /^[CDG][A-Z0-9]{2,31}$/.test(value) ? value : null;
}

function validThreadId(value: unknown): string | null {
	return typeof value === "string" && /^\d{1,16}\.\d{1,9}$/.test(value) ? value : null;
}

function reconcileRouteValue(values: Array<string | null>): {
	value: string | null;
	ambiguous: boolean;
} {
	const candidates = [...new Set(values.filter((value): value is string => value !== null))];
	return {
		value: candidates.length === 1 ? (candidates[0] ?? null) : null,
		ambiguous: candidates.length > 1,
	};
}

function stringValue(...values: unknown[]): string | null {
	return (
		values.find((value): value is string => typeof value === "string" && value.length > 0) ?? null
	);
}

function parseStockSlackSessionKey(value: string | null): {
	teamId: string | null;
	channelId: string | null;
	threadId: string | null;
} {
	if (!value || value.length > 1_024 || hasControlCharacter(value)) {
		return { teamId: null, channelId: null, threadId: null };
	}
	const parts = value.split(":");
	const slackIndex = parts.indexOf("slack");
	if (slackIndex < 0) return { teamId: null, channelId: null, threadId: null };
	const tail = parts.slice(slackIndex + 1);
	if (tail.length < 3) return { teamId: null, channelId: null, threadId: null };
	const identifiers = tail.slice(1);
	return {
		teamId: identifiers.map(validTeamId).find(Boolean) ?? null,
		channelId: identifiers.map(validChannelId).find(Boolean) ?? null,
		threadId: identifiers.map(validThreadId).find(Boolean) ?? null,
	};
}

function slackAppThreadUrl(teamId: string, channelId: string, threadId: string): string {
	return `https://app.slack.com/client/${teamId}/${channelId}/thread-${channelId}-${threadId.replace(".", "")}`;
}

export function validateManualSlackThreadUrl(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.username || url.password) return null;
	const hostname = url.hostname.toLowerCase();
	const appUrl = hostname === "app.slack.com" && url.pathname.startsWith("/client/");
	const workspaceUrl =
		/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.slack\.com$/.test(hostname) &&
		url.pathname.startsWith("/archives/");
	if (!appUrl && !workspaceUrl) return null;
	url.hash = "";
	return url.toString();
}

function fingerprint(parts: Array<string | null>): string {
	return createHash("sha256")
		.update(parts.map((part) => part ?? "").join("\0"))
		.digest("hex");
}

export function resolveHermesOrigin(
	detail: HermesStockSessionDetail,
	options: HermesOriginResolverOptions
): ResolvedHermesOrigin {
	const rawSource = detail.source.trim().toLowerCase();
	const source = /^[a-z0-9][a-z0-9._-]{0,63}$/.test(rawSource) ? rawSource : "unknown";
	if (source !== "slack") {
		return {
			projection: {
				platform: source,
				displayLabel: validDisplayLabel(detail.displayName),
				hasThread: false,
				canOpenThread: false,
				canReport: false,
				openUrl: null,
			},
			target: null,
			originFingerprint: fingerprint([source, detail.durableSessionId]),
		};
	}

	const origin = parseOriginJson(detail.originJson);
	const originPlatform = stringValue(origin?.["platform"]);
	const structuredOriginIsSlack = !originPlatform || originPlatform.toLowerCase() === "slack";
	const fallback = parseStockSlackSessionKey(detail.sessionKey);
	const team = structuredOriginIsSlack
		? reconcileRouteValue([
				validTeamId(origin?.["scope_id"] ?? origin?.["team_id"] ?? origin?.["guild_id"]),
				fallback.teamId,
			])
		: { value: null, ambiguous: false };
	const channel = structuredOriginIsSlack
		? reconcileRouteValue([
				validChannelId(detail.chatId),
				validChannelId(origin?.["chat_id"]),
				fallback.channelId,
			])
		: { value: null, ambiguous: false };
	const thread = structuredOriginIsSlack
		? reconcileRouteValue([
				validThreadId(detail.threadId),
				validThreadId(origin?.["thread_id"]),
				fallback.threadId,
			])
		: { value: null, ambiguous: false };
	const teamId = team.value;
	const channelId = channel.value;
	const threadId = thread.value;
	const routeAmbiguous = team.ambiguous || channel.ambiguous || thread.ambiguous;
	const target = !routeAmbiguous && channelId && threadId ? { channelId, threadId } : null;
	const generatedUrl =
		teamId && channelId && threadId ? slackAppThreadUrl(teamId, channelId, threadId) : null;
	const manualUrl = options.manualOpenUrl
		? validateManualSlackThreadUrl(options.manualOpenUrl)
		: null;
	const openUrl = routeAmbiguous ? null : (generatedUrl ?? manualUrl);
	const originFingerprint = fingerprint([
		"slack",
		teamId,
		channelId,
		threadId,
		routeAmbiguous ? "ambiguous" : null,
	]);

	return {
		projection: {
			platform: "slack",
			displayLabel: validDisplayLabel(detail.displayName) ?? "Slack",
			hasThread: !thread.ambiguous && threadId !== null,
			canOpenThread: openUrl !== null,
			canReport:
				options.connectionMode === "loopback" && options.senderAvailable && target !== null,
			openUrl,
		},
		target,
		originFingerprint,
	};
}
