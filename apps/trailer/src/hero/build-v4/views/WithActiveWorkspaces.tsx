import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { PulsingLogo } from "../../build/PulsingLogo";
import { finishOrder } from "../agentOrder";
import { useColorsV4 } from "../colors-v4";
import { REPOS_V4 } from "../data";
import { SCENES_V4, SPRING_V4 } from "../timeline";

const SIDEBAR_WIDTH = 280;

export function WithActiveWorkspaces() {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// 6 panes (SuperiorSwarm worktrees minus main + release branches for a clean grid).
	const panes = REPOS_V4[0]?.worktrees.slice(1, 7) ?? [];
	const startFrame = SCENES_V4.s3StartWS.from;
	const orderOnFinish = finishOrder(panes.length); // [2, 4, 1, 5, 0, 3] for n=6

	return (
		<>
			{/* sidebar persists; minimal version showing repo + active worktrees highlighted */}
			<div
				style={{
					width: SIDEBAR_WIDTH,
					background: c.bgSurface,
					borderRight: `1px solid ${c.borderSubtle}`,
					padding: 12,
					color: c.textSecondary,
					fontSize: 12,
				}}
			>
				<div style={{ color: c.text, fontWeight: 600, padding: "4px 8px 12px" }}>
					{REPOS_V4[0]?.name}
				</div>
				{panes.map((wt) => (
					<div
						key={wt.branch}
						style={{
							padding: "6px 8px",
							borderRadius: 6,
							display: "flex",
							alignItems: "center",
							gap: 8,
							color: c.text,
						}}
					>
						<span
							style={{
								width: 6,
								height: 6,
								borderRadius: "50%",
								background: c.success,
								boxShadow: `0 0 6px ${c.success}`,
							}}
						/>
						{wt.branch}
					</div>
				))}
			</div>
			<div
				style={{
					flex: 1,
					padding: 16,
					display: "grid",
					gridTemplateColumns: "1fr 1fr 1fr",
					gridTemplateRows: "1fr 1fr",
					gap: 12,
					background: c.bgBase,
				}}
			>
				{panes.map((wt, i) => {
					const entryFrame = startFrame + i * 20;
					const scale = spring({
						frame: frame - entryFrame,
						fps,
						config: SPRING_V4,
						from: 0.85,
						to: 1,
					});
					const op = interpolate(frame, [entryFrame, entryFrame + 18], [0, 1], {
						extrapolateLeft: "clamp",
						extrapolateRight: "clamp",
					});

					// Finish order: panes turn green in order returned by finishOrder.
					const finishSlot = orderOnFinish.indexOf(i);
					const finishFrame = SCENES_V4.s4AgentsDone.from + finishSlot * 60;
					const done = frame >= finishFrame;

					return (
						<div
							key={wt.branch}
							style={{
								background: c.bgSurface,
								border: `1px solid ${done ? c.success : c.borderSubtle}`,
								borderRadius: 8,
								padding: 16,
								display: "flex",
								flexDirection: "column",
								alignItems: "center",
								justifyContent: "center",
								opacity: op,
								transform: `scale(${scale})`,
								transition: "border-color 0.3s",
							}}
						>
							{done ? (
								<div
									style={{
										width: 64,
										height: 64,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<span style={{ fontSize: 48, color: c.success }}>●</span>
								</div>
							) : (
								<PulsingLogo size={64} />
							)}
							<div
								style={{
									marginTop: 12,
									fontSize: 12,
									color: c.textSecondary,
									textAlign: "center",
								}}
							>
								{wt.branch}
							</div>
							{done && (
								<div style={{ marginTop: 4, fontSize: 11, color: c.success, fontWeight: 600 }}>
									✓ done
								</div>
							)}
						</div>
					);
				})}
			</div>
		</>
	);
}
