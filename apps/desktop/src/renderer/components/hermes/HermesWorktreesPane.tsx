import type { KeyboardEvent } from "react";
import type {
	HermesLinkedWorkspace,
	HermesSessionHistory,
	HermesSessionPane,
	HermesSessionSelection,
} from "../../../shared/hermes";

export type { HermesSessionPane } from "../../../shared/hermes";

export function nextHermesSessionPane(
	activePane: HermesSessionPane,
	key: string
): HermesSessionPane | null {
	switch (key) {
		case "ArrowLeft":
		case "ArrowRight":
			return activePane === "chat" ? "worktrees" : "chat";
		case "Home":
			return "chat";
		case "End":
			return "worktrees";
		default:
			return null;
	}
}

export function resolveHermesWorkspaceSessionId(
	selectedSessionId: string | null,
	history: Pick<HermesSessionHistory, "durableSessionId"> | undefined
): string {
	return selectedSessionId ?? history?.durableSessionId ?? "";
}

export interface HermesRecoveryWorktree {
	id: string;
	name: string;
	projectName: string;
	branch: string | null;
	worktreePath: string | null;
}

export interface HermesWorktreeGroup {
	key: string;
	projectName: string;
	worktrees: HermesLinkedWorkspace[];
}

export function groupHermesWorktrees(links: HermesLinkedWorkspace[]): HermesWorktreeGroup[] {
	const groups = new Map<string, HermesWorktreeGroup>();
	for (const link of links) {
		const missing = link.missing || !link.projectName;
		const key = missing ? "missing" : `project:${link.projectId ?? link.projectName}`;
		const projectName = missing
			? "Missing or deleted Worktrees"
			: (link.projectName ?? "Unknown repository");
		const group: HermesWorktreeGroup = groups.get(key) ?? { key, projectName, worktrees: [] };
		group.worktrees.push(link);
		groups.set(key, group);
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			worktrees: [...group.worktrees].sort((left, right) =>
				(left.branch ?? left.workspaceName ?? left.workspaceId).localeCompare(
					right.branch ?? right.workspaceName ?? right.workspaceId
				)
			),
		}))
		.sort((left, right) => {
			if (left.key === "missing") return 1;
			if (right.key === "missing") return -1;
			return left.projectName.localeCompare(right.projectName);
		});
}

export interface HermesWorktreeNavigationActions {
	openWorkspaceFromHermes: (
		workspaceId: string,
		worktreePath: string,
		selection: HermesSessionSelection,
		pane: HermesSessionPane
	) => void;
	getTabsByWorkspace: (workspaceId: string) => Array<{ kind: string }>;
	addTerminalTab: (workspaceId: string, worktreePath: string, branch: string) => string;
	attachTerminal: (workspaceId: string, terminalId: string) => void;
}

export function openHermesLinkedWorktree(
	link: HermesLinkedWorkspace,
	selection: HermesSessionSelection,
	actions: HermesWorktreeNavigationActions
): boolean {
	if (link.missing || !link.worktreePath) return false;
	actions.openWorkspaceFromHermes(
		link.workspaceId,
		link.worktreePath,
		{ ...selection, profileId: link.profileId },
		"worktrees"
	);
	const tabs = actions.getTabsByWorkspace(link.workspaceId);
	if (!link.hasTerminal && !tabs.some((tab) => tab.kind === "terminal")) {
		const terminalId = actions.addTerminalTab(
			link.workspaceId,
			link.worktreePath,
			link.branch ?? "Hermes"
		);
		actions.attachTerminal(link.workspaceId, terminalId);
	}
	return true;
}

export function HermesSessionTabStrip({
	activePane,
	worktreeCount,
	onSelect,
}: {
	activePane: HermesSessionPane;
	worktreeCount: number;
	onSelect: (pane: HermesSessionPane) => void;
}) {
	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, pane: HermesSessionPane) {
		const nextPane = nextHermesSessionPane(pane, event.key);
		if (!nextPane) return;
		event.preventDefault();
		onSelect(nextPane);
		event.currentTarget.parentElement
			?.querySelector<HTMLButtonElement>(`#hermes-${nextPane}-tab`)
			?.focus();
	}

	return (
		<div
			role="tablist"
			aria-label="Agent session views"
			className="app-no-drag flex shrink-0 items-center rounded-[8px] bg-[var(--bg-elevated)] p-0.5"
		>
			<button
				id="hermes-chat-tab"
				type="button"
				role="tab"
				aria-selected={activePane === "chat"}
				aria-controls="hermes-chat-panel"
				tabIndex={activePane === "chat" ? 0 : -1}
				onClick={() => onSelect("chat")}
				onKeyDown={(event) => handleKeyDown(event, "chat")}
				className={`rounded-[6px] px-2.5 py-1 text-[10px] font-medium ${
					activePane === "chat"
						? "bg-[var(--bg-overlay)] text-[var(--text)]"
						: "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
				}`}
			>
				Chat
			</button>
			<button
				id="hermes-worktrees-tab"
				type="button"
				role="tab"
				aria-selected={activePane === "worktrees"}
				aria-controls="hermes-worktrees-panel"
				tabIndex={activePane === "worktrees" ? 0 : -1}
				onClick={() => onSelect("worktrees")}
				onKeyDown={(event) => handleKeyDown(event, "worktrees")}
				className={`flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[10px] font-medium ${
					activePane === "worktrees"
						? "bg-[var(--bg-overlay)] text-[var(--text)]"
						: "text-[var(--text-quaternary)] hover:text-[var(--text-secondary)]"
				}`}
			>
				Worktrees
				<span
					aria-label={`${worktreeCount} linked worktrees`}
					className="min-w-4 rounded-full bg-[var(--bg-base)] px-1 text-center text-[9px] tabular-nums text-[var(--text-tertiary)]"
				>
					{worktreeCount}
				</span>
			</button>
		</div>
	);
}

function phaseClasses(phase: HermesLinkedWorkspace["currentPhase"]): string {
	switch (phase) {
		case "working":
			return "bg-[var(--accent-subtle)] text-[var(--accent)]";
		case "blocked":
			return "bg-[var(--warning-subtle)] text-[var(--warning)]";
		case "done":
			return "bg-[var(--success-subtle)] text-[var(--success)]";
		default:
			return "bg-[var(--bg-overlay)] text-[var(--text-tertiary)]";
	}
}

export function HermesWorktreesPane({
	links,
	availableWorktrees,
	recoveryWorktreeId,
	recoveryPending,
	hidden = false,
	onOpen,
	onRecoveryChange,
	onRecoveryLink,
	onRecoveryUnlink,
}: {
	links: HermesLinkedWorkspace[];
	availableWorktrees: HermesRecoveryWorktree[];
	recoveryWorktreeId: string;
	recoveryPending: boolean;
	hidden?: boolean;
	onOpen: (link: HermesLinkedWorkspace) => void;
	onRecoveryChange: (workspaceId: string) => void;
	onRecoveryLink: () => void;
	onRecoveryUnlink: (link: HermesLinkedWorkspace) => void;
}) {
	const groups = groupHermesWorktrees(links);
	const recoveryChoices = availableWorktrees.filter(
		(candidate) =>
			candidate.worktreePath && !links.some((link) => link.workspaceId === candidate.id)
	);

	return (
		<section
			id="hermes-worktrees-panel"
			role="tabpanel"
			aria-labelledby="hermes-worktrees-tab"
			hidden={hidden}
			className={`${hidden ? "hidden" : ""} min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-5 sm:px-6`}
		>
			<div className="mx-auto w-full max-w-[960px]">
				{groups.length === 0 ? (
					<div className="rounded-[14px] border border-dashed border-[var(--border)] px-6 py-12 text-center">
						<div className="text-[13px] font-medium text-[var(--text-secondary)]">
							No Worktrees yet
						</div>
						<p className="mx-auto mt-1 max-w-[480px] text-[11px] leading-5 text-[var(--text-quaternary)]">
							Hermes will add worktrees here when repository changes are needed.
						</p>
					</div>
				) : (
					<div className="flex min-w-0 flex-col gap-5">
						{groups.map((group) => (
							<section key={group.key} className="min-w-0">
								<h2 className="mb-2 truncate text-[11px] font-semibold text-[var(--text-secondary)]">
									{group.projectName}
								</h2>
								<div className="flex min-w-0 flex-col gap-2">
									{group.worktrees.map((link) => {
										const missing = link.missing || !link.worktreePath;
										const branch = link.branch ?? link.workspaceName ?? link.workspaceId;
										const statusId = `hermes-worktree-${link.id}-status`;
										const needsId = link.needs ? `hermes-worktree-${link.id}-needs` : null;
										return (
											<button
												key={link.id}
												type="button"
												data-worktree-id={link.workspaceId}
												disabled={missing}
												onClick={() => onOpen(link)}
												aria-describedby={[statusId, needsId].filter(Boolean).join(" ")}
												className="min-w-0 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 text-left hover:border-[var(--border-active)] hover:bg-[var(--bg-overlay)] disabled:cursor-not-allowed disabled:border-[var(--danger)]/20 disabled:bg-[var(--danger-subtle)]"
											>
												<span className="flex min-w-0 items-center gap-2">
													<span
														className={`min-w-0 flex-1 truncate text-[12px] font-medium ${missing ? "text-[var(--danger)]" : "text-[var(--text)]"}`}
													>
														{!missing && <span className="sr-only">Branch: </span>}
														{missing ? "Missing or deleted" : branch}
													</span>
													{!missing && (
														<span
															className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium capitalize ${phaseClasses(link.currentPhase)}`}
														>
															<span className="sr-only">Phase: </span>
															{link.currentPhase ?? "idle"}
														</span>
													)}
												</span>
												<span
													id={statusId}
													className="mt-1 block truncate text-[10px] text-[var(--text-quaternary)]"
												>
													<span className="sr-only">
														{missing ? "Missing worktree ID: " : "Status: "}
													</span>
													{missing ? link.workspaceId : (link.statusText ?? "No status update")}
												</span>
												{!missing && link.needs && (
													<span
														id={needsId ?? undefined}
														className="mt-1 block text-[10px] leading-4 text-[var(--warning)] [overflow-wrap:anywhere]"
													>
														<span className="font-medium">Needs:</span> {link.needs}
													</span>
												)}
											</button>
										);
									})}
								</div>
							</section>
						))}
					</div>
				)}

				<details className="mt-6 rounded-[10px] border border-[var(--border-subtle)] bg-[var(--bg-base)]/40">
					<summary className="cursor-pointer list-none px-3 py-2 text-[10px] font-medium text-[var(--text-quaternary)] hover:text-[var(--text-secondary)] [&::-webkit-details-marker]:hidden">
						Recovery options
					</summary>
					<div className="border-t border-[var(--border-subtle)] p-3">
						<p className="mb-2 text-[10px] leading-4 text-[var(--text-quaternary)]">
							Use these controls only to restore or remove a worktree link when automatic MCP
							linking could not recover it.
						</p>
						<div className="flex min-w-0 gap-1.5">
							<select
								value={recoveryWorktreeId}
								onChange={(event) => onRecoveryChange(event.target.value)}
								aria-label="Choose a recovery worktree"
								className="w-0 min-w-0 flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-[10px] text-[var(--text-tertiary)]"
							>
								<option value="">Choose a recovery worktree…</option>
								{recoveryChoices.map((candidate) => (
									<option key={candidate.id} value={candidate.id}>
										{candidate.projectName} · {candidate.branch ?? candidate.name}
									</option>
								))}
							</select>
							<button
								type="button"
								disabled={!recoveryWorktreeId || recoveryPending}
								onClick={onRecoveryLink}
								className="shrink-0 rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-secondary)] disabled:opacity-40"
							>
								Link worktree
							</button>
						</div>
						{links.length > 0 && (
							<div className="mt-3 border-t border-[var(--border-subtle)] pt-2">
								{links.map((link) => (
									<div key={link.id} className="flex min-w-0 items-center gap-2 py-1">
										<span className="min-w-0 flex-1 truncate text-[10px] text-[var(--text-quaternary)]">
											{link.projectName ?? "Missing"} · {link.branch ?? link.workspaceId}
										</span>
										<button
											type="button"
											onClick={() => onRecoveryUnlink(link)}
											disabled={recoveryPending}
											aria-label={`Recovery: unlink worktree ${link.branch ?? link.workspaceId}`}
											className="shrink-0 rounded-[5px] px-1.5 py-0.5 text-[9px] text-[var(--danger)] hover:bg-[var(--danger-subtle)] disabled:opacity-40"
										>
											Unlink
										</button>
									</div>
								))}
							</div>
						)}
					</div>
				</details>
			</div>
		</section>
	);
}
