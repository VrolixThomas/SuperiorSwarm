import { useEffect, useMemo } from "react";
import { trpc } from "../trpc/client";

const PALETTE_SIZE = 3; // matches --orch-1, --orch-2, --orch-3

export function useOrchestratorColor(
	orchestratorId: string,
	projectId: string,
	allOrchestratorIds: string[]
): 1 | 2 | 3 {
	const colorsQuery = trpc.workspaces.getOrchestratorColors.useQuery(
		{ projectId },
		{ staleTime: 60_000 }
	);
	const setColors = trpc.workspaces.setOrchestratorColors.useMutation();

	const existing = colorsQuery.data;

	const computed = useMemo<Record<string, number>>(() => {
		const map: Record<string, number> = { ...(existing ?? {}) };
		const taken = new Set<number>();
		for (const id of allOrchestratorIds) if (map[id] !== undefined) taken.add(map[id]);
		for (const id of allOrchestratorIds) {
			if (map[id] !== undefined) continue;
			let pick = 0;
			for (let i = 0; i < PALETTE_SIZE; i++) {
				if (!taken.has(i)) {
					pick = i;
					break;
				}
				pick = i; // fallback: cycle
			}
			map[id] = pick;
			taken.add(pick);
		}
		return map;
	}, [existing, allOrchestratorIds]);

	useEffect(() => {
		if (!existing) return;
		// Only write if anything changed
		const changed = Object.keys(computed).some((k) => computed[k] !== existing[k]);
		if (changed) setColors.mutate({ projectId, map: computed });
	}, [computed, existing, projectId, setColors]);

	const idx = computed[orchestratorId] ?? 0;
	return (idx + 1) as 1 | 2 | 3;
}
