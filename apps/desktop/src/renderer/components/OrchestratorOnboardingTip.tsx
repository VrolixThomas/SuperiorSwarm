import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";

const TIP_KEY = "orchTip:dismissed";

/**
 * Single onboarding tip rendered once at the bottom of the project list.
 * Target project for the "Create one →" click is the user's active selection;
 * if nothing is selected, the tip stays hidden.
 */
export function OrchestratorOnboardingTip() {
	const utils = trpc.useUtils();
	const selectedProjectId = useProjectStore((s) => s.selectedProjectId);
	const openCreateWorktreeModal = useProjectStore((s) => s.openCreateWorktreeModal);

	const tipQuery = trpc.workspaces.getOrchestratorExpand.useQuery(
		{ key: TIP_KEY },
		{ staleTime: Number.POSITIVE_INFINITY }
	);
	const dismissTip = trpc.workspaces.setOrchestratorExpand.useMutation({
		onSuccess: (_data, vars) => {
			utils.workspaces.getOrchestratorExpand.setData({ key: vars.key }, vars.value);
		},
	});
	const tipDismissed = tipQuery.data === false; // inverted convention

	const targetProjectId = selectedProjectId ?? "";
	const treeQuery = trpc.workspaces.listByProject.useQuery(
		{ projectId: targetProjectId },
		{ enabled: targetProjectId !== "", staleTime: 60_000 }
	);

	if (tipDismissed) return null;
	if (!targetProjectId) return null;
	if (!treeQuery.data) return null;
	if (treeQuery.data.orchestrators.length > 0) return null;

	return (
		<div className="mx-2 mt-1 flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-3">
			<svg
				role="img"
				aria-label=""
				width="12"
				height="12"
				viewBox="0 0 12 12"
				fill="none"
				className="mt-[2px] shrink-0 text-[var(--text-tertiary)]"
			>
				<circle cx="6" cy="2.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
				<circle cx="2.5" cy="9.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
				<circle cx="9.5" cy="9.5" r="1.4" stroke="currentColor" strokeWidth="1.2" />
				<path d="M6 4 L3 8 M6 4 L9 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
			</svg>
			<button
				type="button"
				className="flex-1 text-left text-[11px] text-[var(--text-secondary)] leading-snug"
				onClick={() =>
					openCreateWorktreeModal(targetProjectId, { asOrchestrator: true })
				}
			>
				Orchestrators coordinate multiple agents. Create one →
			</button>
			<button
				type="button"
				aria-label="Dismiss tip"
				className="text-[11px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
				onClick={() => dismissTip.mutate({ key: TIP_KEY, value: false })}
			>
				×
			</button>
		</div>
	);
}
