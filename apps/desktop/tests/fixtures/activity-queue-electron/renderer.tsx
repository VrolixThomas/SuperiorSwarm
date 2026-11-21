import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { ActivityQueueButton } from "../../../src/renderer/components/ActivityQueueButton";
import { ActivityQueueDock } from "../../../src/renderer/components/ActivityQueueDock";
import { useActivityQueueStore } from "../../../src/renderer/stores/activity-queue-store";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
import { trpc, trpcVanilla } from "../../../src/renderer/trpc/client";

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const host = document.getElementById("root");
if (!host) throw new Error("Missing fixture root");
useTabStore.getState().addTerminalTab("workspace", "/tmp", "Codex", "terminal");
function Surface() {
	const open = useActivityQueueStore((state) => state.open);
	const active = useTabStore((state) => state.activeWorkspaceId);
	return (
		<div className="flex h-screen min-w-0 bg-[var(--bg-base)] text-[var(--text)]">
			<aside className="flex w-[232px] shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
				<div className="flex h-[52px] items-center border-b border-[var(--border-subtle)] px-4 text-[12px] font-semibold">
					SuperiorSwarm
				</div>
				<div className="flex-1 p-3 text-[12px] text-[var(--text-secondary)]">
					<p className="mb-4">Projects · Tickets · PRs · Agents</p>
					<p>Native queue</p>
					<p className="mt-2 pl-3">Codex native turn</p>
				</div>
				<footer className="flex items-center gap-2 border-t border-[var(--border-subtle)] p-2">
					<ActivityQueueButton />
					<button
						type="button"
						className="rounded px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
					>
						Settings
					</button>
				</footer>
			</aside>
			<main data-queue-workspace="workspace" tabIndex={-1} className="min-w-0 flex-1">
				<div className="flex h-[52px] items-center border-b border-[var(--border-subtle)] px-4 text-[12px] text-[var(--text-secondary)]">
					{active === "workspace" ? "Codex native turn" : "Workspace"}
				</div>
				<div data-terminal-id="terminal" className="p-5">
					<p className="mb-4 text-xs text-[var(--text-secondary)]">
						Native test session · source remains interactive
					</p>
					<textarea
						aria-label="Agent input"
						onInput={(event) => {
							const data = (event.nativeEvent as InputEvent).data;
							if (data) window.electron.terminal.write("terminal", data);
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								window.electron.terminal.write("terminal", "\r");
								event.currentTarget.value = "";
							}
						}}
						className="xterm-helper-textarea w-full resize-none rounded border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-xs outline-[var(--accent)]"
						placeholder="Continue working here…"
					/>
				</div>
			</main>
			<div
				className={
					open
						? "w-[320px] shrink-0 border-l border-[var(--border)] xl:w-[360px]"
						: "w-0 overflow-hidden"
				}
			>
				<ActivityQueueDock />
			</div>
		</div>
	);
}
createRoot(host).render(
	<trpc.Provider client={trpcVanilla} queryClient={client}>
		<QueryClientProvider client={client}>
			<Surface />
		</QueryClientProvider>
	</trpc.Provider>
);
