import { interpolate, useCurrentFrame } from "remotion";
import { CodeEditor } from "../../build/CodeEditor";
import { useColorsV4 } from "../colors-v4";
import { PRS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_W = 420;

export function WithCommentsPR() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s7PRComment.from;

	const pr = PRS_V4.find((p) => p.number === 142) ?? PRS_V4[0];
	const commentsToShow = pr != null ? Math.min(Math.floor(local / 40) + 1, pr.comments.length) : 0;

	const solveOpacity = interpolate(local, [60, 90], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			{/* Left: 280px PR sidebar */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
					padding: "12px 0",
				}}
			>
				{/* PR badge + number */}
				<div
					style={{
						padding: "0 12px 12px",
						borderBottom: `1px solid ${c.borderSubtle}`,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							marginBottom: 6,
						}}
					>
						<span
							style={{
								fontSize: 10,
								fontWeight: 700,
								background: c.accentSubtle,
								color: c.accent,
								borderRadius: 4,
								padding: "2px 6px",
								letterSpacing: "0.04em",
							}}
						>
							PR
						</span>
						<span
							style={{
								fontSize: 13,
								fontWeight: 600,
								color: c.textQuaternary,
							}}
						>
							#{pr?.number}
						</span>
					</div>
					<div
						style={{
							fontSize: 12,
							fontWeight: 600,
							color: c.text,
							lineHeight: 1.4,
							marginBottom: 4,
						}}
					>
						{pr?.title}
					</div>
					<div
						style={{
							fontSize: 11,
							color: c.textTertiary,
						}}
					>
						by <span style={{ color: c.textSecondary, fontWeight: 500 }}>{pr?.author}</span>
					</div>
				</div>

				{/* Role badge */}
				<div
					style={{
						padding: "8px 12px",
						fontSize: 11,
						color: c.textTertiary,
					}}
				>
					<span
						style={{
							background: pr?.role === "incoming-review" ? c.accentSubtle : "transparent",
							color: pr?.role === "incoming-review" ? c.accent : c.textTertiary,
							borderRadius: 4,
							padding: "2px 6px",
							fontWeight: 500,
						}}
					>
						{pr?.role === "incoming-review" ? "Needs your review" : "Outgoing"}
					</span>
				</div>

				{/* Comment count summary */}
				<div
					style={{
						padding: "6px 12px",
						fontSize: 12,
						color: c.textSecondary,
					}}
				>
					<span style={{ fontWeight: 600, color: c.text }}>{pr?.comments.length}</span> inline
					comments
				</div>
			</div>

			{/* Center: code editor */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				<CodeEditor entryFrame={SCENES_V4.s7PRComment.from} variant="use-agent-terminal-stream" />
			</div>

			{/* Right: 420px comments panel */}
			<div
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				{/* Panel header */}
				<div
					style={{
						padding: "10px 14px",
						borderBottom: `1px solid ${c.borderSubtle}`,
						fontSize: 12,
						fontWeight: 600,
						color: c.text,
						flexShrink: 0,
					}}
				>
					Comments
				</div>

				{/* Inline comments list */}
				<div
					style={{
						flex: 1,
						overflow: "hidden",
						padding: "8px 0",
					}}
				>
					{(pr?.comments ?? []).slice(0, commentsToShow).map((comment) => (
						<div
							key={`${comment.file}:${comment.line}`}
							style={{
								padding: "10px 14px",
								borderBottom: `1px solid ${c.borderSubtle}`,
							}}
						>
							{/* File + line */}
							<div
								style={{
									fontFamily: "monospace",
									fontSize: 10,
									color: c.accent,
									marginBottom: 4,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{comment.file}:{comment.line}
							</div>
							{/* Author */}
							<div
								style={{
									fontSize: 11,
									fontWeight: 600,
									color: c.textSecondary,
									marginBottom: 4,
								}}
							>
								{comment.author}
							</div>
							{/* Body */}
							<div
								style={{
									fontSize: 12,
									color: c.text,
									lineHeight: 1.5,
								}}
							>
								{comment.body}
							</div>
						</div>
					))}
				</div>

				{/* Solve with AI button */}
				<div
					data-solve-button-anchor
					style={{
						margin: 16,
						padding: "10px 14px",
						borderRadius: 8,
						background: c.accent,
						color: "#fff",
						textAlign: "center",
						fontWeight: 600,
						fontSize: 14,
						opacity: solveOpacity,
						flexShrink: 0,
					}}
				>
					Solve with AI
				</div>
			</div>
		</>
	);
}
