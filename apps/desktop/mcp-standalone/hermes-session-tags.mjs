import { parseHermesSessionMetadata } from "./hermes-session-admission.mjs";

const MAX_TAGS = 64;
const MAX_TAG_LENGTH = 100;
const TAG_COLORS = new Set([
	"gray",
	"blue",
	"cyan",
	"green",
	"amber",
	"orange",
	"red",
	"pink",
	"purple",
]);

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

function validDefinitionId(value) {
	return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function validatedReusableOperation(operation, args) {
	const values = record(args);
	if (!values) return null;
	switch (operation) {
		case "list_definitions":
			if (exactKeys(values, [])) return { query: "" };
			return exactKeys(values, ["query"]) &&
				typeof values.query === "string" &&
				values.query.length <= 100
				? { query: values.query }
				: null;
		case "upsert_definition":
			return exactKeys(values, ["name", "color"]) &&
				validTag(values.name) &&
				TAG_COLORS.has(values.color)
				? { name: values.name, color: values.color }
				: null;
		case "update_definition": {
			const allowedKeys = ["definition_id", "name", "color", "expected_revision"];
			if (
				!Object.keys(values).every((key) => allowedKeys.includes(key)) ||
				!validDefinitionId(values.definition_id) ||
				!Number.isInteger(values.expected_revision) ||
				values.expected_revision < 0 ||
				(values.name === undefined && values.color === undefined) ||
				(values.name !== undefined && !validTag(values.name)) ||
				(values.color !== undefined && !TAG_COLORS.has(values.color))
			) {
				return null;
			}
			return {
				definitionId: values.definition_id,
				...(values.name === undefined ? {} : { name: values.name }),
				...(values.color === undefined ? {} : { color: values.color }),
				expectedRevision: values.expected_revision,
			};
		}
		case "delete_definition":
			return exactKeys(values, ["definition_id", "expected_revision"]) &&
				validDefinitionId(values.definition_id) &&
				Number.isInteger(values.expected_revision) &&
				values.expected_revision >= 0
				? { definitionId: values.definition_id, expectedRevision: values.expected_revision }
				: null;
		case "read_assignments":
			return exactKeys(values, []) ? {} : null;
		case "assign":
		case "unassign":
			return exactKeys(values, ["definition_id"]) && validDefinitionId(values.definition_id)
				? { definitionId: values.definition_id }
				: null;
		default:
			return null;
	}
}

const REUSABLE_TAG_PATHS = {
	list_definitions: "/hermes.tags.definitions.list",
	upsert_definition: "/hermes.tags.definitions.upsert",
	update_definition: "/hermes.tags.definitions.update",
	delete_definition: "/hermes.tags.definitions.delete",
	read_assignments: "/hermes.sessions.tags.assignments.read",
	assign: "/hermes.sessions.tags.assign",
	unassign: "/hermes.sessions.tags.unassign",
};

export async function handleHermesReusableTagTool({ operation, args, extra, connectionId, call }) {
	const parsed = parseHermesSessionMetadata(extra);
	if (!parsed.ok) return errorResult(parsed.code, parsed.message);
	if (typeof connectionId !== "string" || connectionId.length === 0) {
		return errorResult(
			"ambiguous_connection",
			"This Hermes manager is not bound to exactly one SuperiorSwarm connection."
		);
	}
	const operationValues = validatedReusableOperation(operation, args);
	const path = REUSABLE_TAG_PATHS[operation];
	if (!operationValues || !path) {
		return errorResult("invalid_arguments", "Reusable tag arguments are invalid.");
	}
	return await call(path, {
		connectionId,
		metadata: parsed.metadata,
		...operationValues,
	});
}
