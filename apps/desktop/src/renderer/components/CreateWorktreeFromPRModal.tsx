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
	const [branchName, setBranchName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const utils = trpc.useUtils();

	const projectsQuery = trpc.github.getProjectsByRepo.useQuery(
		{ owner: pr?.repoOwner ?? "", repo: pr?.repoName ?? "" },
		{ enabled: !!pr, staleTime: 60_000 }
	);

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId: selectedProjectId },
		{ enabled: !!selectedProjectId }
	);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();

	const linkPRMutation = trpc.github.linkPR.useMutation({
		onSuccess: () => utils.github.getLinkedPRs.invalidate(),
		onError: (err) => console.error("[linkPR] Failed to link PR to workspace:", err.message),
	});

	const createMutation = trpc.workspaces.create.useMutation({
		onSuccess: (workspace) => {
			if (pr) {
				linkPRMutation.mutate({
					workspaceId: workspace.id,
					owner: pr.repoOwner,
					repo: pr.repoName,
					number: pr.number,
				});
			}
			utils.workspaces.listByProject.invalidate();

			const project = projectsQuery.data?.find((p) => p.id === selectedProjectId);
			if (project) {
				const normalizedPath = project.repoPath.replace(/\/+$/, "");
				const cwd = `${normalizedPath}-worktrees/${workspace.name}`;
				const title = `${project.name}: ${workspace.name}`;
				const store = useTabStore.getState();
				store.setActiveWorkspace(workspace.id, cwd);
				const tabId = store.addTerminalTab(workspace.id, cwd, title);
				attachTerminal.mutate({ workspaceId: workspace.id, terminalId: tabId });
			}
			onClose();
		},
	});

	// Pre-select the project if only one matches
	useEffect(() => {
		if (projectsQuery.data && projectsQuery.data.length > 0 && !selectedProjectId) {
			setSelectedProjectId(projectsQuery.data[0].id);
		}
	}, [projectsQuery.data, selectedProjectId]);

	// Pre-fill branch name from PR
	useEffect(() => {
		if (pr) {
			setBranchName(pr.branchName);
		}
	}, [pr]);

	// Default base branch
	useEffect(() => {
		if (branchesQuery.data && branchesQuery.data.length > 0 && !baseBranch) {
			const first = branchesQuery.data[0];
			if (first) setBaseBranch(first);
		}
	}, [branchesQuery.data, baseBranch]);

	if (!pr) return null;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedProjectId || !branchName.trim()) return;

		createMutation.mutate({
			projectId: selectedProjectId,
			branch: branchName.trim(),
			baseBranch: baseBranch || undefined,
		});
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={() => {}}
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

					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="branch-name-input"
							className="text-[13px] font-medium text-[var(--text-secondary)]"
						>
							Branch Name
						</label>
						<input
							id="branch-name-input"
							type="text"
							value={branchName}
							onChange={(e) => setBranchName(e.target.value)}
							className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
						/>
					</div>

					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="base-branch-select"
							className="text-[13px] font-medium text-[var(--text-secondary)]"
						>
							Base Branch
						</label>
						<select
							id="base-branch-select"
							value={baseBranch}
							onChange={(e) => setBaseBranch(e.target.value)}
							className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--accent)]"
						>
							{branchesQuery.data?.map((b) => (
								<option key={b} value={b}>
									{b}
								</option>
							))}
						</select>
					</div>

					<button
						type="submit"
						disabled={!selectedProjectId || !branchName.trim() || createMutation.isPending}
						className="w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-white transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-50"
					>
						{createMutation.isPending ? "Creating Workspace..." : "Create Workspace & Link PR"}
					</button>

					{createMutation.isError && (
						<p className="text-[12px] text-red-400">{createMutation.error.message}</p>
					)}
				</form>
			</div>
		</div>
	);
}
