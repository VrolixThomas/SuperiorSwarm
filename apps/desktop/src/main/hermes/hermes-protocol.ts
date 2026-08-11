import {
	HERMES_WORKSPACE_ARTIFACT_KIND,
	type HermesActiveTurnSnapshot,
	type HermesInteractionChoiceDto,
	type HermesOriginProjection,
	type HermesRuntimeEvent,
	type HermesSessionBinding,
	type HermesSessionHistory,
	type HermesSessionSummary,
	type HermesTranscriptMessage,
	type HermesWorkspaceArtifact,
	hermesSessionIdentityKey,
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

export function sanitizeHermesDisplayLabel(
	value: unknown,
	suppressedValues: Iterable<unknown> = []
): string | null {
	if (typeof value !== "string") return null;
	const rawLabel = value.trim();
	if (!rawLabel) return null;
	for (const suppressed of suppressedValues) {
		if (typeof suppressed === "string" && suppressed.trim() === rawLabel) return null;
		if (typeof suppressed === "number" && String(suppressed) === rawLabel) return null;
	}
	const label = sanitizeString(rawLabel);
	if (!label || label.length > 160 || safeIdentifier(label) === null) return null;
	return label;
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

function normalizedSource(value: unknown): string {
	const source = stringValue(value)?.trim().toLowerCase() ?? "local";
	return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(source) ? source : "unknown";
}

function parseStockOrigin(value: unknown): JsonRecord | null {
	if (typeof value !== "string") return record(value);
	if (!value || value.length > 64 * 1024) return null;
	try {
		return record(JSON.parse(value));
	} catch {
		return null;
	}
}

function safeDisplayValue(
	suppressedValues: Iterable<unknown>,
	...values: unknown[]
): string | null {
	for (const value of values) {
		const label = sanitizeHermesDisplayLabel(value, suppressedValues);
		if (label) return label;
	}
	return null;
}

function sourceDisplayLabel(source: string): string {
	return source.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function stockOriginProjection(session: JsonRecord, source: string): HermesOriginProjection {
	const rawOrigin = parseStockOrigin(session["origin_json"]);
	const originPlatform = normalizedSource(rawOrigin?.["platform"]);
	const origin = originPlatform === source ? rawOrigin : null;
	const routeValues = [
		session["session_key"],
		session["chat_id"],
		session["thread_id"],
		origin?.["scope_id"],
		origin?.["team_id"],
		origin?.["guild_id"],
		origin?.["chat_id"],
		origin?.["channel_id"],
		origin?.["thread_id"],
		origin?.["user_id"],
		origin?.["account_id"],
	];
	const chatType = stringValue(session["chat_type"], origin?.["chat_type"])?.toLowerCase();
	const chatName = safeDisplayValue(routeValues, origin?.["chat_name"]);
	const channelLabel =
		chatType === "channel"
			? safeDisplayValue(routeValues, origin?.["channel_name"], chatName)
			: null;
	const chatLabel = chatType === "channel" ? null : chatName;
	const displayLabel =
		safeDisplayValue(
			routeValues,
			session["display_name"],
			channelLabel,
			chatLabel,
			origin?.["thread_name"],
			origin?.["thread_title"],
			origin?.["chat_topic"]
		) ?? sourceDisplayLabel(source);
	return {
		platform: source,
		source,
		displayLabel,
		workspaceLabel: safeDisplayValue(
			routeValues,
			origin?.["workspace_name"],
			origin?.["team_name"],
			origin?.["guild_name"],
			origin?.["scope_name"]
		),
		accountLabel: safeDisplayValue(routeValues, origin?.["account_name"], origin?.["user_name"]),
		chatLabel,
		channelLabel,
		threadLabel: safeDisplayValue(
			routeValues,
			origin?.["thread_name"],
			origin?.["thread_title"],
			origin?.["chat_topic"]
		),
		hasThread: safeIdentifier(session["thread_id"], origin?.["thread_id"]) !== null,
		canOpenThread: false,
		canReport: false,
	};
}

interface SessionRow {
	value: unknown;
	section: "sessions" | "recents" | "cron" | "messaging";
}

function sessionRows(value: unknown): SessionRow[] {
	const root = record(value);
	if (!root) return [];
	if (Array.isArray(root["sessions"])) {
		return root["sessions"].map((row) => ({ value: row, section: "sessions" }));
	}
	const sections = ["recents", "cron", "messaging"] as const;
	return sections.flatMap((section) => {
		const payload = record(root[section]);
		return Array.isArray(payload?.["sessions"])
			? payload["sessions"].map((row) => ({ value: row, section }))
			: [];
	});
}

/** Normalize stock Dashboard REST session lists without forwarding routing metadata. */
export function normalizeHermesSessionList(
	value: unknown,
	defaultProfileId: string
): HermesSessionSummary[] {
	const deduped = new Map<string, HermesSessionSummary>();
	for (const row of sessionRows(value)) {
		const session = record(row.value);
		const id = safeIdentifier(session?.["stored_session_id"], session?.["id"]);
		if (!session || !id) continue;
		const source = normalizedSource(session["source"]);
		const isCron = row.section === "cron" || source === "cron";
		const status = stringValue(session["status"]);
		const profileId =
			safeIdentifier(session["profile"], session["profile_name"]) ?? defaultProfileId;
		const title = sanitizedStringValue(session["title"]) ?? "Untitled session";
		const summary: HermesSessionSummary = {
			id,
			title,
			generatedTitle: title,
			titleSource: "generated",
			tags: [],
			metadataRevision: 0,
			preview: sanitizedStringValue(session["preview"], session["summary"]) ?? "",
			profileId,
			source,
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
			isCron,
			handover: false,
			admissionReason: null,
			origin: source === "superiorswarm" ? null : stockOriginProjection(session, source),
		};
		const identityKey = hermesSessionIdentityKey(profileId, id);
		const existing = deduped.get(identityKey);
		if (!existing || summary.updatedAt >= existing.updatedAt) {
			deduped.set(identityKey, {
				...summary,
				handover: summary.handover || existing?.handover === true,
				origin: summary.origin ?? existing?.origin ?? null,
			});
		} else if (summary.handover && !existing.handover) {
			deduped.set(identityKey, {
				...existing,
				handover: true,
				origin: existing.origin ?? summary.origin,
			});
		}
	}
	return [...deduped.values()];
}

function transcriptMessageIdentifier(value: unknown): string | null {
	const identifier = safeIdentifier(value);
	if (identifier) return identifier;
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? String(value)
		: null;
}

const COMPACTION_SUMMARY_TYPES = new Set(["standalone", "merged", "micro", "legacy"]);

function compactionSummaryType(value: unknown): HermesTranscriptMessage["compactionSummaryType"] {
	const displayMetadata = record(value);
	const compaction = record(displayMetadata?.["compaction"]);
	const summaryType = compaction?.["summary_type"];
	return typeof summaryType === "string" && COMPACTION_SUMMARY_TYPES.has(summaryType)
		? (summaryType as HermesTranscriptMessage["compactionSummaryType"])
		: null;
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
	const rawCompactionGeneration = numberValue(message["compaction_generation"]);
	return {
		id:
			transcriptMessageIdentifier(message["id"]) ??
			transcriptMessageIdentifier(message["message_id"]) ??
			`history-${index}`,
		canonicalMessageId: transcriptMessageIdentifier(message["canonical_message_id"]),
		compactionGeneration:
			rawCompactionGeneration !== null &&
			Number.isSafeInteger(rawCompactionGeneration) &&
			rawCompactionGeneration >= 0
				? rawCompactionGeneration
				: null,
		active: optionalBooleanValue(message["active"]),
		compacted: optionalBooleanValue(message["compacted"]),
		displayKind: sanitizedStringValue(message["display_kind"]),
		compactionSummaryType: compactionSummaryType(message["display_metadata"]),
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
	returned: number;
	total: number | null;
	hasMore: boolean;
	hasMoreIsAuthoritative: boolean;
	messageIdsAreStable: boolean;
}

function paginationCount(name: string, ...values: unknown[]): number | null {
	for (const value of values) {
		if (value === null || value === undefined) continue;
		const numeric =
			typeof value === "number"
				? value
				: typeof value === "string" && value.trim()
					? Number(value)
					: Number.NaN;
		if (!Number.isFinite(numeric) || !Number.isSafeInteger(numeric) || numeric < 0) {
			throw new Error(`Hermes returned an invalid pagination ${name}`);
		}
		return numeric;
	}
	return null;
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
	const rows = Array.isArray(root["messages"])
		? root["messages"]
		: Array.isArray(root["data"])
			? root["data"]
			: [];
	const pagination = record(root["pagination"]);
	paginationCount("limit", pagination?.["limit"], root["limit"]);
	const offset = paginationCount("offset", pagination?.["offset"], root["offset"]) ?? 0;
	const messageIdsAreStable = rows.every((value) => {
		const message = record(value);
		return Boolean(
			message &&
				(transcriptMessageIdentifier(message["id"]) ??
					transcriptMessageIdentifier(message["message_id"]))
		);
	});
	const messages = rows.flatMap((message, index) => {
		const normalized = normalizeTranscriptMessage(message, offset + index);
		return normalized ? [normalized] : [];
	});
	paginationCount("returned", pagination?.["returned"], root["returned"]);
	const returned = messages.length;
	const total = paginationCount("total", root["total"], pagination?.["total"]);
	const explicitHasMore = optionalBooleanValue(
		pagination?.["has_more"],
		pagination?.["hasMore"],
		root["has_more"],
		root["hasMore"]
	);
	return {
		durableSessionId,
		messages,
		returned,
		total,
		hasMore:
			explicitHasMore ?? (total === null ? returned >= requestedLimit : offset + returned < total),
		hasMoreIsAuthoritative: explicitHasMore !== null || total !== null,
		messageIdsAreStable,
	};
}

export function normalizeHermesHistory(
	durableSessionId: string,
	messages: HermesTranscriptMessage[],
	view: HermesSessionHistory["view"]
): HermesSessionHistory {
	return { durableSessionId, view, messages };
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

export function normalizeHermesRuntimeActivity(value: unknown): {
	activeTurn: boolean | null;
	status: string | null;
} {
	const result = record(value);
	const status = sanitizedStringValue(result?.["status"])?.trim().toLowerCase() ?? null;
	const running = optionalBooleanValue(result?.["running"]);
	return {
		activeTurn:
			running ??
			(status === null
				? null
				: ["busy", "queued", "running", "streaming", "working"].includes(status)),
		status,
	};
}

export function normalizeHermesActiveTurnSnapshot(
	value: unknown,
	input: {
		durableSessionId: string;
		runtimeSessionId: string;
		eventSeq: number;
		activeTurn: boolean;
		status: string | null;
	}
): HermesActiveTurnSnapshot {
	const result = record(value);
	const rows = Array.isArray(result?.["messages"]) ? result["messages"] : [];
	const messages = rows.flatMap((row, index) => {
		const normalized = normalizeTranscriptMessage(row, index);
		return normalized ? [normalized] : [];
	});
	let lastUserIndex = -1;
	for (const [index, message] of messages.entries()) {
		if (message.role === "user") lastUserIndex = index;
	}
	const tail = input.activeTurn ? messages.slice(lastUserIndex + 1) : [];
	const turnId =
		safeIdentifier(result?.["current_turn_id"], result?.["turn_id"]) ??
		[...tail].reverse().find((message) => message.turnId)?.turnId ??
		null;
	const activeRows = turnId
		? tail.filter((message) => message.turnId === null || message.turnId === turnId)
		: tail;
	return {
		durableSessionId: input.durableSessionId,
		runtimeSessionId: input.runtimeSessionId,
		eventSeq: input.eventSeq,
		activeTurn: input.activeTurn,
		status: input.status,
		turnId,
		streamingText: activeRows
			.filter((message) => message.role === "assistant" && message.text.trim())
			.map((message) => message.text)
			.join(""),
		tools: activeRows.flatMap((message) => {
			if (message.role !== "tool" && !message.toolName) return [];
			const status = message.status?.trim().toLowerCase() ?? "";
			return [
				{
					id: message.id,
					turnId: message.turnId,
					name: message.toolName ?? "tool",
					status: ["failed", "error", "cancelled", "interrupted"].includes(status)
						? ("failed" as const)
						: ["complete", "completed", "done", "success", "succeeded"].includes(status)
							? ("complete" as const)
							: ("running" as const),
				},
			];
		}),
		pendingApproval: null,
		pendingClarification: null,
		queuedFollowUps: [],
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
		profileId: null,
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
