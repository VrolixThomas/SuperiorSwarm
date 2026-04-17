import { SERVER_ID_REGEX } from "../../../../shared/lsp-schema";

interface ValidateOptions {
	existingIds: Set<string>;
	builtInIds: Set<string>;
}

interface ValidateFlags {
	skipCollisionCheck?: boolean;
}

export interface ValidateResult {
	error: string | null;
	warning: string | null;
}

const OK: ValidateResult = { error: null, warning: null };

export function validateServerId(
	id: string,
	opts: ValidateOptions,
	flags: ValidateFlags = {}
): ValidateResult {
	const trimmed = id.trim();
	if (!trimmed) return { error: "ID is required", warning: null };
	if (!SERVER_ID_REGEX.test(trimmed)) {
		return {
			error:
				"ID must start with a lowercase letter and use only lowercase letters, digits, or hyphens (2-31 chars)",
			warning: null,
		};
	}
	if (flags.skipCollisionCheck) return OK;
	if (opts.existingIds.has(trimmed)) {
		return { error: `A server with id "${trimmed}" already exists`, warning: null };
	}
	if (opts.builtInIds.has(trimmed)) {
		return {
			error: null,
			warning: `"${trimmed}" matches a built-in server — saving will override the default for this workspace`,
		};
	}
	return OK;
}
