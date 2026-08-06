import {
	HERMES_WORKSPACE_ARTIFACT_KIND,
	type HermesCatalog,
	type HermesRuntimeEvent,
	type HermesTranscriptMessage,
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
		.replace(/([?&](?:token|ticket|internal)=)[^&\s]+/gi, "$1[redacted]")
		.replace(
			/(\b(?:api[-_]?key|token|secret|credential|authorization|password|cookie)\b\s*[:=]\s*)(["']?)[^\s,"';]+\2/gi,
			"$1[redacted]"
		)
		.replace(
			/(--(?:api[-_]?key|token|secret|credential|authorization|password|cookie)\s+)(["']?)[^\s,"';]+\2/gi,
			"$1[redacted]"
		)
		.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
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
		typeof candidate["projectId"] === "string" &&
		typeof candidate["branch"] === "string" &&
		typeof candidate["worktreePath"] === "string"
	);
}

export function extractWorkspaceArtifacts(value: unknown): HermesWorkspaceArtifact[] {
	const found = new Map<string, HermesWorkspaceArtifact>();
	const seen = new Set<object>();

	function visit(candidate: unknown): void {
		if (isWorkspaceArtifact(candidate)) {
			found.set(`${candidate.projectId}:${candidate.workspaceId}`, { ...candidate });
			return;
		}
		if (typeof candidate === "string") {
			const trimmed = candidate.trim();
			if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return;
			try {
				visit(JSON.parse(trimmed));
			} catch {
				// Tool text is usually prose; only valid JSON is a structured artifact source.
			}
			return;
		}
		if (candidate === null || typeof candidate !== "object") return;
		if (seen.has(candidate)) return;
		seen.add(candidate);
		if (Array.isArray(candidate)) {
			for (const child of candidate) visit(child);
			return;
		}
		for (const child of Object.values(candidate as JsonRecord)) visit(child);
	}

	visit(value);
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
	const sanitized = (sanitizeHermesPayload(payload) ?? {}) as JsonRecord;
	let text = stringValue(sanitized["text"], sanitized["message"]);
	if (type === "approval.request") {
		const description = stringValue(sanitized["description"]);
		const command = stringValue(sanitized["command"]);
		if (description && command) text = `${description}\n\nCommand:\n${command}`;
		else text = description ?? command ?? text;
	} else if (type === "clarify.request") {
		text = stringValue(sanitized["question"]) ?? text;
	}
	return {
		type,
		sessionId: stringValue(
			params?.["session_id"],
			params?.["sessionId"],
			payload["session_id"],
			payload["sessionId"]
		),
		turnId: stringValue(payload["turn_id"], payload["turnId"]),
		requestId: stringValue(payload["request_id"], payload["requestId"]),
		text,
		toolName: stringValue(payload["tool_name"], payload["toolName"], payload["name"]),
		status: stringValue(payload["status"]),
		payload: sanitized,
		workspaceArtifacts: extractWorkspaceArtifacts(payload),
		receivedAt: Date.now(),
	};
}

export function normalizeHermesHistory(value: unknown): HermesTranscriptMessage[] {
	const root = record(value) ?? {};
	const messages = Array.isArray(root["messages"])
		? root["messages"]
		: Array.isArray(value)
			? value
			: [];
	return messages.flatMap((value, index) => {
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
				status: stringValue(message["status"]),
				toolName: stringValue(message["tool_name"], message["name"]),
				workspaceArtifacts: extractWorkspaceArtifacts(message),
			},
		];
	});
}
