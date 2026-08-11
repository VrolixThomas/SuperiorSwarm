import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { HermesTagColor, HermesTagDefinition } from "../../../shared/hermes";
import { HermesTagDot } from "./HermesTagChip";
import { HermesTagColorPicker } from "./HermesTagColorPicker";

interface HermesTagManagerProps {
	disabled: boolean;
	onListTagDefinitions: (query: string) => Promise<HermesTagDefinition[]>;
	onCreateTag: (name: string, color: HermesTagColor) => Promise<HermesTagDefinition>;
	onUpdateTag: (
		definitionId: string,
		update: { name?: string; color?: HermesTagColor; expectedRevision: number }
	) => Promise<HermesTagDefinition>;
	onDeleteTag: (definitionId: string, expectedRevision: number) => Promise<void>;
	onBack: () => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Tag definitions could not be updated";
}

export function HermesTagManager({
	disabled,
	onListTagDefinitions,
	onCreateTag,
	onUpdateTag,
	onDeleteTag,
	onBack,
}: HermesTagManagerProps) {
	const [definitions, setDefinitions] = useState<HermesTagDefinition[]>([]);
	const [loading, setLoading] = useState(true);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | "new" | null>(null);
	const [draftName, setDraftName] = useState("");
	const [draftColor, setDraftColor] = useState<HermesTagColor>("gray");
	const [confirmingId, setConfirmingId] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const newButtonRef = useRef<HTMLButtonElement>(null);
	const editButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
	const confirmCancelRef = useRef<HTMLButtonElement>(null);
	const focusAfterEditRef = useRef<HTMLButtonElement | null>(null);
	const focusAfterConfirmRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		let current = true;
		void onListTagDefinitions("").then(
			(result) => {
				if (!current) return;
				setDefinitions(result);
				setLoading(false);
			},
			(reason) => {
				if (!current) return;
				setError(errorMessage(reason));
				setLoading(false);
			}
		);
		return () => {
			current = false;
		};
	}, [onListTagDefinitions]);

	useEffect(() => {
		if (editingId) {
			inputRef.current?.focus();
			return;
		}
		if (pending || disabled) return;
		focusAfterEditRef.current?.focus();
		focusAfterEditRef.current = null;
	}, [disabled, editingId, pending]);

	useEffect(() => {
		if (confirmingId) {
			confirmCancelRef.current?.focus();
			return;
		}
		if (pending || disabled) return;
		focusAfterConfirmRef.current?.focus();
		focusAfterConfirmRef.current = null;
	}, [confirmingId, disabled, pending]);

	function beginEdit(definition: HermesTagDefinition) {
		setError(null);
		setConfirmingId(null);
		focusAfterEditRef.current = editButtonRefs.current.get(definition.id) ?? null;
		setEditingId(definition.id);
		setDraftName(definition.name);
		setDraftColor(definition.color);
	}

	function beginCreate() {
		setError(null);
		setConfirmingId(null);
		focusAfterEditRef.current = newButtonRef.current;
		setEditingId("new");
		setDraftName("");
		setDraftColor("gray");
	}

	async function save() {
		const name = draftName.trim();
		if (!name || !editingId || pending || disabled) return;
		setPending(true);
		setError(null);
		try {
			if (editingId === "new") {
				const created = await onCreateTag(name, draftColor);
				setDefinitions((current) =>
					[...current, created].sort((left, right) => left.name.localeCompare(right.name))
				);
			} else {
				const current = definitions.find((definition) => definition.id === editingId);
				if (!current) throw new Error("Tag definition was not found");
				const updated = await onUpdateTag(current.id, {
					name,
					color: draftColor,
					expectedRevision: current.revision,
				});
				setDefinitions((items) =>
					items
						.map((definition) => (definition.id === updated.id ? updated : definition))
						.sort((left, right) => left.name.localeCompare(right.name))
				);
			}
			setEditingId(null);
		} catch (reason) {
			setError(errorMessage(reason));
		} finally {
			setPending(false);
		}
	}

	async function remove(definition: HermesTagDefinition) {
		if (pending || disabled) return;
		setPending(true);
		setError(null);
		try {
			await onDeleteTag(definition.id, definition.revision);
			setDefinitions((items) => items.filter((candidate) => candidate.id !== definition.id));
			focusAfterConfirmRef.current = null;
			setConfirmingId(null);
		} catch (reason) {
			setError(errorMessage(reason));
		} finally {
			setPending(false);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "Escape") return;
		if (editingId || confirmingId) {
			event.preventDefault();
			event.stopPropagation();
			if (editingId) setEditingId(null);
			if (confirmingId) setConfirmingId(null);
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onBack();
	}

	return (
		<div onKeyDown={handleKeyDown} className="flex min-h-0 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2">
				<button
					type="button"
					aria-label="Back to tag picker"
					onClick={onBack}
					className="grid size-7 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
				>
					<span aria-hidden="true">‹</span>
				</button>
				<div className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--text)]">
					Manage tags
				</div>
				<button
					ref={newButtonRef}
					type="button"
					onClick={beginCreate}
					disabled={disabled || pending}
					className="h-7 rounded-[6px] px-2 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 disabled:opacity-50"
				>
					New tag
				</button>
			</div>
			{editingId && (
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="border-b border-[var(--border-subtle)] p-2"
				>
					<input
						ref={inputRef}
						value={draftName}
						onChange={(event) => setDraftName(event.target.value)}
						aria-label="Tag name"
						maxLength={100}
						placeholder="Tag name"
						className="h-8 w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 text-[12px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30"
					/>
					<div className="mt-2">
						<HermesTagColorPicker value={draftColor} onChange={setDraftColor} disabled={pending} />
					</div>
					<div className="mt-2 flex justify-end gap-1.5">
						<button
							type="button"
							onClick={() => setEditingId(null)}
							className="h-7 rounded-[6px] px-2.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={!draftName.trim() || pending || disabled}
							className="h-7 rounded-[6px] bg-[var(--accent)] px-2.5 text-[11px] font-medium text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 disabled:opacity-50"
						>
							{editingId === "new" ? "Create tag" : "Save tag"}
						</button>
					</div>
				</form>
			)}
			<div className="max-h-64 min-h-20 overflow-y-auto p-1.5">
				{loading && (
					<div className="px-2 py-4 text-center text-[11px] text-[var(--text-quaternary)]">
						Loading tags…
					</div>
				)}
				{!loading && definitions.length === 0 && (
					<div className="px-2 py-4 text-center text-[11px] text-[var(--text-quaternary)]">
						No reusable tags yet
					</div>
				)}
				{definitions.map((definition) => (
					<div key={definition.id} className="rounded-[6px]">
						<div className="flex h-9 items-center gap-2 px-2">
							<HermesTagDot color={definition.color} />
							<span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
								{definition.name}
							</span>
							<button
								ref={(node) => {
									if (node) editButtonRefs.current.set(definition.id, node);
									else editButtonRefs.current.delete(definition.id);
								}}
								type="button"
								aria-label={`Edit ${definition.name}`}
								onClick={() => beginEdit(definition)}
								className="h-7 rounded-[6px] px-2 text-[10px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
							>
								Edit
							</button>
							<button
								ref={(node) => {
									if (node) deleteButtonRefs.current.set(definition.id, node);
									else deleteButtonRefs.current.delete(definition.id);
								}}
								type="button"
								aria-label={`Delete ${definition.name}`}
								onClick={() => {
									setEditingId(null);
									focusAfterConfirmRef.current =
										deleteButtonRefs.current.get(definition.id) ?? null;
									setConfirmingId(definition.id);
								}}
								className="grid size-7 place-items-center rounded-[6px] text-[var(--text-quaternary)] hover:bg-[var(--danger-subtle)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/60"
							>
								<span aria-hidden="true">×</span>
							</button>
						</div>
						{confirmingId === definition.id && (
							<div className="mx-2 mb-2 rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] p-2">
								<div className="text-[11px] leading-4 text-[var(--text-secondary)]">
									Delete “{definition.name}” and remove it from every session?
								</div>
								<div className="mt-2 flex justify-end gap-1.5">
									<button
										ref={confirmCancelRef}
										type="button"
										onClick={() => setConfirmingId(null)}
										className="h-7 rounded-[6px] px-2 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
									>
										Cancel
									</button>
									<button
										type="button"
										disabled={pending}
										onClick={() => void remove(definition)}
										className="h-7 rounded-[6px] bg-[var(--danger)] px-2 text-[11px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]/60 disabled:opacity-50"
									>
										Delete tag
									</button>
								</div>
							</div>
						)}
					</div>
				))}
			</div>
			{error && (
				<div
					role="alert"
					className="border-t border-[var(--border-subtle)] px-3 py-2 text-[11px] text-[var(--danger)] [overflow-wrap:anywhere]"
				>
					{error}
				</div>
			)}
		</div>
	);
}
