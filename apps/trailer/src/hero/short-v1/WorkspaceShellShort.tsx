// Drives the short-v1 main pane. Each scene is its own bespoke "Poppy"
// construction — per-element <Pop> wrappers give every section its own entry
// beat instead of a single wholesale slide. Sidebar build remains v4's natural
// build (already approved as the template); everything else is hand-staggered.
//
// Outer Sequence sizes the scene window; the scene component itself owns the
// local clock. Scenes that still need RepoSidebarV4 in its "fully built" state
// wrap that one component in an inner Sequence shifted past the v4 sidebar
// build window, keeping the outer clock fresh for Pop wrappers.

import { Sequence } from "remotion";
import { AppWindowV4 } from "../build-v4/AppWindowV4";
import { MainPaneHeaderV4 } from "../build-v4/MainPaneHeaderV4";
import { type TabPillV4, WorkspaceTabBarV4 } from "../build-v4/WorkspaceTabBarV4";
import { ThemeProviderV4 } from "../build-v4/colors-v4";
import { SCENES_V4 } from "../build-v4/timeline";
import { WithSidebarRepos } from "../build-v4/views/WithSidebarRepos";
import { BuildIn } from "./BuildIn";
import { AgentsDoneFastScene } from "./scenes/AgentsDoneFastScene";
import { AllGreenHold } from "./scenes/AllGreenHold";
import { PoppyApprove } from "./scenes/PoppyApprove";
import { PoppyBaseTerminal } from "./scenes/PoppyBaseTerminal";
import { PoppyComments } from "./scenes/PoppyComments";
import { PoppyDiffPanel } from "./scenes/PoppyDiffPanel";
import { PoppyPRs } from "./scenes/PoppyPRs";
import { PoppySplitFile } from "./scenes/PoppySplitFile";
import { PoppyTickets } from "./scenes/PoppyTickets";
import { SCENES_SHORT } from "./timeline";

const SIDEBAR_PAST = SCENES_V4.s2SidebarBuild.from + SCENES_V4.s2SidebarBuild.duration;

const TERMINAL_TAB: TabPillV4 = { id: "term-1", title: "Terminal 1", kind: "terminal" };
const REVIEW_TAB: TabPillV4 = { id: "review", title: "Review", kind: "review" };

function header(tabs: TabPillV4[], activeId: string | null) {
	if (tabs.length === 0) return null;
	return (
		<MainPaneHeaderV4
			opacity={1}
			tabBar={<WorkspaceTabBarV4 tabs={tabs} activeTabId={activeId} />}
		/>
	);
}

export function WorkspaceShellShort() {
	return (
		<>
			{/* baseTerminal — terminal chrome staggered in piece-by-piece. */}
			<Sequence
				from={SCENES_SHORT.baseTerminal.from}
				durationInFrames={SCENES_SHORT.baseTerminal.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppyBaseTerminal />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* sidebarBuild — v4 plays its full sidebar construction (this is the
			    template the user pointed to as the gold standard). Inner clock
			    shifted to v4's s2SidebarBuild anchor. */}
			<Sequence
				from={SCENES_SHORT.sidebarBuild.from}
				durationInFrames={SCENES_SHORT.sidebarBuild.duration}
				layout="none"
			>
				<Sequence from={-SCENES_V4.s2SidebarBuild.from} layout="none">
					<ThemeProviderV4 value="dark">
						<AppWindowV4>
							<WithSidebarRepos header={header([TERMINAL_TAB], TERMINAL_TAB.id)} />
						</AppWindowV4>
					</ThemeProviderV4>
				</Sequence>
			</Sequence>

			{/* diffPanel — right panel sections pop in sequence + tabbar fades. */}
			<Sequence
				from={SCENES_SHORT.diffPanel.from}
				durationInFrames={SCENES_SHORT.diffPanel.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppyDiffPanel tabBar={header([TERMINAL_TAB, REVIEW_TAB], REVIEW_TAB.id)} />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* splitFile — left terminal pane + right file pane with staggered entry. */}
			<Sequence
				from={SCENES_SHORT.splitFile.from}
				durationInFrames={SCENES_SHORT.splitFile.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppySplitFile tabBar={header([TERMINAL_TAB, REVIEW_TAB], REVIEW_TAB.id)} />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* comments — SolveReviewTab + right comments panel staggered. */}
			<Sequence
				from={SCENES_SHORT.comments.from}
				durationInFrames={SCENES_SHORT.comments.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppyComments tabBar={null} />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* approve — Big "All comments resolved" badge stamp + ringPulse on CTA. */}
			<Sequence
				from={SCENES_SHORT.approve.from}
				durationInFrames={SCENES_SHORT.approve.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppyApprove tabBar={null} />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* tickets — Linear board built piece-by-piece. */}
			<Sequence
				from={SCENES_SHORT.tickets.from}
				durationInFrames={SCENES_SHORT.tickets.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppyTickets header={header([TERMINAL_TAB], TERMINAL_TAB.id)} />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* prs — PR list sidebar + overview pane + comments panel staggered. */}
			<Sequence
				from={SCENES_SHORT.prs.from}
				durationInFrames={SCENES_SHORT.prs.duration}
				layout="none"
			>
				<ThemeProviderV4 value="dark">
					<AppWindowV4>
						<PoppyPRs header={header([TERMINAL_TAB], TERMINAL_TAB.id)} />
					</AppWindowV4>
				</ThemeProviderV4>
			</Sequence>

			{/* agentsFlip — sidebar dots flip green at 10f/agent. Inner clock past
			    sidebar build so RepoSidebarV4 renders fully built. */}
			<Sequence
				from={SCENES_SHORT.agentsFlip.from}
				durationInFrames={SCENES_SHORT.agentsFlip.duration}
				layout="none"
			>
				<Sequence from={-SIDEBAR_PAST} layout="none">
					<ThemeProviderV4 value="dark">
						<AppWindowV4>
							<AgentsDoneFastScene startFrame={SIDEBAR_PAST} />
						</AppWindowV4>
					</ThemeProviderV4>
				</Sequence>
			</Sequence>

			{/* pullback — scaleDownOut wraps the past-anchored AllGreenHold. */}
			<Sequence
				from={SCENES_SHORT.pullback.from}
				durationInFrames={SCENES_SHORT.pullback.duration}
				layout="none"
			>
				<BuildIn
					variant="scaleDownOut"
					duration={SCENES_SHORT.pullback.duration}
					style={{ width: "100%", height: "100%" }}
				>
					<Sequence from={-SIDEBAR_PAST} layout="none">
						<ThemeProviderV4 value="dark">
							<AppWindowV4>
								<AllGreenHold />
							</AppWindowV4>
						</ThemeProviderV4>
					</Sequence>
				</BuildIn>
			</Sequence>
		</>
	);
}
