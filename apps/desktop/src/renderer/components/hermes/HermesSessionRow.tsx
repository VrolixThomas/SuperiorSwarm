import { type FormEvent, useEffect, useRef, useState } from "react";
import type { HermesSessionSummary } from "../../../shared/hermes";
import { OverflowPopover } from "./OverflowPopover";

export interface HermesSessionRowProps {
	session: HermesSessionSummary;
	selected: boolean;
	linkedBranch: string | null;
	actionPending: boolean;
	onSelect: () => void;
	onSetArchived: (profileId: string, durableSessionId: string, archived: boolean) => void;
	onDelete: (profileId: string, durableSessionId: string) => void;
	onRename: (title: string, expectedRevision: number) => Promise<void>;
	onAddTag: (tag: string) => Promise<void>;
	onRemoveTag: (tag: string) => Promise<void>;
	deleteDisabledReason: string | null;
	confirmDelete?: (message: string) => boolean;
}

function relativeTime(timestamp: number): string {
	if (!timestamp) return "Unknown";
	const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
	const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000));
	if (minutes < 1) return "Now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.round(hours / 24)}d`;
}

function sourceBadge(source: string): string {
	switch (source.toLowerCase()) {
		case "slack":
			return "◫";
		case "telegram":
			return "✈";
		case "desktop":
			return "▣";
		case "tui":
			return ">_";
		case "superiorswarm":
			return "A";
		default:
			return "◇";
	}
}

export function confirmHermesSessionDeletion(
	title: string,
	confirm: (message: string) => boolean = (message) => window.confirm(message)
): boolean {
	return confirm(
		`Permanently delete “${title}”? This deletes the Hermes session and transcript. This cannot be undone.`
	);
}

export function HermesSessionRow({
	session,
	selected,
	linkedBranch,
	actionPending,
	onSelect,
	onSetArchived,
	onDelete,
	onRename,
	onAddTag,
	onRemoveTag,
	deleteDisabledReason,
	confirmDelete,
}: HermesSessionRowProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [nameEditing, setNameEditing] = useState(false);
	const [draftName, setDraftName] = useState(session.title);
	const [tagInput, setTagInput] = useState("");
	const [metadataPending, setMetadataPending] = useState(false);
	const [metadataError, setMetadataError] = useState<string | null>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const controlsDisabled = actionPending || metadataPending;
	useEffect(() => {
		if (nameEditing) nameInputRef.current?.focus();
	}, [nameEditing]);

	async function runMetadataAction(action: () => Promise<void>, onSuccess?: () => void) {
		if (metadataPending) return;
		setMetadataPending(true);
		setMetadataError(null);
		try {
			await action();
			onSuccess?.();
		} catch (error) {
			setMetadataError(
				error instanceof Error ? error.message : "Session metadata could not be saved"
			);
		} finally {
			setMetadataPending(false);
		}
	}

	function submitName(event: FormEvent) {
		event.preventDefault();
		const title = draftName.trim();
		if (!title || controlsDisabled) return;
		void runMetadataAction(
			() => onRename(title, session.metadataRevision),
			() => setNameEditing(false)
		);
	}

	function submitTag(event: FormEvent) {
		event.preventDefault();
		const tag = tagInput.trim();
		if (!tag || controlsDisabled) return;
		void runMetadataAction(
			() => onAddTag(tag),
			() => setTagInput("")
		);
	}

	return (
		<div
			className={`group relative mb-0.5 min-h-[56px] min-w-0 rounded-[8px] border-l-2 transition-colors motion-reduce:transition-none ${
				selected
					? "border-l-[var(--accent)] bg-[var(--bg-elevated)]"
					: session.waitingForUser
						? "border-l-[var(--warning)] hover:bg-[var(--bg-overlay)]"
						: "border-l-transparent hover:bg-[var(--bg-overlay)]"
			}`}
		>
			<button
				type="button"
				aria-label={`Open ${session.title}`}
				onClick={onSelect}
				className="min-h-[56px] w-full min-w-0 rounded-[8px] px-2.5 py-2 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/50"
			>
				<div className="flex items-center gap-1.5">
					<span className="text-[10px]" aria-hidden="true">
						{sourceBadge(session.source)}
					</span>
					<span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text-secondary)]">
						{session.title}
					</span>
					<span className="text-[9px] text-[var(--text-quaternary)]">
						{relativeTime(session.updatedAt)}
					</span>
				</div>
				<div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-quaternary)]">
					{session.waitingForUser ? (
						<span className="shrink-0 text-[var(--warning)]">Needs input</span>
					) : session.running || session.busy ? (
						<span className="shrink-0 text-[var(--success)]">Active</span>
					) : null}
					<span className="truncate">
						{session.preview || session.origin?.displayLabel || session.source}
						{linkedBranch ? ` · ${linkedBranch}` : ""}
					</span>
				</div>
				{session.tags.length > 0 && (
					<div
						aria-label={`Tags: ${session.tags.join(", ")}`}
						className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden"
					>
						{session.tags.slice(0, 2).map((tag) => (
							<span
								key={tag}
								className="max-w-24 truncate rounded-full bg-[var(--bg-overlay)] px-1.5 py-0.5 text-[9px] text-[var(--text-tertiary)]"
							>
								{tag}
							</span>
						))}
						{session.tags.length > 2 && (
							<span className="text-[9px] text-[var(--text-quaternary)]">
								+{session.tags.length - 2}
							</span>
						)}
					</div>
				)}
			</button>
			<div
				data-session-actions-trigger
				className={`absolute right-1 top-1 z-10 transition-opacity motion-reduce:transition-none ${
					selected || menuOpen
						? "opacity-100"
						: "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
				}`}
			>
				<OverflowPopover
					label={`Actions for ${session.title}`}
					open={menuOpen}
					onOpenChange={setMenuOpen}
					panelClassName="flex flex-col gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--bg-elevated)] p-1.5 shadow-[var(--shadow-lg)]"
				>
					<button
						type="button"
						disabled={controlsDisabled}
						onClick={() => {
							setDraftName(session.title);
							setMetadataError(null);
							setNameEditing(true);
						}}
						className="rounded-[6px] px-2.5 py-2 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:opacity-40"
					>
						Rename…
					</button>
					{nameEditing && (
						<form onSubmit={submitName} className="flex min-w-0 gap-1 px-1 py-1">
							<input
								ref={nameInputRef}
								value={draftName}
								onChange={(event) => setDraftName(event.target.value)}
								aria-label="Session name"
								maxLength={200}
								disabled={controlsDisabled}
								className="min-w-0 flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-40"
							/>
							<button
								type="submit"
								disabled={controlsDisabled || !draftName.trim()}
								className="shrink-0 rounded-[6px] bg-[var(--accent)] px-2 py-1 text-[10px] text-white disabled:opacity-40"
							>
								Save name
							</button>
						</form>
					)}
					<div className="px-2.5 pt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-[var(--text-quaternary)]">
						Tags
					</div>
					{session.tags.length === 0 ? (
						<div className="px-2.5 py-1 text-[10px] text-[var(--text-quaternary)]">No tags</div>
					) : (
						<div className="flex flex-wrap gap-1 px-1 py-1">
							{session.tags.map((tag) => (
								<span
									key={tag}
									className="inline-flex min-w-0 items-center gap-1 rounded-full bg-[var(--bg-overlay)] pl-2 text-[10px] text-[var(--text-secondary)]"
								>
									<span className="max-w-44 truncate">{tag}</span>
									<button
										type="button"
										aria-label={`Remove tag ${tag}`}
										disabled={controlsDisabled}
										onClick={() => void runMetadataAction(() => onRemoveTag(tag))}
										className="rounded-full px-1.5 py-0.5 text-[var(--text-quaternary)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50 disabled:opacity-40"
									>
										<span aria-hidden="true">×</span>
									</button>
								</span>
							))}
						</div>
					)}
					<form onSubmit={submitTag} className="flex min-w-0 gap-1 px-1 py-1">
						<input
							value={tagInput}
							onChange={(event) => setTagInput(event.target.value)}
							aria-label="Add session tag"
							maxLength={100}
							disabled={controlsDisabled || session.tags.length >= 64}
							className="min-w-0 flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-40"
						/>
						<button
							type="submit"
							disabled={controlsDisabled || session.tags.length >= 64 || !tagInput.trim()}
							className="shrink-0 rounded-[6px] border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--accent)] disabled:opacity-40"
						>
							Add tag
						</button>
					</form>
					{metadataError && (
						<div
							role="alert"
							className="max-w-72 px-2.5 py-1 text-[10px] text-[var(--danger)] [overflow-wrap:anywhere]"
						>
							{metadataError}
						</div>
					)}
					<button
						type="button"
						data-popover-close
						disabled={controlsDisabled}
						onClick={() => onSetArchived(session.profileId, session.id, !session.archived)}
						className="rounded-[6px] px-2.5 py-2 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/50 disabled:opacity-40"
					>
						{session.archived ? "Unarchive" : "Archive"}
					</button>
					<button
						type="button"
						data-popover-close
						disabled={controlsDisabled || deleteDisabledReason !== null}
						title={deleteDisabledReason ?? undefined}
						onClick={() => {
							if (!confirmHermesSessionDeletion(session.title, confirmDelete)) return;
							onDelete(session.profileId, session.id);
						}}
						className="rounded-[6px] px-2.5 py-2 text-left text-[11px] text-[var(--danger)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/50 disabled:opacity-40"
					>
						Delete permanently…
					</button>
					{deleteDisabledReason && (
						<div className="max-w-56 px-2.5 py-1 text-[9px] leading-4 text-[var(--text-quaternary)]">
							{deleteDisabledReason}
						</div>
					)}
				</OverflowPopover>
			</div>
		</div>
	);
}
