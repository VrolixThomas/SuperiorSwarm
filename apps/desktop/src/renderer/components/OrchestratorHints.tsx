import { useOrchestratorHintsStore } from "../stores/orchestrator-hints";
import { trpc } from "../trpc/client";

const COACHMARK_KEY = "orchDragCoachmark:dismissed";

/**
 * Global coachmark popover rendered once at the App level.
 * Anchor + fired state lives in `useOrchestratorHintsStore` so multiple
 * `ProjectItem` instances cannot stack duplicate popovers.
 */
export function OrchestratorCoachmark() {
	const coachmarkAnchor = useOrchestratorHintsStore((s) => s.coachmarkAnchor);
	const clearCoachmark = useOrchestratorHintsStore((s) => s.clearCoachmark);
	const utils = trpc.useUtils();

	const coachmarkQuery = trpc.workspaces.getOrchestratorExpand.useQuery(
		{ key: COACHMARK_KEY },
		{ staleTime: Number.POSITIVE_INFINITY }
	);
	const dismissCoachmark = trpc.workspaces.setOrchestratorExpand.useMutation({
		onSuccess: (_data, vars) => {
			utils.workspaces.getOrchestratorExpand.setData({ key: vars.key }, vars.value);
		},
	});
	const coachmarkDismissed = coachmarkQuery.data === false;

	if (coachmarkDismissed || !coachmarkAnchor) return null;

	return (
		<div
			role="status"
			className="fixed z-50 max-w-[220px] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-[11px] text-[var(--text-secondary)] shadow-[var(--shadow-md)]"
			style={{ left: coachmarkAnchor.x + 16, top: coachmarkAnchor.y }}
		>
			<div className="leading-snug">Drag to reorder, or onto an orchestrator row to attach.</div>
			<button
				type="button"
				className="mt-2 text-[10px] text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
				onClick={() => {
					dismissCoachmark.mutate({ key: COACHMARK_KEY, value: false });
					clearCoachmark();
				}}
			>
				Got it
			</button>
		</div>
	);
}
