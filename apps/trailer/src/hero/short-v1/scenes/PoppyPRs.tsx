// PoppyPRs — 3s scene. PR list tab. Left sidebar (PullRequestsTab) slides
// from left, center PR overview pane stamps up, right comments panel slides
// from right. Accent ringPulse overlay highlights the active PR title once
// it lands.

import type { ReactNode } from "react";
import { AbsoluteFill } from "remotion";
import { CommentsOverviewTab } from "../../build-real/CommentsOverviewTab";
import { PROverviewPane } from "../../build-real/PROverviewPane";
import { PullRequestsTab } from "../../build-real/PullRequestsTab";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { Pop } from "../Pop";

const SIDEBAR_WIDTH = 320;
const RIGHT_PANEL_W = 380;

interface Props {
	header?: ReactNode;
}

export function PoppyPRs({ header }: Props) {
	const c = useColorsV4();

	return (
		<>
			<Pop
				variant="slideRight"
				delay={0}
				duration={18}
				style={{
					width: SIDEBAR_WIDTH,
					flexShrink: 0,
					height: "100%",
				}}
			>
				<div
					style={{
						width: "100%",
						height: "100%",
						background: c.bgSurface,
						borderRight: `1px solid ${c.borderSubtle}`,
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					<Pop variant="slideDown" delay={4} duration={12}>
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
										background: i === 2 ? c.bgElevated : "transparent",
										color: i === 2 ? c.textSecondary : c.textQuaternary,
									}}
								>
									{label}
								</div>
							))}
						</div>
					</Pop>
					<Pop variant="slideUp" delay={16} duration={20} style={{ flex: 1, overflow: "hidden" }}>
						<PullRequestsTab />
					</Pop>
				</div>
			</Pop>

			<div
				style={{
					flex: 1,
					background: c.bgBase,
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					position: "relative",
				}}
			>
				{header}
				<Pop variant="stampPop" delay={14} duration={22} style={{ flex: 1, minHeight: 0 }}>
					<PROverviewPane />
				</Pop>

				{/* Highlight the PR title region once it lands. */}
				<AbsoluteFill style={{ pointerEvents: "none" }}>
					<Pop
						variant="ringPulse"
						delay={40}
						duration={44}
						style={{
							position: "absolute",
							top: 12,
							left: 20,
							width: 380,
							height: 56,
						}}
					>
						<span aria-hidden="true" />
					</Pop>
				</AbsoluteFill>
			</div>

			<Pop
				variant="slideLeft"
				delay={10}
				duration={20}
				style={{
					width: RIGHT_PANEL_W,
					flexShrink: 0,
					height: "100%",
				}}
			>
				<div
					style={{
						width: "100%",
						height: "100%",
						background: c.bgSurface,
						borderLeft: `1px solid ${c.borderSubtle}`,
						display: "flex",
						flexDirection: "column",
						overflow: "hidden",
					}}
				>
					<CommentsOverviewTab />
				</div>
			</Pop>
		</>
	);
}
