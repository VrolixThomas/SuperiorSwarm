import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";
import { MONO } from "./fonts";

export interface TerminalLine {
	t: string;
	from: number;
	c?: string;
	bold?: boolean;
}

// Mirrors a claude --resume session output, styled to match the desktop app's terminal pane.
const DEFAULT_LINES: TerminalLine[] = [
	{ t: "> claude --resume", from: 0, c: C.textSecondary },
	{ t: "", from: 4 },
	{ t: "Claude Code v0.2.14", from: 10, bold: true },
	{ t: "Workspace: SuperiorSwarm · feat/agent-terminal-chat", from: 18, c: C.textTertiary },
	{ t: "", from: 24 },
	{ t: "> Review agent terminal chat and fix stream cleanup", from: 28, c: C.textSecondary },
	{ t: "", from: 34 },
	{ t: "Reading src/renderer/hooks/useAgentTerminalStream.ts...", from: 42, c: C.textTertiary },
	{ t: "", from: 50 },
	{ t: "Found issue: useEffect cleanup returns without unsubscribing.", from: 58 },
	{ t: "On unmount mid-stream, the subscription continues consuming memory.", from: 70 },
	{ t: "", from: 78 },
	{ t: "Fixing src/renderer/hooks/useAgentTerminalStream.ts:", from: 88, c: C.textSecondary },
	{
		t: "- streamRef.current = stream.subscribe(handler);",
		from: 100,
		c: C.termRed,
	},
	{ t: "+ const sub = stream.subscribe(handler);", from: 112, c: C.termGreen },
	{ t: "+ return () => sub.unsubscribe();", from: 122, c: C.termGreen },
	{ t: "", from: 130 },
	{ t: "✓ Written. Running type-check...", from: 140, c: C.termGreen },
	{ t: "✓ bun run type-check passed (0 errors)", from: 158, c: C.termGreen, bold: true },
	{ t: "", from: 166 },
	{ t: ">", from: 178, c: C.textSecondary, bold: true },
	{ t: "", from: 760 },
	{ t: "> Resolving review comments on SuperiorSwarm...", from: 770, c: C.textSecondary },
	{ t: "Reading pull/214 · SuperiorSwarm...", from: 790, c: C.textTertiary },
	{ t: "", from: 808 },
	{ t: "Comment: 'Cancel the stream when a terminal closes'", from: 816 },
	{ t: "Applying fix to useAgentTerminalStream.ts...", from: 836, c: C.textTertiary },
	{ t: "✓ Committed d8f3a2 — fix(stream): cancel terminal subscriptions", from: 860, c: C.termGreen, bold: true },
	{ t: "", from: 878 },
	{ t: "Comment: 'Keep MCP server names stable across refreshes'", from: 886 },
	{ t: "Applying fix...", from: 906, c: C.textTertiary },
	{ t: "✓ Committed a4b261 — fix(mcp): preserve server identity", from: 928, c: C.termGreen, bold: true },
	{ t: ">", from: 950, c: C.textSecondary, bold: true },
];

interface Props {
	startFrame: number;
	lines?: TerminalLine[];
}

export function TerminalBody({ startFrame, lines }: Props) {
	const frame = useCurrentFrame();
	const local = frame - startFrame;
	const cursorOn = (Math.floor(Math.max(local, 0) / 30) & 1) === 0;
	const data = lines ?? DEFAULT_LINES;
	return (
		<div
			style={{
				flex: 1,
				padding: "14px 18px",
				fontFamily: MONO,
				fontSize: 13,
				lineHeight: 1.6,
				color: C.text,
				overflow: "hidden",
			}}
		>
			{data.map((l, i) => {
				const op = interpolate(local, [l.from, l.from + 8], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				const showCursor = i === data.length - 1 && local >= l.from + 8 && cursorOn;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static lines
						key={i}
						style={{
							opacity: op,
							color: l.c ?? C.text,
							fontWeight: l.bold ? 600 : 400,
							whiteSpace: "pre",
						}}
					>
						{l.t}
						{showCursor ? "█" : ""}
					</div>
				);
			})}
		</div>
	);
}
