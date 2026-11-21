import { type ReactNode, useEffect } from "react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { useProjectStore } from "../stores/projects";
import { useTabStore } from "../stores/tab-store";

interface MainLayoutProps {
	children: ReactNode;
	sidebar: (collapsed: boolean, expand: () => void) => ReactNode;
	diff: ReactNode;
}

export function MainLayout(props: MainLayoutProps) {
	const segment = useTabStore((s) => s.sidebarSegment);
	// Queue owns the entire content area. Never restore repository panel sizes here
	// or save a queue layout over the user's workspace layout.
	if (segment === "queue") {
		return <div className="h-screen min-w-0 overflow-hidden">{props.children}</div>;
	}
	return <WorkspaceLayout {...props} />;
}

function WorkspaceLayout({ children, sidebar, diff }: MainLayoutProps) {
	const sidebarPanelRef = usePanelRef();
	const diffPanelRef = usePanelRef();
	const sidebarCollapsed = useProjectStore((s) => s.sidebarCollapsed);
	const setSidebarCollapsed = useProjectStore((s) => s.setSidebarCollapsed);
	const segment = useTabStore((s) => s.sidebarSegment);
	const rightPanelOpen = useTabStore((s) => s.rightPanel.open);
	const closeDiffPanel = useTabStore((s) => s.closeDiffPanel);
	const { defaultLayout, onLayoutChanged } = useDefaultLayout({
		id: "app-layout",
		storage: localStorage,
	});

	useEffect(() => {
		const panel = diffPanelRef.current;
		if (!panel) return;
		if (["tickets", "hermes"].includes(segment)) {
			if (!panel.isCollapsed()) panel.collapse();
		} else if (rightPanelOpen && panel.isCollapsed()) panel.expand();
		else if (!rightPanelOpen && !panel.isCollapsed()) panel.collapse();
	}, [rightPanelOpen, diffPanelRef, segment]);

	useEffect(() => {
		function toggle() {
			const panel = sidebarPanelRef.current;
			if (!panel) return;
			if (panel.isCollapsed()) panel.expand();
			else panel.collapse();
		}
		window.addEventListener("app:toggle-sidebar", toggle);
		return () => window.removeEventListener("app:toggle-sidebar", toggle);
	}, [sidebarPanelRef]);

	return (
		<Group
			orientation="horizontal"
			defaultLayout={defaultLayout}
			onLayoutChanged={onLayoutChanged}
			className="h-screen min-w-0 overflow-hidden bg-[var(--bg-base)]"
		>
			<Panel
				id="sidebar"
				panelRef={sidebarPanelRef}
				defaultSize={sidebarCollapsed ? "0px" : "288px"}
				minSize="232px"
				maxSize="360px"
				collapsible
				collapsedSize="0px"
				onResize={() => setSidebarCollapsed(sidebarPanelRef.current?.isCollapsed() ?? false)}
				className="min-w-0 overflow-hidden bg-[var(--bg-surface)]"
			>
				{sidebar(sidebarCollapsed, () => sidebarPanelRef.current?.expand())}
			</Panel>
			<Separator className="panel-resize-handle" />
			<Panel id="main" minSize="360px" className="min-w-0 overflow-hidden">
				{children}
			</Panel>
			<Separator className="panel-resize-handle" />
			<Panel
				id="diff"
				panelRef={diffPanelRef}
				defaultSize="19.4%"
				minSize={200}
				maxSize="40%"
				collapsible
				collapsedSize="0%"
				onResize={() => {
					if (diffPanelRef.current?.isCollapsed() && rightPanelOpen && segment === "repos")
						closeDiffPanel();
				}}
			>
				{diff}
			</Panel>
		</Group>
	);
}
