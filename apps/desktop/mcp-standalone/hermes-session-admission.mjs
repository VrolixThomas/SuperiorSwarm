const DURABLE_SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,511}$/;
const PROFILE_ID_PATTERN = /^(?:default|custom|[a-z0-9][a-z0-9_-]{0,63})$/;
const SOURCE_PLATFORM_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const METADATA_KEYS = [
	"durableSessionId",
	"isCron",
	"profileId",
	"schemaVersion",
	"sourcePlatform",
];

function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function metadataError(code, message) {
	return { ok: false, code, message };
}

export function parseHermesSessionMetadata(extra) {
	const metadata = record(record(extra)?._meta)?.hermes;
	if (metadata === undefined || metadata === null) {
		return metadataError(
			"missing_metadata",
			"Hermes session metadata is missing from the MCP request."
		);
	}
	const values = record(metadata);
	if (!values) {
		return metadataError("invalid_metadata", "Hermes session metadata is invalid or unsupported.");
	}
	const keys = Object.keys(values).sort();
	if (
		keys.length !== METADATA_KEYS.length ||
		keys.some((key, index) => key !== METADATA_KEYS[index]) ||
		values.schemaVersion !== 1 ||
		typeof values.durableSessionId !== "string" ||
		!DURABLE_SESSION_ID_PATTERN.test(values.durableSessionId) ||
		typeof values.profileId !== "string" ||
		!PROFILE_ID_PATTERN.test(values.profileId) ||
		typeof values.sourcePlatform !== "string" ||
		!SOURCE_PLATFORM_PATTERN.test(values.sourcePlatform) ||
		typeof values.isCron !== "boolean"
	) {
		return metadataError("invalid_metadata", "Hermes session metadata is invalid or unsupported.");
	}
	return {
		ok: true,
		metadata: {
			schemaVersion: 1,
			durableSessionId: values.durableSessionId,
			profileId: values.profileId,
			sourcePlatform: values.sourcePlatform,
			isCron: values.isCron,
		},
	};
}

export function withAutomaticHermesSessionAdmission(handler, admit) {
	return async (...args) => {
		const parsed = parseHermesSessionMetadata(args[1]);
		if (parsed.ok) {
			try {
				await admit(parsed.metadata, "mcp");
			} catch {
				// Admission is best-effort for existing tools: coordination must keep working.
			}
		}
		return await handler(...args);
	};
}

function handoverResult(result, isError) {
	return {
		content: [{ type: "text", text: JSON.stringify(result) }],
		structuredContent: result,
		isError,
	};
}

export async function handleHermesSessionHandover(extra, admit) {
	const parsed = parseHermesSessionMetadata(extra);
	if (!parsed.ok) {
		return handoverResult(
			{
				admitted: false,
				code: parsed.code,
				message: parsed.message,
			},
			true
		);
	}
	try {
		const result = await admit(parsed.metadata, "handover");
		if (result?.admitted !== true) {
			return handoverResult(
				{
					admitted: false,
					code: result?.code ?? "admission_failed",
					message:
						result?.code === "cron_session"
							? "Cron sessions cannot be handed over to SuperiorSwarm Agents."
							: "Hermes session admission failed.",
				},
				true
			);
		}
		return handoverResult(result, false);
	} catch {
		return handoverResult(
			{
				admitted: false,
				code: "admission_unavailable",
				message: "SuperiorSwarm could not persist the Hermes session handover.",
			},
			true
		);
	}
}
