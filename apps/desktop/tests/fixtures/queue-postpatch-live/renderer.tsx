import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { registerCoreActions } from "../../../src/renderer/actions/core-actions";
import { MainLayout } from "../../../src/renderer/components/MainLayout";
import { NavRail } from "../../../src/renderer/components/NavRail";
import { Sidebar } from "../../../src/renderer/components/Sidebar";
import { QueueView } from "../../../src/renderer/components/queue/QueueView";
import { WorkspaceQueueSync } from "../../../src/renderer/hooks/useWorkspaceQueue";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";
registerCoreActions();
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
Object.assign(window, {
	queueProbe: {
		prepare(id: string, cwd: string, terminal: string, sibling: string) {
			const s = useTabStore.getState();
			s.addTerminalTab(id, cwd, "Actual provider", terminal);
			s.addTerminalTab(id, cwd, "Unrelated sibling", sibling);
			s.setActiveWorkspace(id, cwd);
			s.setActiveTab(sibling);
			s.setSidebarSegment("queue");
		},
		direct(id: string, cwd: string, terminal: string) {
			const store = useTabStore.getState();
			store.navigateToWorkspace(id, cwd);
			store.setActiveTab(terminal);
		},
		queue() {
			useTabStore.getState().setSidebarSegment("queue");
		},
		active() {
			return {
				workspace: useTabStore.getState().activeWorkspaceId,
				terminal: useTabStore.getState().getActiveTabId(),
			};
		},
	},
});
function Surface() {
	const segment = useTabStore((s) => s.sidebarSegment);
	const workspace = useTabStore((s) => s.activeWorkspaceId);
	const terminal = useTabStore((s) => s.getActiveTabId());
	const attachOnly = useTabStore(
		(s) => !!terminal && s.terminalCreateIntents[terminal] === "attach-existing-only"
	);
	return (
		<>
			<WorkspaceQueueSync />
			<NavRail />
			<div className="ml-[72px] min-w-0">
				<MainLayout
					sidebar={(collapsed, onExpand) => <Sidebar collapsed={collapsed} onExpand={onExpand} />}
					diff={<aside data-workspace-diff>Repository tools</aside>}
				>
					{segment === "queue" ? (
						<QueueView />
					) : (
						<main data-queue-workspace={workspace} tabIndex={-1} className="p-8">
							<h1>Workspace</h1>
							<div data-terminal-id={terminal} data-attach-only={attachOnly}>
								<textarea
									aria-label="Agent input"
									className="xterm-helper-textarea"
									onInput={(event) => {
										const data = (event.nativeEvent as InputEvent).data;
										if (data && terminal) window.electron.terminal.write(terminal, data);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !event.shiftKey && terminal) {
											event.preventDefault();
											window.electron.terminal.write(terminal, "\r");
											event.currentTarget.value = "";
										}
									}}
								/>
							</div>
						</main>
					)}
				</MainLayout>
			</div>
		</>
	);
}
const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
