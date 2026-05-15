import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";
import { MONO } from "./fonts";

interface Token {
	t: string;
	c?: string;
}

const AGENT_TERMINAL_LINES: Token[][] = [
	[
		{ t: "import", c: C.termMagenta },
		{ t: " { " },
		{ t: "useAgentTerminalStream", c: C.termBlue },
		{ t: " } " },
		{ t: "from", c: C.termMagenta },
		{ t: " " },
		{ t: '"../hooks/useAgentTerminalStream"', c: C.termGreen },
		{ t: ";" },
	],
	[],
	[
		{ t: "export function ", c: C.termMagenta },
		{ t: "AgentTerminal", c: C.termBlue },
		{ t: "({ session }) {" },
	],
	[
		{ t: "  const stream = useAgentTerminalStream(session.id);" },
	],
	[
		{ t: "  return <Terminal stream={stream} />;" },
	],
	[
		{ t: "}" },
	],
	[],
];

// The file the trailer's narrative shows the agent editing. Matches the
// before/after lines in TerminalBody.tsx (cleanup of stream subscription).
const USE_AGENT_TERMINAL_STREAM_LINES: Token[][] = [
	[{ t: "import", c: C.termMagenta }, { t: " { " }, { t: "useEffect", c: C.termBlue }, { t: ", " }, { t: "useState", c: C.termBlue }, { t: " } " }, { t: "from", c: C.termMagenta }, { t: " " }, { t: '"react"', c: C.termGreen }, { t: ";" }],
	[{ t: "import", c: C.termMagenta }, { t: " " }, { t: "type", c: C.termMagenta }, { t: " { " }, { t: "AgentStream", c: C.termBlue }, { t: " } " }, { t: "from", c: C.termMagenta }, { t: " " }, { t: '"../../shared/agent-events"', c: C.termGreen }, { t: ";" }],
	[{ t: "import", c: C.termMagenta }, { t: " { " }, { t: "subscribeAgentStream", c: C.termBlue }, { t: " } " }, { t: "from", c: C.termMagenta }, { t: " " }, { t: '"../lib/agent-stream"', c: C.termGreen }, { t: ";" }],
	[],
	[{ t: "export function ", c: C.termMagenta }, { t: "useAgentTerminalStream", c: C.termBlue }, { t: "(sessionId: " }, { t: "string", c: C.termMagenta }, { t: ") {" }],
	[{ t: "  const [stream, setStream] = " }, { t: "useState", c: C.termBlue }, { t: "<" }, { t: "AgentStream", c: C.termBlue }, { t: " | " }, { t: "null", c: C.termMagenta }, { t: ">(" }, { t: "null", c: C.termMagenta }, { t: ");" }],
	[],
	[{ t: "  ", c: C.text }, { t: "useEffect", c: C.termBlue }, { t: "(() => {" }],
	[{ t: "    const sub = ", c: C.text }, { t: "subscribeAgentStream", c: C.termBlue }, { t: "(sessionId, (chunk) => {" }],
	[{ t: "      setStream((prev) => mergeChunk(prev, chunk));" }],
	[{ t: "    });" }],
	[{ t: "    return () => sub.", c: C.text }, { t: "unsubscribe", c: C.termBlue }, { t: "();" }],
	[{ t: "  }, [sessionId]);" }],
	[],
	[{ t: "  return stream;" }],
	[{ t: "}" }],
	[],
];

const VARIANTS = {
	"agent-terminal": AGENT_TERMINAL_LINES,
	"use-agent-terminal-stream": USE_AGENT_TERMINAL_STREAM_LINES,
} as const;

export type CodeEditorVariant = keyof typeof VARIANTS;

interface Props {
	entryFrame: number;
	variant?: CodeEditorVariant;
}

export function CodeEditor({ entryFrame, variant = "agent-terminal" }: Props) {
	const lines = VARIANTS[variant];
	const frame = useCurrentFrame();
	return (
		<div
			style={{
				flex: 1,
				padding: "12px 0",
				background: C.bgBase,
				fontFamily: MONO,
				fontSize: 13,
				lineHeight: 1.7,
				color: C.text,
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
			}}
		>
			{lines.map((line, i) => {
				const start = entryFrame + i * 4;
				const op = interpolate(frame, [start, start + 10], [0, 1], {
					extrapolateLeft: "clamp",
					extrapolateRight: "clamp",
				});
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: static lines
						key={i}
						style={{ opacity: op, display: "flex", gap: 14, padding: "0 14px" }}
					>
						<span
							style={{
								width: 18,
								textAlign: "right",
								color: C.textQuaternary,
								fontVariantNumeric: "tabular-nums",
								flexShrink: 0,
							}}
						>
							{i + 1}
						</span>
						<span style={{ whiteSpace: "pre" }}>
							{line.map((tok, j) => (
								<span
									// biome-ignore lint/suspicious/noArrayIndexKey: static tokens
									key={j}
									style={{ color: tok.c ?? C.text }}
								>
									{tok.t}
								</span>
							))}
						</span>
					</div>
				);
			})}
		</div>
	);
}
