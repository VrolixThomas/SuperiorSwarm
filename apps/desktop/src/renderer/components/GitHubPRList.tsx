import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitHubPR } from "../../main/github/github";
import { useTabStore } from "../stores/tab-store";
import { trpc } from "../trpc/client";
import { CreateWorktreeFromPRModal } from "./CreateWorktreeFromPRModal";
import { type LinkedWorkspace, WorkspacePopover } from "./WorkspacePopover";

// ── Review decision badge ────────────────────────────────────────────────────

function ReviewBadge({ decision }: { decision: GitHubPR["reviewDecision"] }) {
	if (!decision) return null;
	const config = {
		approved: { label: "Approved", color: "text-green-400" },
		changes_requested: { label: "Changes", color: "text-red-400" },
		review_required: { label: "Review", color: "text-yellow-400" },
	} as const;
	const { label, color } = config[decision];
	return <span className={`shrink-0 text-[10px] font-medium ${color}`}>{label}</span>;
}

// ── Comment list (lazy-loaded when PR is expanded) ───────────────────────────

function PRCommentList({ owner, repo, number }: { owner: string; repo: string; number: number }) {
	const { data: comments, isLoading } = trpc.github.getPRComments.useQuery(
		{ owner, repo, number },
		{ staleTime: 60_000 }
	);

	if (isLoading) {
		return (
			<div className="mt-1 px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	if (!comments || comments.length === 0) {
		return <div className="px-3 py-1 text-[11px] text-[var(--text-quaternary)]">No comments</div>;
	}

	return (
		<div className="flex flex-col gap-1 py-1">
			{comments.map((comment) => (
				<div key={comment.id} className="rounded-[4px] bg-[var(--bg-elevated)] px-3 py-1.5">
					{comment.kind === "review" && comment.path && (
						<div className="mb-0.5 text-[10px] text-[var(--text-quaternary)] font-mono truncate">
							{comment.path}
							{comment.line ? `:${comment.line}` : ""}
						</div>
					)}
					<div className="text-[11px] text-[var(--text-tertiary)] line-clamp-3">{comment.body}</div>
					<div className="mt-0.5 text-[10px] text-[var(--text-quaternary)]">
						{comment.author} · {new Date(comment.createdAt).toLocaleDateString()}
					</div>
				</div>
			))}
		</div>
	);
}

// ── PR row ───────────────────────────────────────────────────────────────────

function PRRow({
	pr,
	linked,
	onLink,
	onNavigate,
	onShowPopover,
}: {
	pr: GitHubPR;
	linked: LinkedWorkspace[] | undefined;
	onLink: (pr: GitHubPR) => void;
	onNavigate: (ws: LinkedWorkspace, pr: GitHubPR) => void;
	onShowPopover: (pr: GitHubPR, workspaces: LinkedWorkspace[], rect: DOMRect) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
	const contextMenuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!contextMenu) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
				setContextMenu(null);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [contextMenu]);

	const isLinked = !!linked && linked.length > 0;

	return (
		<>
			<button
				type="button"
				onClick={(e) => {
					if (!isLinked) {
						onLink(pr);
					} else if (linked.length === 1 && linked[0]) {
						onNavigate(linked[0], pr);
					} else {
						onShowPopover(pr, linked, e.currentTarget.getBoundingClientRect());
					}
				}}
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				className={`flex w-full items-center gap-1.5 rounded-[6px] px-3 py-1 text-left text-[12px] transition-all duration-[120ms] hover:bg-[var(--bg-elevated)] ${
					isLinked
						? "text-[var(--text-secondary)]"
						: "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
				}`}
				title={`${pr.repoOwner}/${pr.repoName}#${pr.number}`}
			>
				{/* Expand/Collapse toggle — must remain a div, not a button, because
				    nesting <button> inside <button> is invalid HTML and breaks the
				    outer row button's click handler. */}
				{/* biome-ignore lint/a11y/useSemanticElements: cannot nest <button> inside <button> */}
				<div
					role="button"
					tabIndex={0}
					onClick={(e) => {
						e.stopPropagation();
						setExpanded((v) => !v);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.stopPropagation();
							setExpanded((v) => !v);
						}
					}}
					className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-tertiary)]"
				>
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						className={`transition-transform duration-[120ms] ${expanded ? "rotate-90" : ""}`}
					>
						<path d="m9 18 6-6-6-6" />
					</svg>
				</div>

				{/* Draft indicator */}
				{pr.isDraft && (
					<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">[Draft]</span>
				)}
				<span className="min-w-0 flex-1 truncate">{pr.title}</span>
				<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
					{pr.repoOwner}/{pr.repoName}
				</span>
				<ReviewBadge decision={pr.reviewDecision} />
				{/* Comment count */}
				{pr.commentCount > 0 && (
					<span className="shrink-0 text-[10px] text-[var(--text-quaternary)]">
						{pr.commentCount}
					</span>
				)}
				{/* Linked indicator */}
				{isLinked && (
					<svg
						aria-hidden="true"
						width="10"
						height="10"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						className="shrink-0 text-[var(--accent)]"
					>
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
					</svg>
				)}
			</button>

			{/* Expanded comments */}
			{expanded && <PRCommentList owner={pr.repoOwner} repo={pr.repoName} number={pr.number} />}

			{/* Simple context menu */}
			{contextMenu && (
				<div
					ref={contextMenuRef}
					className="fixed z-50 min-w-[160px] rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-overlay)] py-1 shadow-lg"
					style={{ top: contextMenu.y, left: contextMenu.x }}
				>
					<button
						type="button"
						className="flex w-full items-center px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
						onClick={() => {
							setContextMenu(null);
							window.electron.shell.openExternal(pr.url);
						}}
					>
						Open on GitHub
					</button>
					{!isLinked && (
						<button
							type="button"
							className="flex w-full items-center px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
							onClick={() => {
								setContextMenu(null);
								onLink(pr);
							}}
						>
							Link to workspace
						</button>
					)}
				</div>
			)}
		</>
	);
}

// ── Group header ─────────────────────────────────────────────────────────────

function GroupLabel({ label }: { label: string }) {
	return (
		<div className="px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-quaternary)]">
			{label}
		</div>
	);
}

// ── Main list ────────────────────────────────────────────────────────────────

export function GitHubPRList() {
	const utils = trpc.useUtils();
	const [openModalPR, setOpenModalPR] = useState<GitHubPR | null>(null);
	const [linkError, setLinkError] = useState<string | null>(null);
	const [popover, setPopover] = useState<{
		position: { x: number; y: number };
		pr: GitHubPR;
		workspaces: LinkedWorkspace[];
	} | null>(null);

	const { data: prs, isLoading } = trpc.github.getMyPRs.useQuery(undefined, {
		staleTime: 30_000,
		refetchInterval: 60_000,
	});

	const { data: linkedPRs } = trpc.github.getLinkedPRs.useQuery(undefined, { staleTime: 30_000 });

	const linkedMap = useMemo(() => {
		const map = new Map<string, LinkedWorkspace[]>();
		if (!linkedPRs) return map;
		for (const l of linkedPRs) {
			if (l.worktreePath === null) continue;
			const key = `${l.prRepoOwner}/${l.prRepoName}#${l.prNumber}`;
			const entry: LinkedWorkspace = {
				workspaceId: l.workspaceId,
				workspaceName: l.workspaceName,
				worktreePath: l.worktreePath,
			};
			const existing = map.get(key);
			if (existing) {
				existing.push(entry);
			} else {
				map.set(key, [entry]);
			}
		}
		return map;
	}, [linkedPRs]);

	const attachTerminal = trpc.workspaces.attachTerminal.useMutation();
	const attachTerminalRef = useRef(attachTerminal.mutate);
	attachTerminalRef.current = attachTerminal.mutate;

	const navigateToWorkspace = useCallback((ws: LinkedWorkspace, pr: GitHubPR) => {
		const store = useTabStore.getState();
		store.setActiveWorkspace(ws.workspaceId, ws.worktreePath);

		const prCtx: import("../../shared/github-types").GitHubPRContext = {
			owner: pr.repoOwner,
			repo: pr.repoName,
			number: pr.number,
			title: pr.title,
			sourceBranch: pr.branchName,
			targetBranch: "main", // We'll update this from PR details once loaded
			repoPath: ws.worktreePath,
		};
		store.openPRReviewPanel(ws.workspaceId, prCtx);

		const existing = store.getTabsByWorkspace(ws.workspaceId);
		const hasTerminal = existing.some((t) => t.kind === "terminal");
		if (!hasTerminal) {
			const title = ws.workspaceName ?? ws.workspaceId;
			const tabId = store.addTerminalTab(ws.workspaceId, ws.worktreePath, title);
			attachTerminalRef.current({ workspaceId: ws.workspaceId, terminalId: tabId });
		}
	}, []);

	const handleLink = async (pr: GitHubPR) => {
		const projects = await utils.github.getProjectsByRepo.fetch({
			owner: pr.repoOwner,
			repo: pr.repoName,
		});

		if (projects.length === 0) {
			setLinkError(`Repository ${pr.repoOwner}/${pr.repoName} is not tracked in BranchFlux.`);
			return;
		}
		setLinkError(null);

		setOpenModalPR(pr);
	};

	if (isLoading && !prs) {
		return (
			<div className="px-3 py-1">
				<div className="h-3 w-24 animate-pulse rounded bg-[var(--bg-elevated)]" />
			</div>
		);
	}

	const authored = (prs ?? []).filter((p) => p.role === "author");
	const reviewing = (prs ?? []).filter((p) => p.role === "reviewer");

	if (authored.length === 0 && reviewing.length === 0) {
		return <div className="px-3 py-1 text-[12px] text-[var(--text-quaternary)]">No open PRs</div>;
	}

	return (
		<>
			{linkError && (
				<div className="mx-3 my-1 rounded-[var(--radius-sm)] bg-[var(--bg-elevated)] px-3 py-2 text-[11px] text-red-400">
					{linkError}
				</div>
			)}
			<div className="flex flex-col gap-0.5">
				{authored.length > 0 && (
					<>
						<GroupLabel label="Authored" />
						{authored.map((pr) => (
							<PRRow
								key={pr.id}
								pr={pr}
								linked={linkedMap.get(`${pr.repoOwner}/${pr.repoName}#${pr.number}`)}
								onLink={handleLink}
								onNavigate={navigateToWorkspace}
								onShowPopover={(pr, workspaces, rect) =>
									setPopover({
										position: { x: rect.left, y: rect.bottom + 4 },
										pr,
										workspaces,
									})
								}
							/>
						))}
					</>
				)}
				{reviewing.length > 0 && (
					<>
						<GroupLabel label="Reviewing" />
						{reviewing.map((pr) => (
							<PRRow
								key={pr.id}
								pr={pr}
								linked={linkedMap.get(`${pr.repoOwner}/${pr.repoName}#${pr.number}`)}
								onLink={handleLink}
								onNavigate={navigateToWorkspace}
								onShowPopover={(pr, workspaces, rect) =>
									setPopover({
										position: { x: rect.left, y: rect.bottom + 4 },
										pr,
										workspaces,
									})
								}
							/>
						))}
					</>
				)}
			</div>

			{popover && (
				<WorkspacePopover
					position={popover.position}
					workspaces={popover.workspaces}
					onClose={() => setPopover(null)}
					onCreateBranch={() => {
						setPopover(null);
						handleLink(popover.pr);
					}}
				/>
			)}

			<CreateWorktreeFromPRModal pr={openModalPR} onClose={() => setOpenModalPR(null)} />
		</>
	);
}
