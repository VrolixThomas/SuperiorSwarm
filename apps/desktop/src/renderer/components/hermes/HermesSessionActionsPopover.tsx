import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import type {
	HermesSessionSummary,
	HermesTagColor,
	HermesTagDefinition,
} from "../../../shared/hermes";
import { HermesTagManager } from "./HermesTagManager";
import { HermesTagPicker } from "./HermesTagPicker";
import { OverflowPopover } from "./OverflowPopover";

export interface HermesSessionTagActions {
	onListTagDefinitions: (query: string) => Promise<HermesTagDefinition[]>;
	onCreateTag: (name: string, color: HermesTagColor) => Promise<HermesTagDefinition>;
	onUpdateTag: (
		definitionId: string,
		update: { name?: string; color?: HermesTagColor; expectedRevision: number }
	) => Promise<HermesTagDefinition>;
	onDeleteTag: (definitionId: string, expectedRevision: number) => Promise<void>;
	onAssignTag: (definitionId: string) => Promise<void>;
	onUnassignTag: (definitionId: string) => Promise<void>;
}

interface HermesSessionActionsPopoverProps extends HermesSessionTagActions {
	session: HermesSessionSummary;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	actionPending: boolean;
	onSetArchived: (profileId: string, durableSessionId: string, archived: boolean) => void;
	onDelete: (profileId: string, durableSessionId: string) => void;
	onRename: (title: string, expectedRevision: number) => Promise<void>;
	deleteDisabledReason: string | null;
	confirmDelete: (message: string) => boolean;
}

type View = "main" | "rename" | "tags" | "manage";

function actionError(error: unknown): string {
	return error instanceof Error ? error.message : "The session could not be updated";
}

function MenuChevron() {
	return (
		<span aria-hidden="true" className="ml-auto text-[14px] text-[var(--text-quaternary)]">
			›
		</span>
	);
}

export function HermesSessionActionsPopover({
	session,
	open,
	onOpenChange,
	actionPending,
	onSetArchived,
	onDelete,
	onRename,
	deleteDisabledReason,
	confirmDelete,
	onListTagDefinitions,
	onCreateTag,
	onUpdateTag,
	onDeleteTag,
	onAssignTag,
	onUnassignTag,
}: HermesSessionActionsPopoverProps) {
	const [view, setView] = useState<View>("main");
	const [draftName, setDraftName] = useState(session.title);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const mainActionRef = useRef<HTMLButtonElement>(null);
	const controlsDisabled = actionPending || pending;

	useEffect(() => {
		if (!open || controlsDisabled) return;
		if (view === "rename") nameInputRef.current?.focus();
		if (view === "main") mainActionRef.current?.focus();
	}, [controlsDisabled, open, view]);

	function changeOpen(nextOpen: boolean) {
		if (!nextOpen) {
			setView("main");
			setError(null);
		}
		onOpenChange(nextOpen);
	}

	async function submitRename(event: FormEvent) {
		event.preventDefault();
		const title = draftName.trim();
		if (!title || controlsDisabled) return;
		setPending(true);
		setError(null);
		try {
			await onRename(title, session.metadataRevision);
			setView("main");
		} catch (reason) {
			setError(actionError(reason));
		} finally {
			setPending(false);
		}
	}

	function handleSubviewKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "Escape" || view === "main" || view === "manage") return;
		event.preventDefault();
		event.stopPropagation();
		setError(null);
		setView("main");
	}

	return (
		<OverflowPopover
			label={`Actions for ${session.title}`}
			open={open}
			onOpenChange={changeOpen}
			panelWidth={304}
			panelClassName="overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] shadow-[var(--shadow-lg)]"
		>
			<div onKeyDown={handleSubviewKeyDown} className="min-w-0">
				{view === "main" && (
					<div className="p-1.5">
						<button
							ref={mainActionRef}
							type="button"
							disabled={controlsDisabled}
							onClick={() => {
								setDraftName(session.title);
								setError(null);
								setView("rename");
							}}
							className="flex h-9 w-full items-center rounded-[6px] px-2.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60 disabled:opacity-40"
						>
							Rename
							<MenuChevron />
						</button>
						<button
							type="button"
							disabled={controlsDisabled}
							onClick={() => {
								setError(null);
								setView("tags");
							}}
							className="flex h-9 w-full items-center rounded-[6px] px-2.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60 disabled:opacity-40"
						>
							Tags
							<span className="ml-auto mr-1 text-[11px] text-[var(--text-quaternary)]">
								{session.tags.length || ""}
							</span>
							<MenuChevron />
						</button>
						<div className="my-1 h-px bg-[var(--border-subtle)]" />
						<button
							type="button"
							data-popover-close
							disabled={controlsDisabled}
							onClick={() => onSetArchived(session.profileId, session.id, !session.archived)}
							className="flex h-9 w-full items-center rounded-[6px] px-2.5 text-left text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60 disabled:opacity-40"
						>
							{session.archived ? "Unarchive" : "Archive"}
						</button>
						<div className="my-1 h-px bg-[var(--border-subtle)]" />
						<div className="flex items-center">
							<button
								type="button"
								data-popover-close
								disabled={controlsDisabled || deleteDisabledReason !== null}
								title={deleteDisabledReason ?? undefined}
								onClick={() => {
									if (
										!confirmDelete(
											`Permanently delete “${session.title}”? This deletes the Hermes session and transcript. This cannot be undone.`
										)
									) {
										return;
									}
									onDelete(session.profileId, session.id);
								}}
								className="h-9 min-w-0 flex-1 rounded-[6px] px-2.5 text-left text-[13px] text-[var(--danger)] hover:bg-[var(--danger-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--danger)]/60 disabled:opacity-40"
							>
								Delete permanently…
							</button>
							{deleteDisabledReason && (
								<button
									type="button"
									aria-label="Why is permanent delete unavailable?"
									title={deleteDisabledReason}
									className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] text-[var(--text-quaternary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
								>
									<span aria-hidden="true">?</span>
								</button>
							)}
						</div>
					</div>
				)}
				{view === "rename" && (
					<div className="p-3">
						<div className="mb-2 flex items-center gap-2">
							<button
								type="button"
								aria-label="Back to session actions"
								onClick={() => setView("main")}
								className="grid size-7 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
							>
								<span aria-hidden="true">‹</span>
							</button>
							<div className="text-[13px] font-semibold text-[var(--text)]">Rename session</div>
						</div>
						<form onSubmit={(event) => void submitRename(event)}>
							<label htmlFor="hermes-session-name" className="sr-only">
								Session name
							</label>
							<input
								ref={nameInputRef}
								id="hermes-session-name"
								value={draftName}
								onChange={(event) => setDraftName(event.target.value)}
								aria-label="Session name"
								maxLength={200}
								disabled={controlsDisabled}
								className="h-8 w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30 disabled:opacity-40"
							/>
							{error && (
								<div
									role="alert"
									className="mt-2 text-[11px] text-[var(--danger)] [overflow-wrap:anywhere]"
								>
									{error}
								</div>
							)}
							<div className="mt-3 flex justify-end gap-1.5">
								<button
									type="button"
									onClick={() => setView("main")}
									className="h-8 rounded-[6px] px-3 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={controlsDisabled || !draftName.trim()}
									className="h-8 rounded-[6px] bg-[var(--accent)] px-3 text-[11px] font-medium text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 disabled:opacity-40"
								>
									Save
								</button>
							</div>
						</form>
					</div>
				)}
				{view === "tags" && (
					<HermesTagPicker
						assigned={session.tags}
						disabled={controlsDisabled}
						onListTagDefinitions={onListTagDefinitions}
						onCreateTag={onCreateTag}
						onAssignTag={onAssignTag}
						onUnassignTag={onUnassignTag}
						onBack={() => setView("main")}
						onManage={() => setView("manage")}
					/>
				)}
				{view === "manage" && (
					<HermesTagManager
						disabled={controlsDisabled}
						onListTagDefinitions={onListTagDefinitions}
						onCreateTag={onCreateTag}
						onUpdateTag={onUpdateTag}
						onDeleteTag={onDeleteTag}
						onBack={() => setView("tags")}
					/>
				)}
			</div>
		</OverflowPopover>
	);
}
