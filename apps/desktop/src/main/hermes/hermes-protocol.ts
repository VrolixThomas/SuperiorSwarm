import {
	HERMES_WORKSPACE_ARTIFACT_KIND,
	type HermesInteractionChoiceDto,
	type HermesOriginProjection,
	type HermesRuntimeEvent,
	type HermesSessionBinding,
	type HermesSessionHistory,
	type HermesSessionSummary,
	type HermesTranscriptMessage,
	type HermesWorkspaceArtifact,
} from "../../shared/hermes";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as JsonRecord)
		: null;
}

function stringValue(...values: unknown[]): string | null {
	for (const value of values) {
		if (typeof value === "string" && value.length > 0) return value;
	}
	return null;
}

function numberValue(...values: unknown[]): number | null {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim()) {
			const numeric = Number(value);
			if (Number.isFinite(numeric)) return numeric;
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return null;
}

function timestampValue(...values: unknown[]): number {
	const value = numberValue(...values) ?? 0;
	return value > 0 && value < 10_000_000_000 ? value * 1_000 : value;
}

function booleanValue(defaultValue: boolean, ...values: unknown[]): boolean {
	for (const value of values) {
		if (typeof value === "boolean") return value;
		if (value === 0 || value === "false") return false;
		if (value === 1 || value === "true") return true;
	}
	return defaultValue;
}

function optionalBooleanValue(...values: unknown[]): boolean | null {
	for (const value of values) {
		if (typeof value === "boolean") return value;
		if (value === 0 || value === "false") return false;
		if (value === 1 || value === "true") return true;
	}
	return null;
}

const SENSITIVE_KEY =
	/(token|secret|credential|authorization|password|cookie|origin_json|session_key|chat_id|thread_id|user_id|team_id|scope_id|guild_id|route)/i;

function sanitizeString(value: string): string {
	return value
		.replace(
			/([?&](?:token|ticket|internal|signature|sig|x-amz-signature|x-goog-signature|x-amz-credential|x-amz-security-token|access_token)=)[^&\s]+/gi,
			"$1[redacted]"
		)
		.replace(/(\bAuthorization\s*:\s*)(?:Bearer|Basic)\s+[^\s,"';]+/gi, "$1[redacted]")
		.replace(
			/(\b(?:api[-_]?key|token|secret|credential|authorization|password|cookie)\b\s*[:=]\s*)(["']?)[^\s,"';]+\2/gi,
			"$1[redacted]"
		)
		.replace(
			/(--(?:api[-_]?key|token|secret|credential|authorization|password|cookie)\s+)(["']?)[^\s,"';]+\2/gi,
			"$1[redacted]"
		)
		.replace(/(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "[redacted]");
}

function sanitizedStringValue(...values: unknown[]): string | null {
	const value = stringValue(...values);
	return value === null ? null : sanitizeString(value);
}

export function sanitizeHermesPayload(value: unknown): unknown {
	if (typeof value === "string") return sanitizeString(value);
	if (Array.isArray(value)) return value.map(sanitizeHermesPayload);
	const values = record(value);
	if (!values) return value;
	const sanitized: JsonRecord = {};
	for (const [key, child] of Object.entries(values)) {
		if (SENSITIVE_KEY.test(key)) continue;
		sanitized[key] = sanitizeHermesPayload(child);
	}
	return sanitized;
}

function isWorkspaceArtifact(value: unknown): value is HermesWorkspaceArtifact {
	const candidate = record(value);
	return (
		candidate?.["kind"] === HERMES_WORKSPACE_ARTIFACT_KIND &&
		typeof candidate["workspaceId"] === "string" &&
		candidate["workspaceId"].length > 0 &&
		typeof candidate["projectId"] === "string" &&
		candidate["projectId"].length > 0 &&
		typeof candidate["branch"] === "string" &&
		candidate["branch"].length > 0 &&
		typeof candidate["worktreePath"] === "string" &&
		candidate["worktreePath"].length > 0
	);
}

function normalizeWorkspaceArtifact(value: HermesWorkspaceArtifact): HermesWorkspaceArtifact {
	return {
		kind: HERMES_WORKSPACE_ARTIFACT_KIND,
		workspaceId: sanitizeString(value.workspaceId),
		projectId: sanitizeString(value.projectId),
		branch: sanitizeString(value.branch),
		worktreePath: sanitizeString(value.worktreePath),
	};
}

export type HermesArtifactExtractionSource = "trusted-envelope" | "tool-event" | "history-message";

export function extractWorkspaceArtifacts(
	value: unknown,
	source: HermesArtifactExtractionSource = "trusted-envelope"
): HermesWorkspaceArtifact[] {
	const found = new Map<string, HermesWorkspaceArtifact>();
	const add = (candidate: unknown) => {
		if (!isWorkspaceArtifact(candidate)) return;
		const artifact = normalizeWorkspaceArtifact(candidate);
		found.set(`${artifact.projectId}:${artifact.workspaceId}`, artifact);
	};
	const addProjection = (candidate: unknown) => {
		add(candidate);
		const projection = record(candidate);
		if (!projection) return;
		add(projection["artifact"]);
		if (Array.isArray(projection["artifacts"])) {
			for (const artifact of projection["artifacts"]) add(artifact);
		}
	};
	const envelope = record(value);
	if (!envelope) return [];
	addProjection(envelope["structuredContent"]);
	addProjection(envelope["structured_content"]);
	for (const key of ["tool_result", "toolResult", "result"] as const) {
		const result = record(envelope[key]);
		if (!result) continue;
		addProjection(result);
		addProjection(result["structuredContent"]);
		addProjection(result["structured_content"]);
	}
	if (source === "history-message") {
		addProjection(envelope["metadata"]);
	}
	return [...found.values()];
}

function safeIdentifier(...values: unknown[]): string | null {
	const value = stringValue(...values);
	const hasControlCharacter = value
		? Array.from(value).some((character) => {
				const code = character.charCodeAt(0);
				return code < 32 || code === 127;
			})
		: false;
	if (!value || value.length > 512 || hasControlCharacter) return null;
	return value;
}

function contentText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (typeof part === "string") return part;
			return stringValue(record(part)?.["text"], record(part)?.["content"]) ?? "";
		})
		.join("");
}

function stockOriginProjection(session: JsonRecord, source: string): HermesOriginProjection | null {
	if (source !== "slack") return null;
	return {
		platform: "slack",
		displayLabel: sanitizedStringValue(session["display_name"]) ?? "Slack",
		hasThread: safeIdentifier(session["thread_id"]) !== null,
		canOpenThread: false,
		canReport: false,
		openUrl: null,
	};
}

function sessionRows(value: unknown): unknown[] {
	const root = record(value);
	if (!root) return [];
	if (Array.isArray(root["sessions"])) return root["sessions"];
	const sections = ["recents", "cron", "messaging"];
	return sections.flatMap((section) => {
		const payload = record(root[section]);
		return Array.isArray(payload?.["sessions"]) ? payload["sessions"] : [];
	});
}

/** Normalize stock Dashboard REST session lists without forwarding routing metadata. */
export function normalizeHermesSessionList(
	value: unknown,
	defaultProfileId: string
): HermesSessionSummary[] {
	const deduped = new Map<string, HermesSessionSummary>();
	const ambiguousIds = new Set<string>();
	for (const row of sessionRows(value)) {
		const session = record(row);
		const id = safeIdentifier(session?.["id"], session?.["stored_session_id"]);
		if (!session || !id || ambiguousIds.has(id)) continue;
		const source = stringValue(session["source"]) ?? "local";
		const status = stringValue(session["status"]);
		const summary: HermesSessionSummary = {
			id,
			title: sanitizedStringValue(session["title"]) ?? "Untitled session",
			preview: sanitizedStringValue(session["preview"], session["summary"]) ?? "",
			profileId: safeIdentifier(session["profile"], session["profile_name"]) ?? defaultProfileId,
			source: sanitizeString(source),
			updatedAt: timestampValue(
				session["last_active"],
				session["updated_at"],
				session["ended_at"],
				session["started_at"]
			),
			createdAt: timestampValue(session["started_at"], session["created_at"]),
			archived: booleanValue(false, session["archived"]),
			running: booleanValue(status === "streaming", session["running"], session["is_active"]),
			busy: booleanValue(status === "busy" || status === "queued", session["busy"]),
			waitingForUser: booleanValue(status === "waiting_for_user", session["waiting_for_user"]),
			messageCount: numberValue(session["message_count"]) ?? 0,
			origin: stockOriginProjection(session, source),
		};
		const existing = deduped.get(id);
		if (existing && existing.profileId !== summary.profileId) {
			deduped.delete(id);
			ambiguousIds.add(id);
			continue;
		}
		if (!existing || summary.updatedAt >= existing.updatedAt) deduped.set(id, summary);
	}
	return [...deduped.values()];
}

function normalizeTranscriptMessage(value: unknown, index: number): HermesTranscriptMessage | null {
	const message = record(value);
	if (!message) return null;
	const rawRole = stringValue(message["role"]) ?? "system";
	const role = ["user", "assistant", "system", "tool"].includes(rawRole)
		? (rawRole as HermesTranscriptMessage["role"])
		: "system";
	const text =
		stringValue(message["text"]) ?? contentText(message["content"] ?? message["message"]);
	return {
		id: safeIdentifier(message["id"], message["message_id"]) ?? `history-${index}`,
		turnId: safeIdentifier(message["turn_id"], message["turnId"]),
		role,
		text: sanitizeString(text),
		createdAt:
			numberValue(message["created_at"], message["timestamp"]) === null
				? null
				: timestampValue(message["created_at"], message["timestamp"]),
		status: sanitizedStringValue(message["status"]),
		toolName: sanitizedStringValue(message["tool_name"], message["name"]),
		workspaceArtifacts: extractWorkspaceArtifacts(message, "history-message"),
	};
}

export interface HermesMessagePage {
	durableSessionId: string;
	messages: HermesTranscriptMessage[];
	total: number | null;
	hasMore: boolean;
}

export function normalizeHermesMessagePage(
	value: unknown,
	requestedLimit: number
): HermesMessagePage {
	const root = record(value);
	if (!root) throw new Error("Hermes returned an invalid messages page");
	const durableSessionId = safeIdentifier(
		root["session_id"],
		root["stored_session_id"],
		root["durable_session_id"]
	);
	if (!durableSessionId) throw new Error("Hermes messages page omitted the durable session ID");
	const rows = Array.isArray(root["messages"]) ? root["messages"] : [];
	const messages = rows.flatMap((message, index) => {
		const normalized = normalizeTranscriptMessage(message, index);
		return normalized ? [normalized] : [];
	});
	const pagination = record(root["pagination"]);
	const offset = numberValue(pagination?.["offset"], root["offset"]) ?? 0;
	const total = numberValue(root["total"], pagination?.["total"]);
	const explicitHasMore = optionalBooleanValue(
		pagination?.["has_more"],
		pagination?.["hasMore"],
		root["has_more"],
		root["hasMore"]
	);
	return {
		durableSessionId,
		messages,
		total,
		hasMore:
			explicitHasMore ??
			(total === null ? messages.length >= requestedLimit : offset + messages.length < total),
	};
}

export function normalizeHermesHistory(
	durableSessionId: string,
	messages: HermesTranscriptMessage[]
): HermesSessionHistory {
	return { durableSessionId, messages };
}

export function normalizeHermesSessionBinding(
	value: unknown,
	requestedDurableSessionId?: string,
	requestedProfileId?: string
): HermesSessionBinding {
	const result = record(value);
	if (!result) throw new Error("Hermes returned an invalid session binding");
	const runtimeSessionId = safeIdentifier(
		result["runtime_session_id"],
		result["session_id"],
		result["sessionId"]
	);
	if (!runtimeSessionId) throw new Error("Hermes returned an invalid runtime session");
	const durableSessionId = safeIdentifier(
		result["stored_session_id"],
		result["session_key"],
		result["resumed"],
		requestedDurableSessionId
	);
	if (!durableSessionId) throw new Error("Hermes response omitted the durable session identity");
	return {
		runtimeSessionId,
		durableSessionId,
		profileId:
			safeIdentifier(result["profile"], result["profile_name"], requestedProfileId) ?? "default",
		persisted: requestedDurableSessionId !== undefined,
	};
}

function normalizeInteractionChoices(value: unknown): HermesInteractionChoiceDto[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((choice) => {
		if (typeof choice === "string") {
			const safe = sanitizeString(choice);
			return safe ? [{ value: safe, label: safe }] : [];
		}
		const item = record(choice);
		const rawValue = stringValue(item?.["value"]);
		if (!item || !rawValue) return [];
		const safeValue = sanitizeString(rawValue);
		return [
			{
				value: safeValue,
				label: sanitizedStringValue(item["label"], item["description"], item["title"]) ?? safeValue,
			},
		];
	});
}

export function normalizeHermesEvent(value: unknown): HermesRuntimeEvent | null {
	const envelope = record(value);
	if (!envelope || envelope["method"] !== "event") return null;
	const params = record(envelope["params"]);
	const payload = record(params?.["payload"]) ?? {};
	const type = stringValue(params?.["type"], payload["type"]);
	if (!type) return null;
	let text = sanitizedStringValue(payload["text"], payload["message"]);
	if (type === "approval.request") {
		const description = sanitizedStringValue(payload["description"]);
		const command = sanitizedStringValue(payload["command"]);
		if (description && command) text = `${description}\n\nCommand:\n${command}`;
		else text = description ?? command ?? text;
	} else if (type === "clarify.request") {
		text = sanitizedStringValue(payload["question"]) ?? text;
	}
	const choices = normalizeInteractionChoices(payload["choices"]);
	return {
		type: sanitizeString(type),
		runtimeSessionId: safeIdentifier(
			params?.["session_id"],
			params?.["sessionId"],
			payload["session_id"],
			payload["sessionId"]
		),
		durableSessionId: null,
		turnId: safeIdentifier(payload["turn_id"], payload["turnId"]),
		requestId: safeIdentifier(payload["request_id"], payload["requestId"], payload["tool_call_id"]),
		text,
		toolName: sanitizedStringValue(payload["tool_name"], payload["toolName"], payload["name"]),
		status: sanitizedStringValue(payload["status"]),
		payload: choices.length > 0 ? { choices } : {},
		workspaceArtifacts: extractWorkspaceArtifacts(payload, "tool-event"),
		receivedAt: Date.now(),
	};
}
