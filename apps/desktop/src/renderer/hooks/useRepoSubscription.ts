import { useEffect } from "react";
import type { RepoChangeKind } from "../../shared/types";
import { trpc } from "../trpc/client";

const KIND_TO_INVALIDATIONS: Record<
	RepoChangeKind,
	ReadonlyArray<"workingTree" | "branch" | "commits" | "branchStatus">
> = {
	"working-tree": ["workingTree"],
	index: ["workingTree"],
	head: ["workingTree", "branch", "commits", "branchStatus"],
	refs: ["branch", "commits", "branchStatus"],
	state: ["branchStatus"],
};

export function useRepoSubscription(repoPath: string | null | undefined): void {
	const utils = trpc.useUtils();

	useEffect(() => {
		if (!repoPath) return;
		void window.electron.repo.subscribe(repoPath);

		const off = window.electron.repo.onInvalidate((event) => {
			if (event.repoPath !== repoPath) return;
			const targets = new Set<string>();
			for (const k of event.kinds) {
				for (const t of KIND_TO_INVALIDATIONS[k]) targets.add(t);
			}

			if (targets.has("workingTree")) {
				void utils.diff.getWorkingTreeStatus.invalidate({ repoPath });
				void utils.diff.getWorkingTreeDiff.invalidate({ repoPath });
			}
			if (targets.has("branch")) {
				void utils.diff.getBranchDiff.invalidate({ repoPath });
			}
			if (targets.has("commits")) {
				void utils.diff.getCommitsAhead.invalidate({ repoPath });
			}
			if (targets.has("branchStatus")) {
				void utils.branches.getStatus.invalidate();
			}
		});

		return () => {
			off();
			void window.electron.repo.unsubscribe(repoPath);
		};
	}, [repoPath, utils]);
}
