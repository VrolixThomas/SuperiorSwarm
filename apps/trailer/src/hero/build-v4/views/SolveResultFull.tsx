import { interpolate, useCurrentFrame } from "remotion";
import { CodeEditor } from "../../build/CodeEditor";
import { useColorsV4 } from "../colors-v4";
import { PRS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_W = 420;

const RESOLVED_FILES = [
	{ path: "src/main/terminal/pty-events.ts", additions: 8, deletions: 3 },
	{ path: "src/renderer/hooks/usePtyDedup.ts", additions: 24, deletions: 0 },
];

export function SolveResultFull() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s8SolveResult.from;

	const pr = PRS_V4.find((p) => p.number === 142) ?? PRS_V4[0];

	// Resolve badge fades in quickly
	const resolvedOp = interpolate(local, [0, 20], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	// Comments resolve one by one
	const resolvedCount = Math.min(Math.floor(local / 60) + 1, pr?.comments.length ?? 0);

	return (
		<>
			{/* Left: 280px sidebar with PR info + Resolved badge */}
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
				{/* PR info */}
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

				{/* Resolved badge */}
				<div
					style={{
						margin: "12px 12px 0",
						padding: "8px 12px",
						borderRadius: 8,
						background: "rgba(48,209,88,0.14)",
						border: `1px solid ${c.success}`,
						display: "flex",
						alignItems: "center",
						gap: 8,
						opacity: resolvedOp,
					}}
				>
					<span style={{ fontSize: 16 }}>✓</span>
					<div>
						<div
							style={{
								fontSize: 12,
								fontWeight: 700,
								color: c.success,
							}}
						>
							Resolved
						</div>
						<div
							style={{
								fontSize: 10,
								color: c.textTertiary,
								marginTop: 1,
							}}
						>
							All comments addressed
						</div>
					</div>
				</div>

				{/* Changed files summary */}
				<div
					style={{
						padding: "12px 12px 0",
					}}
				>
					<div
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: c.textTertiary,
							letterSpacing: "0.06em",
							textTransform: "uppercase",
							marginBottom: 6,
						}}
					>
						Changed Files
					</div>
					{RESOLVED_FILES.map((f) => {
						const filename = f.path.split("/").pop() ?? f.path;
						return (
							<div
								key={f.path}
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									padding: "3px 0",
									fontSize: 11,
								}}
							>
								<span
									style={{
										color: c.textSecondary,
										fontFamily: "monospace",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{filename}
								</span>
								<span style={{ flexShrink: 0, marginLeft: 6 }}>
									<span style={{ color: c.success, fontWeight: 600 }}>+{f.additions}</span>
									<span style={{ color: c.textQuaternary }}> / </span>
									<span style={{ color: c.danger, fontWeight: 600 }}>-{f.deletions}</span>
								</span>
							</div>
						);
					})}
				</div>
			</div>

			{/* Center: code editor with diff */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
				}}
			>
				<CodeEditor entryFrame={SCENES_V4.s8SolveResult.from} variant="use-agent-terminal-stream" />
			</div>

			{/* Right: 420px resolved comments panel */}
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
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}
				>
					<span>Resolved Comments</span>
					<span
						style={{
							fontSize: 11,
							fontWeight: 600,
							color: c.success,
						}}
					>
						{resolvedCount}/{pr?.comments.length ?? 0}
					</span>
				</div>

				{/* Resolved comments list */}
				<div
					style={{
						flex: 1,
						overflow: "hidden",
						padding: "8px 0",
					}}
				>
					{(pr?.comments ?? []).slice(0, resolvedCount).map((comment) => (
						<div
							key={`${comment.file}:${comment.line}`}
							style={{
								padding: "10px 14px",
								borderBottom: `1px solid ${c.borderSubtle}`,
							}}
						>
							{/* Resolved badge + file */}
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									marginBottom: 4,
								}}
							>
								<span
									style={{
										fontSize: 10,
										fontWeight: 700,
										color: c.success,
										background: "rgba(48,209,88,0.14)",
										borderRadius: 3,
										padding: "1px 5px",
									}}
								>
									✓ fixed
								</span>
								<span
									style={{
										fontFamily: "monospace",
										fontSize: 10,
										color: c.accent,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{comment.file}:{comment.line}
								</span>
							</div>

							{/* Author */}
							<div
								style={{
									fontSize: 11,
									fontWeight: 600,
									color: c.textSecondary,
									marginBottom: 3,
								}}
							>
								{comment.author}
							</div>

							{/* Body */}
							<div
								style={{
									fontSize: 12,
									color: c.textTertiary,
									lineHeight: 1.5,
									opacity: 0.8,
								}}
							>
								{comment.body}
							</div>
						</div>
					))}
				</div>

				{/* Submit reply CTA */}
				<div
					style={{
						margin: 16,
						padding: "10px 14px",
						borderRadius: 8,
						background: c.success,
						color: "#fff",
						textAlign: "center",
						fontWeight: 600,
						fontSize: 14,
						flexShrink: 0,
						opacity: interpolate(local, [80, 120], [0, 1], {
							extrapolateLeft: "clamp",
							extrapolateRight: "clamp",
						}),
					}}
				>
					Push &amp; Submit Replies
				</div>
			</div>
		</>
	);
}
