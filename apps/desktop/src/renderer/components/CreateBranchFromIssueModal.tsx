import { useEffect, useRef, useState } from "react";
import type { TicketIssue } from "../../shared/tickets";
import { slugifyBranchName } from "../lib/slugify";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
	issue: TicketIssue | null;
	onClose: () => void;
}

export function CreateBranchFromIssueModal({ issue, onClose }: Props) {
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [branchName, setBranchName] = useState("");
	const [baseBranch, setBaseBranch] = useState("");
	const branchInputRef = useRef<HTMLInputElement>(null);
	const utils = trpc.useUtils();

	const projectsQuery = trpc.projects.list.useQuery(undefined, {
		enabled: issue !== null,
		staleTime: 60_000,
	});

	const branchesQuery = trpc.branches.list.useQuery(
		{ projectId: selectedProjectId },
		{ enabled: !!selectedProjectId }
	);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const linkTicketMutation = trpc.tickets.linkTicket.useMutation({
		onSuccess: () => utils.tickets.getLinkedTickets.invalidate(),
		onError: (err) =>
			console.error("[linkTicket] Failed to link ticket to workspace:", err.message),
	});

	const createMutation = trpc.workspaces.create.useMutation({
		onSuccess: (workspace) => {
			if (issue) {
				linkTicketMutation.mutate({
					provider: issue.provider,
					ticketId: issue.id,
					workspaceId: workspace.id,
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

	// Pre-select the only ready project automatically
	useEffect(() => {
		if (projectsQuery.data && !selectedProjectId) {
			const ready = projectsQuery.data.filter((p) => p.status === "ready");
			if (ready.length === 1 && ready[0]) setSelectedProjectId(ready[0].id);
		}
	}, [projectsQuery.data, selectedProjectId]);

	// Pre-fill branch name whenever the issue changes
	useEffect(() => {
		if (!issue) return;
		setBranchName(slugifyBranchName(issue.identifier, issue.title));
	}, [issue]);

	// Default base branch when project branches load
	useEffect(() => {
		if (branchesQuery.data && branchesQuery.data.length > 0 && !baseBranch) {
			const first = branchesQuery.data[0];
			if (first) setBaseBranch(first.name);
		}
	}, [branchesQuery.data, baseBranch]);

	// Reset base branch when project changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional — selectedProjectId triggers the reset
	useEffect(() => {
		setBaseBranch("");
	}, [selectedProjectId]);

	// Focus the branch name input when modal opens
	useEffect(() => {
		if (issue) branchInputRef.current?.focus();
	}, [issue]);

	// Escape key to close
	useEffect(() => {
		if (!issue) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [issue, onClose]);

	// Reset form on close
	useEffect(() => {
		if (!issue) {
			setSelectedProjectId("");
			setBranchName("");
			setBaseBranch("");
			createMutation.reset();
		}
	}, [issue, createMutation.reset]);

	if (!issue) return null;

	const readyProjects = projectsQuery.data?.filter((p) => p.status === "ready") ?? [];
	const canSubmit = !!branchName.trim() && !!selectedProjectId && !createMutation.isPending;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!canSubmit) return;
		createMutation.mutate({
			projectId: selectedProjectId,
			branch: branchName.trim(),
			baseBranch: baseBranch || undefined,
		});
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] backdrop-blur-[2px]"
			onClick={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			<div className="w-[440px] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-[0_24px_48px_rgba(0,0,0,0.4)]">
				{/* Header */}
				<div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
					<h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">
						Create Branch
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-quaternary)] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-secondary)]"
					>
						<svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none">
							<path
								d="M4 4l8 8M12 4l-8 8"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>

				{/* Issue context pill */}
				<div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
					<span
						className="h-1.5 w-1.5 shrink-0 rounded-full"
						style={{ backgroundColor: issue.status.color }}
					/>
					<span className="shrink-0 text-[12px] font-medium text-[var(--text-quaternary)]">
						{issue.identifier}
					</span>
					<span className="truncate text-[12px] text-[var(--text-secondary)]">{issue.title}</span>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="flex flex-col gap-3.5 p-4">
					{/* Repository — hidden when only one project */}
					{readyProjects.length !== 1 && (
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="cbfi-project"
								className="text-[12px] font-medium text-[var(--text-tertiary)]"
							>
								Repository
							</label>
							<select
								id="cbfi-project"
								value={selectedProjectId}
								onChange={(e) => setSelectedProjectId(e.target.value)}
								className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
							>
								<option value="">Select repository…</option>
								{readyProjects.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</select>
						</div>
					)}

					{/* Branch name */}
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="cbfi-branch"
							className="text-[12px] font-medium text-[var(--text-tertiary)]"
						>
							Branch Name
						</label>
						<input
							ref={branchInputRef}
							id="cbfi-branch"
							type="text"
							value={branchName}
							onChange={(e) => setBranchName(e.target.value)}
							placeholder="eng-123/fix-authentication-bug"
							className="w-full rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus:outline-none"
						/>
					</div>

					{/* Base branch */}
					<div className="flex flex-col gap-1.5">
						<label
							htmlFor="cbfi-base"
							className="text-[12px] font-medium text-[var(--text-tertiary)]"
						>
							Base Branch
						</label>
						<select
							id="cbfi-base"
							value={baseBranch}
							onChange={(e) => setBaseBranch(e.target.value)}
							disabled={!selectedProjectId || branchesQuery.isPending}
							className="w-full appearance-none rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[13px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none disabled:opacity-40"
						>
							{!selectedProjectId && <option value="">Select a repository first</option>}
							{selectedProjectId && branchesQuery.isPending && <option value="">Loading…</option>}
							{branchesQuery.data?.map((b) => (
								<option key={b.name} value={b.name}>
									{b.name}
								</option>
							))}
						</select>
					</div>

					{/* Submit */}
					<button
						type="submit"
						disabled={!canSubmit}
						className="mt-0.5 w-full rounded-[var(--radius-md)] bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--accent-foreground)] transition-all duration-[120ms] hover:bg-[var(--accent-hover)] disabled:opacity-40"
					>
						{createMutation.isPending ? "Creating…" : "Create Branch"}
					</button>

					{createMutation.isError && (
						<p className="text-[12px] text-[var(--term-red)]">{createMutation.error.message}</p>
					)}
				</form>
			</div>
		</div>
	);
}
