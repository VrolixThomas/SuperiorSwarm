import { z } from "zod";
import type { BrowserLoadError } from "./browser-load-error";

const id = z.string().min(1).max(200);
export const browserTargetSchema = z.object({ workspaceId: id, browserId: id });
export const browserViewportSchema = z.enum(["desktop", "phone"]);
export const browserBoundsSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	width: z.number().finite().min(1).max(20000),
	height: z.number().finite().min(1).max(20000),
});
export function isBrowserURL(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			!url.username &&
			!url.password &&
			(url.protocol === "https:" ||
				(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
		);
	} catch {
		return false;
	}
}
export function normalizeBrowserURL(value: string): string {
	let input = value.trim();
	if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(input)) input = `http://${input}`;
	else if (!/^[a-z][a-z\d+.-]*:/i.test(input)) input = `https://${input}`;
	if (!isBrowserURL(input))
		throw new Error("Enter an HTTPS or localhost HTTP address without credentials.");
	return new URL(input).href;
}
export const browserURLSchema = z
	.string()
	.max(8192)
	.refine(isBrowserURL, "HTTPS or localhost HTTP required");
export const browserTabSchema = browserTargetSchema.extend({
	url: z.union([z.literal(""), browserURLSchema]),
	viewport: browserViewportSchema.default("desktop"),
});
export const browserOpenTabSchema = browserTabSchema.extend({
	openerId: id.optional(),
	background: z.boolean().optional(),
});
export const browserSyncSchema = z.object({
	sequence: z.number().int().nonnegative(),
	tabs: z.array(browserTargetSchema).max(128),
	presentations: z.array(browserTargetSchema.extend({ bounds: browserBoundsSchema })).max(16),
});
export const browserCommandSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("clear-data") }),
	z.object({ kind: z.literal("navigate"), url: browserURLSchema }),
	z.object({ kind: z.literal("back") }),
	z.object({ kind: z.literal("forward") }),
	z.object({ kind: z.literal("reload") }),
	z.object({ kind: z.literal("stop") }),
	z.object({ kind: z.literal("viewport"), viewport: browserViewportSchema }),
	z.object({ kind: z.literal("agent-control"), enabled: z.boolean() }),
]);
const observed = { sequence: z.number().int().nonnegative(), documentId: id };
export const browserActionSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("click"), ...observed, elementId: id }),
	z.object({ kind: z.literal("type"), ...observed, elementId: id, text: z.string().max(4000) }),
	z.object({
		kind: z.literal("scroll"),
		...observed,
		elementId: id.optional(),
		x: z.number().finite().optional(),
		y: z.number().finite().optional(),
	}),
]);
export const browserAgentRequestSchema = z.discriminatedUnion("operation", [
	z.object({ operation: z.literal("viewport"), browserId: id, viewport: browserViewportSchema }),
	z.object({ operation: z.literal("list") }),
	z.object({ operation: z.literal("open"), url: browserURLSchema }),
	z.object({ operation: z.literal("observe"), browserId: id }),
	z.object({ operation: z.literal("screenshot"), browserId: id }),
	z.object({ operation: z.literal("navigate"), browserId: id, url: browserURLSchema }),
	z.object({ operation: z.literal("act"), browserId: id, action: browserActionSchema }),
]);
export type BrowserTarget = z.infer<typeof browserTargetSchema>;
export type BrowserTab = z.infer<typeof browserTabSchema>;
export type BrowserOpenTab = z.infer<typeof browserOpenTabSchema>;
export type BrowserBounds = z.infer<typeof browserBoundsSchema>;
export type BrowserSync = z.infer<typeof browserSyncSchema>;
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
export type BrowserAction = z.infer<typeof browserActionSchema>;
export type BrowserAgentRequest = z.infer<typeof browserAgentRequestSchema>;
export interface BrowserState extends BrowserTab {
	phase?: "attaching" | "ready" | "crashed";
	title: string;
	loading: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
	error: string | null;
	loadError?: BrowserLoadError | null;
	agentControl: boolean;
	presented: boolean;
}
export interface BrowserSnapshot {
	url: string;
	title: string;
	text: string;
	documentId: string;
	truncated: boolean;
	scroll: { x: number; y: number };
	elements: Array<{
		id: string;
		role: string;
		name: string;
		tag: string;
		value?: string;
		bounds: BrowserBounds;
		visible: boolean;
		enabled: boolean;
	}>;
}
export interface BrowserObservation extends BrowserSnapshot, BrowserTarget {
	sequence: number;
}
export interface BrowserReservation extends BrowserTarget {
	generation: string;
	partition: string;
}
export interface BrowserStateEvent extends BrowserTarget {
	generation: string;
	state: BrowserState | null;
}
export interface BrowserAPI {
	onState: (callback: (event: BrowserStateEvent) => void) => () => void;
	onShortcut: (
		callback: (event: {
			browserId: string;
			kind: "address" | "close" | "palette" | "focus";
		}) => void
	) => () => void;
	onOpenTab: (callback: (tab: BrowserOpenTab) => void) => () => void;
}
