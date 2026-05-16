import { interpolate, useCurrentFrame } from "remotion";
import { SolveDiffPane } from "../../build-real/SolveDiffPane";
import { MOCK_SESSION, SolveReviewTab } from "../../build-real/SolveReviewTab";
import { useColorsV4 } from "../colors-v4";
import { PRS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_W = 440;
const ACTIVE_FILE = "src/renderer/hooks/useAgentTerminalStream.ts";

export function PRReviewResult() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s11ReviewResult.from;

	const reviewed = PRS_V4.find((p) => p.role === "incoming-review") ?? PRS_V4[0];

	const fadeIn = interpolate(local, [0, 24], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			{/* Left: 280px sidebar with PR info + AI review badge */}
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
							#{reviewed?.number}
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
						{reviewed?.title}
					</div>
					<div style={{ fontSize: 11, color: c.textTertiary }}>
						by <span style={{ color: c.textSecondary, fontWeight: 500 }}>{reviewed?.author}</span>
					</div>
				</div>

				{/* AI review badge */}
				<div
					style={{
						margin: "12px 12px 0",
						padding: "8px 10px",
						borderRadius: 8,
						background: c.accentSubtle,
						border: `1px solid ${c.accent}`,
						display: "flex",
						flexDirection: "column",
						gap: 4,
					}}
				>
					<div
						style={{
							fontSize: 11,
							fontWeight: 700,
							color: c.accent,
							letterSpacing: "0.04em",
						}}
					>
						AI review
					</div>
					<div style={{ fontSize: 11, color: c.textSecondary }}>3 suggestions · 1 nit</div>
				</div>

				{/* Comments summary */}
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
						Review Comments
					</div>
					{(reviewed?.comments ?? []).map((comment) => (
						<div
							key={`${comment.file}:${comment.line}`}
							style={{
								padding: "6px 0",
								borderBottom: `1px solid ${c.borderSubtle}`,
								fontSize: 11,
							}}
						>
							<div
								style={{
									fontFamily: "monospace",
									fontSize: 10,
									color: c.accent,
									marginBottom: 2,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								:{comment.line}
							</div>
							<div
								style={{
									color: c.textSecondary,
									lineHeight: 1.4,
									overflow: "hidden",
									display: "-webkit-box",
									WebkitLineClamp: 2,
									WebkitBoxOrient: "vertical",
								}}
							>
								{comment.body}
							</div>
						</div>
					))}
				</div>
			</div>

			{/* Center: diff pane */}
			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					opacity: fadeIn,
				}}
			>
				<SolveDiffPane session={MOCK_SESSION} activeFilePath={ACTIVE_FILE} />
			</div>

			{/* Right: 440px solve review tab */}
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
				<SolveReviewTab />
			</div>
		</>
	);
}
