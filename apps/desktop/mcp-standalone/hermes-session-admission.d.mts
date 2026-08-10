export interface HermesSessionMetadata {
	schemaVersion: 1;
	durableSessionId: string;
	profileId: string;
	sourcePlatform: string;
	isCron: boolean;
}

export type HermesSessionAdmissionReason = "mcp" | "handover";

export type HermesSessionMetadataParseResult =
	| { ok: true; metadata: HermesSessionMetadata }
	| {
			ok: false;
			code: "missing_metadata" | "invalid_metadata";
			message: string;
	  };

export interface HermesMcpToolResult {
	content: Array<{ type: "text"; text: string }>;
	structuredContent: Record<string, unknown>;
	isError: boolean;
}

type AdmitHermesSession = (
	metadata: HermesSessionMetadata,
	reason: HermesSessionAdmissionReason
) => Record<string, unknown> | Promise<Record<string, unknown>>;

export function parseHermesSessionMetadata(extra: unknown): HermesSessionMetadataParseResult;

export function withAutomaticHermesSessionAdmission<TArgs, TResult>(
	handler: (args: TArgs, extra?: unknown) => TResult | Promise<TResult>,
	admit: AdmitHermesSession
): (args: TArgs, extra?: unknown) => Promise<TResult>;

export function handleHermesSessionHandover(
	extra: unknown,
	admit: AdmitHermesSession
): Promise<HermesMcpToolResult>;
