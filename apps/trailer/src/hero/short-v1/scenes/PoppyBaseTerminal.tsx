// PoppyBaseTerminal — 4s scene. The first time we see the workspace shell
// chrome after the opening tiles merge. Branch bar slides down, branch pill
// stamps, terminal tab slides in from the left, then TerminalBody plays its
// own typing animation. No sidebar yet — that's the next scene's build.

import type { ReactNode } from "react";
import { TerminalBody } from "../../build/TerminalBody";
import { BranchActionsBarV4 } from "../../build-v4/MainPaneHeaderV4";
import { type TabPillV4, WorkspaceTabBarV4 } from "../../build-v4/WorkspaceTabBarV4";
import { useColorsV4 } from "../../build-v4/colors-v4";
import { Pop } from "../Pop";

const TABS: TabPillV4[] = [{ id: "term-1", title: "Terminal 1", kind: "terminal" }];

interface Props {
	header?: ReactNode;
}

export function PoppyBaseTerminal(_props: Props) {
	const c = useColorsV4();
	return (
		<div
			style={{
				flex: 1,
				background: c.bgSurface,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
			}}
		>
			<Pop variant="slideDown" delay={0} duration={14}>
				<BranchActionsBarV4 />
			</Pop>
			<Pop variant="slideRight" delay={12} duration={14}>
				<WorkspaceTabBarV4 tabs={TABS} activeTabId={TABS[0]?.id ?? null} />
			</Pop>
			<Pop variant="fadeIn" delay={22} duration={14} style={{ flex: 1, minHeight: 0 }}>
				<TerminalBody startFrame={0} />
			</Pop>
		</div>
	);
}
