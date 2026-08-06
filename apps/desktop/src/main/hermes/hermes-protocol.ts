import {
	HERMES_WORKSPACE_ARTIFACT_KIND,
	type HermesCatalog,
	type HermesInteractionChoiceDto,
	type HermesRuntimeEvent,
	type HermesSessionHistory,
	type HermesTranscriptMessage,
	type HermesTurnResult,
	type HermesWorkspaceArtifact,
} from "../../shared/hermes";

export const HERMES_PROTOCOL_VERSION = 1;
export const HERMES_REQUIRED_CAPABILITIES = [
	"session.catalog",
	"session.claim",
	"session.claim_renew",
	"session.release",
	"session.origin",
	"session.report_to_origin",
] as const;

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
		if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
			return Number(value);
		}
	}
	return null;
}

function booleanValue(defaultValue: boolean, ...values: unknown[]): boolean {
	for (const value of values) {
		if (typeof value === "boolean") return value;
		if (value === 0 || value === "false") return false;
		if (value === 1 || value === "true") return true;
	}
	return defaultValue;
}

function capabilityList(value: unknown): string[] {
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	const values = record(value);
	if (!values) return [];
	return Object.entries(values)
		.filter(([, enabled]) => enabled === true)
		.map(([name]) => name);
}

function versionedCapabilityList(value: unknown): string[] {
	const values = record(value);
	if (!values) return [];
	return Object.entries(values)
		.filter(([, version]) => (numberValue(version) ?? 0) >= HERMES_PROTOCOL_VERSION)
		.map(([name]) => name);
}

const SENSITIVE_KEY = /(token|secret|credential|authorization|password|cookie|origin_json)/i;

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

export type HermesArtifactExtractionSource =
	| "trusted-envelope"
	| "tool-event"
	| "history-message"
	| "tool-artifacts-result";

export function extractWorkspaceArtifacts(
	value: unknown,
	source: HermesArtifactExtractionSource = "trusted-envelope"
): HermesWorkspaceArtifact[] {
	const found = new Map<string, HermesWorkspaceArtifact>();

	function add(candidate: unknown): void {
		if (isWorkspaceArtifact(candidate)) {
			const artifact = normalizeWorkspaceArtifact(candidate);
			found.set(`${artifact.projectId}:${artifact.workspaceId}`, artifact);
		}
	}

	function addProjection(candidate: unknown): void {
		add(candidate);
		const projection = record(candidate);
		if (!projection) return;
		add(projection["artifact"]);
		if (Array.isArray(projection["artifacts"])) {
			for (const artifact of projection["artifacts"]) add(artifact);
		}
	}

	function addStructuredContent(envelope: JsonRecord): void {
		addProjection(envelope["structuredContent"]);
		addProjection(envelope["structured_content"]);
	}

	function addResultEnvelope(candidate: unknown): void {
		addProjection(candidate);
		const envelope = record(candidate);
		if (!envelope) return;
		addStructuredContent(envelope);
	}

	const envelope = record(value);
	if (!envelope) return [];
	addStructuredContent(envelope);
	addResultEnvelope(envelope["tool_result"]);
	addResultEnvelope(envelope["toolResult"]);
	addResultEnvelope(envelope["result"]);
	if (source === "tool-artifacts-result" && Array.isArray(envelope["artifacts"])) {
		for (const artifact of envelope["artifacts"]) add(artifact);
	}
	return [...found.values()];
}

export function normalizeHermesCatalog(value: unknown, protocolInfo?: unknown): HermesCatalog {
	const root = record(value) ?? {};
	const protocol = record(root["protocol"]);
	const protocolVersion = numberValue(
		root["protocol_version"],
		root["api_version"],
		protocol?.["version"]
	);
	const protocolRoot = protocolInfo === undefined ? null : record(protocolInfo);
	const advertisedCapabilities = record(protocolRoot?.["capabilities"]);
	const sessionHandoff = record(advertisedCapabilities?.["session_handoff"]);
	const capabilities = sessionHandoff
		? versionedCapabilityList(sessionHandoff["methods"])
		: capabilityList(root["capabilities"] ?? protocol?.["capabilities"]);
	const missingCapabilities = HERMES_REQUIRED_CAPABILITIES.filter(
		(capability) => !capabilities.includes(capability)
	);
	const negotiatedVersionsCompatible =
		protocolInfo === undefined ||
		((numberValue(protocolRoot?.["version"]) ?? 0) >= HERMES_PROTOCOL_VERSION &&
			(numberValue(sessionHandoff?.["version"]) ?? 0) >= HERMES_PROTOCOL_VERSION);
	const compatible =
		protocolVersion !== null &&
		protocolVersion >= HERMES_PROTOCOL_VERSION &&
		negotiatedVersionsCompatible &&
		missingCapabilities.length === 0;
	const rawSessions = Array.isArray(root["sessions"]) ? root["sessions"] : [];
	const sessions = rawSessions.flatMap((value) => {
		const session = record(value);
		const id = stringValue(session?.["id"], session?.["session_id"]);
		if (!session || !id) return [];
		const origin = record(session["origin"]);
		const lineageTipId =
			stringValue(
				session["current_tip_id"],
				session["lineage_tip_id"],
				session["lineageTipId"],
				session["tip_id"]
			) ?? id;
		return [
			{
				id,
				lineageTipId,
				lineageRootId: stringValue(
					session["lineage_root_id"],
					session["lineageRootId"],
					session["root_id"]
				),
				title: sanitizedStringValue(session["title"]) ?? "Untitled session",
				preview: sanitizedStringValue(session["preview"]) ?? "",
				profileId: stringValue(session["profile_id"], session["profile"]) ?? "default",
				source: stringValue(session["source_platform"], session["source"]) ?? "local",
				updatedAt: numberValue(session["updated_at"], session["last_active"]) ?? 0,
				createdAt: numberValue(session["created_at"], session["started_at"]) ?? 0,
				open: booleanValue(true, session["open"], session["is_open"]),
				archived: booleanValue(false, session["archived"], session["is_archived"]),
				running: booleanValue(false, session["running"]),
				busy: booleanValue(false, session["busy"]),
				claimed: booleanValue(false, session["claimed"]),
				waitingForUser: booleanValue(false, session["waiting_for_user"], session["waitingForUser"]),
				originLabel: sanitizedStringValue(
					origin?.["label"],
					session["origin_label"],
					session["originLabel"]
				),
				canOpenOrigin: booleanValue(
					false,
					origin?.["can_open_origin"],
					session["can_open_origin"],
					session["canOpenOrigin"]
				),
				canReportToOrigin: booleanValue(
					false,
					origin?.["can_report_to_origin"],
					session["can_report_to_origin"],
					session["canReportToOrigin"]
				),
				opaqueOriginRef: stringValue(
					origin?.["origin_ref"],
					session["opaque_origin_ref"],
					session["origin_ref"]
				),
			},
		];
	});

	return {
		compatibility: {
			state: compatible ? "compatible" : "upgrade-required",
			protocolVersion,
			capabilities,
			missingCapabilities,
		},
		sessions,
	};
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
		sessionId: stringValue(
			params?.["session_id"],
			params?.["sessionId"],
			payload["session_id"],
			payload["sessionId"]
		),
		turnId: stringValue(payload["turn_id"], payload["turnId"]),
		requestId: stringValue(payload["request_id"], payload["requestId"]),
		text,
		toolName: sanitizedStringValue(payload["tool_name"], payload["toolName"], payload["name"]),
		status: sanitizedStringValue(payload["status"]),
		payload: choices.length > 0 ? { choices } : {},
		workspaceArtifacts: extractWorkspaceArtifacts(payload, "tool-event"),
		receivedAt: Date.now(),
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
		const label =
			sanitizedStringValue(item["label"], item["description"], item["title"]) ?? safeValue;
		return [{ value: safeValue, label }];
	});
}

function contentText(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return null;
	const text = value.map((part) => stringValue(record(part)?.["text"]) ?? "").join("");
	return text || null;
}

export interface HermesExactTurnResult {
	turnId: string;
	content: string;
	completedAt: number | null;
	status: string | null;
}

export function extractExactHermesTurnResults(value: unknown): HermesExactTurnResult[] {
	const root = record(value) ?? {};
	const results = Array.isArray(root["turn_results"])
		? root["turn_results"]
		: Array.isArray(root["turnResults"])
			? root["turnResults"]
			: [];
	return results.flatMap((value) => {
		const result = record(value);
		const turnId = stringValue(result?.["turn_id"], result?.["turnId"]);
		const content = contentText(result?.["content"]);
		if (!result || !turnId || content === null) return [];
		return [
			{
				turnId,
				content,
				completedAt: numberValue(result["completed_at"], result["completedAt"]),
				status: stringValue(result["status"]),
			},
		];
	});
}

export function normalizeHermesHistory(value: unknown): HermesSessionHistory {
	const root = record(value) ?? {};
	const messages = Array.isArray(root["messages"])
		? root["messages"]
		: Array.isArray(value)
			? value
			: [];
	const normalizedMessages: HermesTranscriptMessage[] = messages.flatMap((value, index) => {
		const message = record(value);
		if (!message) return [];
		const rawRole = stringValue(message["role"]) ?? "system";
		const role = ["user", "assistant", "system", "tool"].includes(rawRole)
			? (rawRole as HermesTranscriptMessage["role"])
			: "system";
		const content = message["content"];
		const text =
			stringValue(message["text"], content) ??
			(Array.isArray(content)
				? content.map((part) => stringValue(record(part)?.["text"]) ?? "").join("")
				: "");
		return [
			{
				id: stringValue(message["id"], message["message_id"]) ?? `history-${index}`,
				turnId: stringValue(message["turn_id"], message["turnId"]),
				role,
				text: sanitizeString(text),
				createdAt: numberValue(message["created_at"], message["timestamp"]),
				status: sanitizedStringValue(message["status"]),
				toolName: sanitizedStringValue(message["tool_name"], message["name"]),
				workspaceArtifacts: extractWorkspaceArtifacts(message, "history-message"),
			},
		];
	});
	const turnResults: HermesTurnResult[] = extractExactHermesTurnResults(value).map((result) => ({
		...result,
		content: sanitizeString(result.content),
		status: result.status === null ? null : sanitizeString(result.status),
	}));
	return { messages: normalizedMessages, turnResults };
}
