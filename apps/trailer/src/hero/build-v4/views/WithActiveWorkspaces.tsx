import { interpolate, useCurrentFrame } from "remotion";
import { SwarmIndicator } from "../../build/SwarmIndicator";
import { TerminalBody } from "../../build/TerminalBody";
import { finishOrder } from "../agentOrder";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;

export function WithActiveWorkspaces() {
	const c = useColorsV4();
	const frame = useCurrentFrame();

	// Skip main (index 0) — show the 6 active feature branches
	const worktrees = REPOS_V4[0]?.worktrees.slice(1, 7) ?? [];
	const startFrame = SCENES_V4.s3StartWS.from;
	const orderOnFinish = finishOrder(worktrees.length);

	return (
		<>
			{/* Left: real sidebar with Repos tab + worktree rows */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					display: "flex",
					flexDirection: "column",
				}}
			>
				{/* Tab strip */}
				<div
					style={{
						display: "flex",
						padding: "6px 8px",
						gap: 4,
						borderBottom: `1px solid ${c.borderSubtle}`,
					}}
				>
					{(["Repos", "Tickets", "PRs"] as const).map((label, i) => (
						<div
							key={label}
							style={{
								flex: 1,
								padding: "5px 0",
								textAlign: "center",
								fontSize: 10,
								fontWeight: 500,
								borderRadius: 5,
								background: i === 0 ? c.bgElevated : "transparent",
								color: i === 0 ? c.textSecondary : c.textQuaternary,
							}}
						>
							{label}
						</div>
					))}
				</div>

				{/* Repo name header */}
				<div
					style={{
						padding: "10px 16px 6px",
						fontSize: 12,
						fontWeight: 600,
						color: c.text,
					}}
				>
					{REPOS_V4[0]?.name}
				</div>

				{/* Worktree rows */}
				{worktrees.map((wt, i) => {
					const entryFrame = startFrame + i * 15;
					const op = interpolate(frame, [entryFrame, entryFrame + 18], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});
					const finishSlot = orderOnFinish.indexOf(i);
					const finishFrame = SCENES_V4.s4AgentsDone.from + finishSlot * 60;
					const done = frame >= finishFrame;

					return (
						<div
							key={wt.branch}
							style={{
								opacity: op,
								margin: "0 4px",
								padding: "7px 12px 7px 16px",
								borderRadius: 6,
								display: "flex",
								alignItems: "center",
								gap: 8,
							}}
						>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 12,
										color: c.textSecondary,
										whiteSpace: "nowrap",
										overflow: "hidden",
										textOverflow: "ellipsis",
									}}
								>
									{wt.branch}
								</div>
								{done && <div style={{ fontSize: 10, color: "#69db7c", marginTop: 2 }}>✓ done</div>}
							</div>
							<SwarmIndicator state={done ? "done" : "active"} size={18} />
						</div>
					);
				})}
			</div>

			{/* Right: terminal showing agent work */}
			<div style={{ flex: 1, background: c.bgBase }}>
				<TerminalBody startFrame={SCENES_V4.s3StartWS.from} />
			</div>
		</>
	);
}
