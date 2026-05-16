import { interpolate, useCurrentFrame } from "remotion";
import { BranchChanges } from "../../build-real/BranchChanges";
import { CodeEditor } from "../../build/CodeEditor";
import { useColorsV4 } from "../colors-v4";
import { DEMO_FILES_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;
const RIGHT_PANEL_W = 380;

export function WithFileNav() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s6FileNav.from;

	const fileIndex = Math.min(Math.floor(local / 80), DEMO_FILES_V4.length - 1);
	const active = DEMO_FILES_V4[fileIndex] ?? DEMO_FILES_V4[0];

	const treeOp = interpolate(local, [0, 18], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<>
			{/* Left: 280px file tree */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
					opacity: treeOp,
				}}
			>
				{/* Header */}
				<div
					style={{
						padding: "10px 12px",
						borderBottom: `1px solid ${c.borderSubtle}`,
						fontSize: 11,
						fontWeight: 600,
						letterSpacing: "0.06em",
						textTransform: "uppercase",
						color: c.textTertiary,
					}}
				>
					Files
				</div>

				{/* File list */}
				<div
					style={{
						flex: 1,
						overflow: "hidden",
						padding: "6px 0",
					}}
				>
					{DEMO_FILES_V4.map((file, i) => {
						const isActive = i === fileIndex;
						const filename = file.path.split("/").pop() ?? file.path;
						const dir = file.path.split("/").slice(0, -1).join("/");
						return (
							<div
								key={file.path}
								style={{
									padding: "4px 12px",
									fontSize: 12,
									background: isActive ? c.bgActive : "transparent",
									borderLeft: isActive ? `2px solid ${c.accent}` : "2px solid transparent",
									display: "flex",
									flexDirection: "column",
									gap: 1,
									cursor: "default",
								}}
							>
								<span
									style={{
										color: isActive ? c.text : c.textSecondary,
										fontWeight: isActive ? 600 : 400,
										fontFamily: "monospace",
										fontSize: 12,
									}}
								>
									{filename}
								</span>
								<span
									style={{
										color: c.textQuaternary,
										fontFamily: "monospace",
										fontSize: 10,
									}}
								>
									{dir}
								</span>
							</div>
						);
					})}
				</div>

				{/* Active file info */}
				{active != null && (
					<div
						style={{
							padding: "8px 12px",
							borderTop: `1px solid ${c.borderSubtle}`,
							fontSize: 11,
							color: c.textTertiary,
						}}
					>
						<span style={{ color: c.accent, fontWeight: 600 }}>
							{active.hunks.reduce((n, h) => n + h.additions.length, 0)}+
						</span>
						{" / "}
						<span style={{ color: c.danger, fontWeight: 600 }}>
							{active.hunks.reduce((n, h) => n + h.deletions.length, 0)}-
						</span>
					</div>
				)}
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
				<CodeEditor entryFrame={SCENES_V4.s6FileNav.from} variant="use-agent-terminal-stream" />
			</div>

			{/* Right: 380px BranchChanges panel */}
			<div
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					background: c.bgSurface,
					borderLeft: `1px solid ${c.borderSubtle}`,
					overflow: "hidden",
				}}
			>
				<BranchChanges />
			</div>
		</>
	);
}
