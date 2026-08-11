import { parseHermesSessionMetadata } from "./hermes-session-admission.mjs";

const MAX_TAGS = 64;
const MAX_TAG_LENGTH = 100;

function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function exactKeys(value, expected) {
	const keys = Object.keys(value).sort();
	const sortedExpected = [...expected].sort();
	return (
		keys.length === sortedExpected.length &&
		keys.every((key, index) => key === sortedExpected[index])
	);
}

function validTag(value) {
	return typeof value === "string" && value.length <= MAX_TAG_LENGTH && value.trim().length > 0;
}

function errorResult(code, message) {
	const result = { ok: false, code, message };
	return {
		content: [{ type: "text", text: JSON.stringify(result) }],
		structuredContent: result,
		isError: true,
	};
}

function validatedOperation(operation, args) {
	const values = record(args);
	if (!values) return null;
	switch (operation) {
		case "read":
			return exactKeys(values, []) ? {} : null;
		case "set":
			if (
				!exactKeys(values, ["tags", "expected_revision"]) ||
				!Array.isArray(values.tags) ||
				values.tags.length > MAX_TAGS ||
				!values.tags.every(validTag) ||
				!Number.isInteger(values.expected_revision) ||
				values.expected_revision < 0
			) {
				return null;
			}
			return { tags: values.tags, expectedRevision: values.expected_revision };
		case "add":
		case "remove":
			return exactKeys(values, ["tag"]) && validTag(values.tag) ? { tag: values.tag } : null;
		default:
			return null;
	}
}

export async function handleHermesSessionTagTool({ operation, args, extra, connectionId, call }) {
	const parsed = parseHermesSessionMetadata(extra);
	if (!parsed.ok) return errorResult(parsed.code, parsed.message);
	if (typeof connectionId !== "string" || connectionId.length === 0) {
		return errorResult(
			"ambiguous_connection",
			"This Hermes manager is not bound to exactly one SuperiorSwarm connection."
		);
	}
	const operationValues = validatedOperation(operation, args);
	if (!operationValues) {
		return errorResult("invalid_arguments", "Session tag arguments are invalid.");
	}
	return await call(`/hermes.sessions.tags.${operation}`, {
		connectionId,
		metadata: parsed.metadata,
		...operationValues,
	});
}
