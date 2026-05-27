// s6FileNav — "Open any file". Demonstrates split-view: the main pane stays
// on Review (continued from s5) in the left half, and a second pane slides
// in from the right with a diff-file tab open. Each pane has its own tab
// bar (real app's per-pane PaneTabBar pattern).

import type { ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { TerminalBody } from "../../build/TerminalBody";
import { BranchActionsBarV4 } from "../MainPaneHeaderV4";
import { RepoSidebarV4, type WorktreeAlertV4 } from "../RepoSidebarV4";
import { RightPanelV4 } from "../RightPanelV4";
import { type TabPillV4, WorkspaceTabBarV4 } from "../WorkspaceTabBarV4";
import { useColorsV4 } from "../colors-v4";
import { DEMO_FILES_V4, REPOS_V4 } from "../data";
import { tokenizeTs } from "../syntax";
import { SCENES_V4 } from "../timeline";

const ACTIVE_BRANCH = "feat/agent-terminal-chat";
const SPLIT_FRAME = 80; // when the second pane slides in (scene-local)

export function WithFileNav({ tabBar: _tabBar }: { tabBar?: ReactNode }) {
	const c = useColorsV4();
	const frame = useCurrentFrame();
	const local = frame - SCENES_V4.s6FileNav.from;

	const worktrees = REPOS_V4[0]?.worktrees ?? [];
	const alerts: WorktreeAlertV4[] = worktrees.map((_, i) => (i === 0 ? null : "done"));

	const splitW = interpolate(local, [SPLIT_FRAME, SPLIT_FRAME + 24], [0, 50], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const leftFlex = 100 - splitW;
	const rightFlex = splitW;
	const rightOp = interpolate(local, [SPLIT_FRAME + 6, SPLIT_FRAME + 24], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const file = DEMO_FILES_V4[0];
	const fileName = file?.path.split("/").pop() ?? "useAgentTerminalStream.ts";

	const leftTabs: TabPillV4[] = [{ id: "term-1", title: "Terminal 1", kind: "terminal" }];
	const rightTabs: TabPillV4[] = [{ id: "file-1", title: fileName, kind: "file" }];

	return (
		<>
			<RepoSidebarV4 segment="repos" worktreeAlerts={alerts} activeBranch={ACTIVE_BRANCH} />

			<div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
				<BranchActionsBarV4 />
				<div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
					<div
						style={{
							flexGrow: leftFlex,
							flexShrink: 1,
							flexBasis: 0,
							display: "flex",
							flexDirection: "column",
							overflow: "hidden",
							borderRight: rightFlex > 0 ? `1px solid ${c.borderSubtle}` : "none",
						}}
					>
						<WorkspaceTabBarV4 tabs={leftTabs} activeTabId="term-1" />
						<div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
							<TerminalBody startFrame={SCENES_V4.s6FileNav.from} />
						</div>
					</div>

					{rightFlex > 0 && file && (
						<div
							style={{
								flexGrow: rightFlex,
								flexShrink: 1,
								flexBasis: 0,
								display: "flex",
								flexDirection: "column",
								overflow: "hidden",
								opacity: rightOp,
							}}
						>
							<WorkspaceTabBarV4 tabs={rightTabs} activeTabId="file-1" />
							<FilePaneBody path={file.path} />
						</div>
					)}
				</div>
			</div>

			<RightPanelV4 mode="files" />
		</>
	);
}

const FILE_CONTENT_LINES: string[] = [
	'import { useEffect, useRef } from "react";',
	'import type { TerminalStream } from "../../shared/terminal-types";',
	"",
	"// Subscribe to the agent terminal stream and clean up on unmount.",
	"export function useAgentTerminalStream(sessionId: string) {",
	"\tconst streamRef = useRef<TerminalStream | null>(null);",
	"",
	"\tuseEffect(() => {",
	"\t\tconst stream = openAgentStream(sessionId);",
	"\t\tstreamRef.current = stream;",
	"",
	"\t\tconst sub = stream.subscribe(handler);",
	"\t\treturn () => sub.unsubscribe();",
	"\t}, [sessionId]);",
	"",
	"\treturn streamRef;",
	"}",
];

function FilePaneBody({ path }: { path: string }) {
	const c = useColorsV4();
	return (
		<div
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				background: c.bgBase,
			}}
		>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					height: 22,
					padding: "0 12px",
					background: c.bgSurface,
					borderBottom: `1px solid ${c.borderSubtle}`,
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
					fontSize: 11,
					color: c.textQuaternary,
				}}
			>
				{path}
			</div>
			<div
				style={{
					flex: 1,
					overflow: "auto",
					padding: "10px 0",
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
					fontSize: 11.5,
					lineHeight: "18px",
				}}
			>
				{FILE_CONTENT_LINES.map((line, i) => {
					const tokens = tokenizeTs(line);
					return (
						<div
							key={`line-${i}`}
							style={{ display: "flex", whiteSpace: "pre", padding: "0 12px" }}
						>
							<span
								style={{
									display: "inline-block",
									width: 32,
									color: c.textQuaternary,
									textAlign: "right",
									paddingRight: 12,
									flexShrink: 0,
									fontVariantNumeric: "tabular-nums",
								}}
							>
								{i + 1}
							</span>
							<span>
								{tokens.map((t, ti) => (
									<span
										// biome-ignore lint/suspicious/noArrayIndexKey: token stream
										key={ti}
										style={{
											color: t.color,
											fontStyle: t.italic ? "italic" : "normal",
										}}
									>
										{t.text}
									</span>
								))}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}
