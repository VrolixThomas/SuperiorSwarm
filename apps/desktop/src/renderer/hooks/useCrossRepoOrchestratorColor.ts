import { useEffect, useMemo, useRef } from "react";
import { trpc } from "../trpc/client";

const PALETTE_SIZE = 8;

export function useCrossRepoOrchestratorColor(
	orchestratorId: string,
	allOrchestratorIds: string[]
): 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 {
	const colorsQuery = trpc.settings.getCrossRepoOrchestratorColors.useQuery(undefined, {
		staleTime: 60_000,
	});
	const setColors = trpc.settings.setCrossRepoOrchestratorColors.useMutation();

	// Capture mutate in a ref so its identity does not destabilize the write effect.
	const mutateRef = useRef(setColors.mutate);
	mutateRef.current = setColors.mutate;

	const existing = colorsQuery.data;

	// Stabilize array identity for downstream memo; join() collapses the array of
	// stable ids to a primitive that participates correctly in dep equality.
	const idsKey = allOrchestratorIds.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: idsKey is a stable primitive derived from allOrchestratorIds
	const computed = useMemo<Record<string, number>>(() => {
		const map: Record<string, number> = { ...(existing ?? {}) };
		const taken = new Set<number>();
		for (const id of allOrchestratorIds) {
			if (map[id] !== undefined) taken.add(map[id]);
		}
		let assignedCount = 0;
		for (const id of allOrchestratorIds) {
			if (map[id] !== undefined) continue;
			let pick = 0;
			let placed = false;
			for (let i = 0; i < PALETTE_SIZE; i++) {
				if (!taken.has(i)) {
					pick = i;
					placed = true;
					break;
				}
			}
			if (!placed) {
				// All slots taken — wrap via assignment order so colors actually cycle.
				pick = assignedCount % PALETTE_SIZE;
			}
			map[id] = pick;
			taken.add(pick);
			assignedCount++;
		}
		return map;
		// idsKey captures the stable identity of the ids list; existing changes on fetch
	}, [existing, idsKey]);

	useEffect(() => {
		if (!existing) return;
		const changed = Object.keys(computed).some((k) => computed[k] !== existing[k]);
		if (changed) mutateRef.current({ map: computed });
		// mutateRef is intentionally not in deps — its current value is read on demand.
	}, [computed, existing]);

	const idx = computed[orchestratorId] ?? 0;
	return (idx + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}
