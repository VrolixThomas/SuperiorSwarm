import { interpolate, useCurrentFrame } from "remotion";
import { C } from "./colors";
import { INTER, MONO } from "./fonts";

type LineType = "file-header" | "hunk" | "context" | "removed" | "added";

interface DiffLine {
	type: LineType;
	lineNum?: string;
	content: string;
}

const LINES: DiffLine[] = [
	{
		type: "file-header",
		content: "apps/desktop/src/renderer/hooks/useAgentTerminalStream.ts",
	},
	{
		type: "hunk",
		content: "@@ -64,7 +64,8 @@ export function useAgentTerminalStream(stream: AgentStream) {",
	},
	{ type: "context", lineNum: "63", content: "  const streamRef = useRef<Subscription | null>(null);" },
	{ type: "context", lineNum: "64", content: "" },
	{ type: "context", lineNum: "65", content: "  useEffect(() => {" },
	{
		type: "removed",
		lineNum: "66",
		content: "    streamRef.current = stream.subscribe(handler);",
	},
	{ type: "removed", lineNum: "67", content: "  }, [stream, handler]);" },
	{ type: "added", lineNum: "66", content: "    const sub = stream.subscribe(handler);" },
	{ type: "added", lineNum: "67", content: "    return () => sub.unsubscribe();" },
	{ type: "added", lineNum: "68", content: "  }, [stream, handler]);" },
	{ type: "context", lineNum: "69", content: "" },
	{ type: "context", lineNum: "70", content: "  const send = useCallback((msg: string) => {" },
	{ type: "context", lineNum: "71", content: "    if (!streamRef.current) return;" },
];

const BG: Record<LineType, string> = {
	"file-header": C.bgElevated,
	hunk: "rgba(10,132,255,0.08)",
	context: "transparent",
	removed: "rgba(255,69,58,0.10)",
	added: "rgba(48,209,88,0.10)",
};

const LEFT_BAR: Record<LineType, string> = {
	"file-header": "transparent",
	hunk: "transparent",
	context: "transparent",
	removed: C.danger,
	added: C.success,
};

const GUTTER_COLOR: Record<LineType, string> = {
	"file-header": C.textQuaternary,
	hunk: C.textTertiary,
	context: C.textQuaternary,
	removed: "rgba(255,69,58,0.5)",
	added: "rgba(48,209,88,0.5)",
};

const TEXT_COLOR: Record<LineType, string> = {
	"file-header": C.textSecondary,
	hunk: C.textTertiary,
	context: C.textSecondary,
	removed: "#ff9693",
	added: "#7deba3",
};

const PREFIX: Record<LineType, string> = {
	"file-header": "",
	hunk: "",
	context: " ",
	removed: "-",
	added: "+",
};

interface Props {
	entryFrame: number;
}

interface Hint {
	key: string;
	label: string;
}

const HINTS: Hint[] = [
	{ key: "j", label: "Next" },
	{ key: "k", label: "Prev" },
	{ key: "x", label: "Approve" },
	{ key: "c", label: "Comment" },
	{ key: "v", label: "Request changes" },
	{ key: "⌘↵", label: "Submit" },
];

export function DiffView({ entryFrame }: Props) {
	const frame = useCurrentFrame();

	const hintStart = entryFrame + 40;
	const hintOpacity = interpolate(frame, [hintStart, hintStart + 14], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const hintY = interpolate(frame, [hintStart, hintStart + 18], [12, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<div
			style={{
				flex: 1,
				background: C.bgBase,
				overflow: "hidden",
				display: "flex",
				flexDirection: "column",
			}}
		>
			{/* PR header */}
			<div
				style={{
					padding: "10px 16px",
					borderBottom: `1px solid ${C.borderSubtle}`,
					display: "flex",
					alignItems: "center",
					gap: 10,
					flexShrink: 0,
					opacity: interpolate(frame, [entryFrame, entryFrame + 16], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					}),
				}}
			>
				<span
					style={{
						padding: "2px 7px",
						borderRadius: 4,
						background: C.successSubtle,
						color: C.success,
						fontSize: 10,
						fontWeight: 700,
						letterSpacing: 0.4,
					}}
				>
					● OPEN
				</span>
				<span style={{ fontFamily: INTER, fontSize: 13, fontWeight: 600, color: C.text }}>
					feat: agent terminal chat with streaming responses
				</span>
				<span style={{ fontFamily: INTER, fontSize: 11, color: C.textQuaternary }}>#214</span>
			</div>

			{/* Diff body */}
			<div style={{ flex: 1, overflow: "hidden", fontFamily: MONO }}>
				{LINES.map((line, i) => {
					const start = entryFrame + 18 + i * 6;
					const op = interpolate(frame, [start, start + 10], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});
					const x = interpolate(frame, [start, start + 10], [-6, 0], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});

					const isFile = line.type === "file-header";
					const isHunk = line.type === "hunk";

					return (
						<div
							key={`${line.type}-${i}`}
							style={{
								display: "flex",
								alignItems: "center",
								background: BG[line.type],
								borderLeft: `3px solid ${LEFT_BAR[line.type]}`,
								opacity: op,
								transform: `translateX(${x}px)`,
								padding: isFile ? "7px 12px" : "0",
							}}
						>
							{!isFile && !isHunk && (
								<span
									style={{
										width: 36,
										textAlign: "right",
										paddingRight: 12,
										fontSize: 11,
										color: GUTTER_COLOR[line.type],
										userSelect: "none",
										flexShrink: 0,
									}}
								>
									{line.lineNum}
								</span>
							)}
							{!isFile && (
								<span
									style={{
										width: 12,
										fontSize: 12,
										color: TEXT_COLOR[line.type],
										flexShrink: 0,
									}}
								>
									{PREFIX[line.type]}
								</span>
							)}
							<span
								style={{
									padding: isFile ? "0" : isHunk ? "3px 12px" : "2px 8px",
									fontSize: isFile ? 11 : 12,
									color: TEXT_COLOR[line.type],
									whiteSpace: "pre",
									overflow: "hidden",
									textOverflow: "ellipsis",
								}}
							>
								{line.content}
							</span>
						</div>
					);
				})}
			</div>

			{/* Keyboard shortcut hint bar */}
			<div
				style={{
					flexShrink: 0,
					display: "flex",
					alignItems: "center",
					gap: 14,
					padding: "7px 14px",
					borderTop: `1px solid ${C.borderSubtle}`,
					background: C.bgSurface,
					opacity: hintOpacity,
					transform: `translateY(${hintY}px)`,
				}}
			>
				{HINTS.map((h, i) => (
					<div
						key={h.key}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
						}}
					>
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								justifyContent: "center",
								background: C.bgElevated,
								border: `1px solid ${C.borderSubtle}`,
								borderRadius: 3,
								padding: "1px 5px",
								fontFamily: MONO,
								fontSize: 10,
								color: C.textSecondary,
							}}
						>
							{h.key}
						</span>
						<span
							style={{
								fontFamily: INTER,
								fontSize: 10,
								color: C.textTertiary,
							}}
						>
							{h.label}
						</span>
						{i < HINTS.length - 1 && (
							<span
								style={{
									marginLeft: 8,
									fontSize: 10,
									color: C.textQuaternary,
								}}
							>
								·
							</span>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
