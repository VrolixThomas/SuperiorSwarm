import { useBranchStore } from "../stores/branch-store";
import { useProjectStore } from "../stores/projects";
import { trpc } from "../trpc/client";
import { ThreeWayDiffEditor } from "./ThreeWayDiffEditor";

export function MergeConflictPane() {
	const mergeState = useBranchStore((s) => s.mergeState);
	const activeFile = mergeState?.activeFilePath ?? null;
	const projectId = useProjectStore((s) => s.selectedProjectId);

	const conflictQuery = trpc.merge.getFileConflict.useQuery(
		{ projectId: projectId ?? "", filePath: activeFile ?? "" },
		{ enabled: !!projectId && !!activeFile }
	);

	const utils = trpc.useUtils();
	const resolveMutation = trpc.merge.resolveFile.useMutation({
		onSuccess: (_data, variables) => {
			useBranchStore.getState().markFileResolved(variables.filePath);
			utils.merge.getConflicts.invalidate({ projectId: variables.projectId });
		},
	});

	if (!mergeState) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
				No merge in progress
			</div>
		);
	}

	if (!activeFile) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
				Select a conflicting file to resolve
			</div>
		);
	}

	if (conflictQuery.isLoading) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
				Loading conflict…
			</div>
		);
	}

	if (conflictQuery.error || !conflictQuery.data) {
		return (
			<div className="flex h-full items-center justify-center text-[13px] text-[var(--text-quaternary)]">
				Failed to load conflict content
			</div>
		);
	}

	function handleResolve(resolvedContent: string) {
		if (!projectId || !activeFile) return;
		resolveMutation.mutate({
			projectId,
			filePath: activeFile,
			content: resolvedContent,
		});
	}

	return (
		<ThreeWayDiffEditor
			key={activeFile}
			filePath={activeFile}
			content={conflictQuery.data}
			sourceBranch={mergeState.sourceBranch}
			targetBranch={mergeState.targetBranch}
			onResolve={handleResolve}
		/>
	);
}
