import { useEffect, useState } from "react";
import type { GitHubPR } from "../../main/github/github";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

interface Props {
	pr: GitHubPR | null;
	onClose: () => void;
}

export function CreateWorktreeFromPRModal({ pr, onClose }: Props) {
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const utils = trpc.useUtils();

	const projectsQuery = trpc.github.getProjectsByRepo.useQuery(
		{ owner: pr?.repoOwner ?? "", repo: pr?.repoName ?? "" },
		{ enabled: !!pr, staleTime: 60_000 }
	);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const linkFromPRMutation = trpc.workspaces.linkFromPR.useMutation({
		onSuccess: (workspace) => {
			utils.workspaces.listByProject.invalidate();
			utils.github.getLinkedPRs.invalidate();

			if (workspace.worktreePath) {
				const title = workspace.name;
				const store = useTabStore.getState();
				store.setActiveWorkspace(workspace.id, workspace.worktreePath);
				const tabId = store.addTerminalTab(workspace.id, workspace.worktreePath, title);
				attachTerminal.mutate({ workspaceId: workspace.id, terminalId: tabId });
			}
			onClose();
		},
	});

	// Pre-select the project if only one matches
	useEffect(() => {
		const first = projectsQuery.data?.[0];
		if (first && !selectedProjectId) {
			setSelectedProjectId(first.id);
		}
	}, [projectsQuery.data, selectedProjectId]);

	if (!pr) return null;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedProjectId) return;

		linkFromPRMutation.mutate({
			projectId: selectedProjectId,
			prBranch: pr.branchName,
			prOwner: pr.repoOwner,
			prRepo: pr.repoName,
			prNumber: pr.number,
		});
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") onClose();
			}}
			role="presentation"
		>
			<div className="w-[480px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[var(--shadow-md)]">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<h2 className="text-[15px] font-semibold text-[var(--text)]">Link PR to Workspace</h2>
					<button
						type="button"
						onClick={onClose}
						className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
					<div className="flex flex-col gap-1.5">
						<span className="text-[13px] font-medium text-[var(--text-secondary)]">PR</span>
						<div className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text-tertiary)]">
							#{pr.number}: {pr.title}
						</div>
					</div>

					<div className="flex flex-col gap-1.5">
						<span className="text-[13px] font-medium text-[var(--text-secondary)]">Branch</span>
						<div className="rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)]">
							{pr.branchName}
						</div>
					</div>

					{projectsQuery.data && projectsQuery.data.length > 1 && (
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="project-select"
								className="text-[13px] font-medium text-[var(--text-secondary)]"
							>
								Project
							</label>
							<select
								id="project-select"
								value={selectedProjectId}
								onChange={(e) => setSelectedProjectId(e.target.value)}
								className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
							>
								{projectsQuery.data.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
					)}

					<button
						type="submit"
						disabled={!selectedProjectId || linkFromPRMutation.isPending}
						className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{linkFromPRMutation.isPending ? "Linking..." : "Link PR"}
					</button>

					{linkFromPRMutation.isError && (
						<p className="text-[12px] text-red-400">{linkFromPRMutation.error.message}</p>
					)}
				</form>
			</div>
		</div>
	);
}
