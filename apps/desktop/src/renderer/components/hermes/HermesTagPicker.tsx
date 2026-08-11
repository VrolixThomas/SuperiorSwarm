import { useEffect, useMemo, useRef, useState } from "react";
import type { HermesTagColor, HermesTagDefinition } from "../../../shared/hermes";
import { HermesTagDot } from "./HermesTagChip";
import { HermesTagColorPicker } from "./HermesTagColorPicker";

interface HermesTagPickerProps {
	assigned: HermesTagDefinition[];
	disabled: boolean;
	onListTagDefinitions: (query: string) => Promise<HermesTagDefinition[]>;
	onCreateTag: (name: string, color: HermesTagColor) => Promise<HermesTagDefinition>;
	onAssignTag: (definitionId: string) => Promise<void>;
	onUnassignTag: (definitionId: string) => Promise<void>;
	onBack: () => void;
	onManage: () => void;
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : "Tags could not be updated";
}

export function HermesTagPicker({
	assigned,
	disabled,
	onListTagDefinitions,
	onCreateTag,
	onAssignTag,
	onUnassignTag,
	onBack,
	onManage,
}: HermesTagPickerProps) {
	const [definitions, setDefinitions] = useState<HermesTagDefinition[]>([]);
	const [selectedIds, setSelectedIds] = useState(() => new Set(assigned.map((tag) => tag.id)));
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const [createColor, setCreateColor] = useState<HermesTagColor>("gray");
	const searchRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		searchRef.current?.focus();
		let current = true;
		void onListTagDefinitions("").then(
			(result) => {
				if (!current) return;
				setDefinitions(result);
				setLoading(false);
			},
			(reason) => {
				if (!current) return;
				setError(message(reason));
				setLoading(false);
			}
		);
		return () => {
			current = false;
		};
	}, [onListTagDefinitions]);

	useEffect(() => {
		setSelectedIds(new Set(assigned.map((tag) => tag.id)));
	}, [assigned]);

	const filtered = useMemo(() => {
		const needle = query.trim().normalize("NFKC").toLocaleLowerCase();
		if (!needle) return definitions;
		return definitions.filter((definition) => definition.normalizedKey.includes(needle));
	}, [definitions, query]);
	const createName = query.trim();
	const hasExactMatch = definitions.some(
		(definition) => definition.normalizedKey === createName.normalize("NFKC").toLocaleLowerCase()
	);

	async function toggle(definition: HermesTagDefinition) {
		if (disabled || pendingId) return;
		const selected = selectedIds.has(definition.id);
		setPendingId(definition.id);
		setError(null);
		try {
			if (selected) await onUnassignTag(definition.id);
			else await onAssignTag(definition.id);
			setSelectedIds((current) => {
				const next = new Set(current);
				if (selected) next.delete(definition.id);
				else next.add(definition.id);
				return next;
			});
		} catch (reason) {
			setError(message(reason));
		} finally {
			setPendingId(null);
		}
	}

	async function createAndAssign() {
		if (!createName || disabled || pendingId) return;
		setPendingId("create");
		setError(null);
		try {
			const definition = await onCreateTag(createName, createColor);
			setDefinitions((current) =>
				current.some((candidate) => candidate.id === definition.id)
					? current
					: [...current, definition].sort((left, right) => left.name.localeCompare(right.name))
			);
			await onAssignTag(definition.id);
			setSelectedIds((current) => new Set(current).add(definition.id));
			setCreating(false);
			setCreateColor("gray");
			setQuery("");
			searchRef.current?.focus();
		} catch (reason) {
			setError(message(reason));
		} finally {
			setPendingId(null);
		}
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key !== "Escape" || !creating) return;
		event.preventDefault();
		event.stopPropagation();
		setCreating(false);
		searchRef.current?.focus();
	}

	return (
		<div onKeyDown={handleKeyDown} className="flex min-h-0 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2">
				<button
					type="button"
					aria-label="Back to session actions"
					onClick={onBack}
					className="grid size-7 place-items-center rounded-[6px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
				>
					<span aria-hidden="true">‹</span>
				</button>
				<div className="text-[13px] font-semibold text-[var(--text)]">Tags</div>
			</div>
			<div className="p-2">
				<input
					ref={searchRef}
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setCreating(false);
					}}
					aria-label="Search tags"
					placeholder="Search tags…"
					maxLength={100}
					className="h-8 w-full rounded-[6px] border border-[var(--border)] bg-[var(--bg-base)] px-2.5 text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)] focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]/30"
				/>
			</div>
			<div className="max-h-56 min-h-16 overflow-y-auto px-1.5 pb-1.5">
				{loading ? (
					<div className="px-2 py-4 text-center text-[11px] text-[var(--text-quaternary)]">
						Loading tags…
					</div>
				) : (
					filtered.map((definition) => {
						const selected = selectedIds.has(definition.id);
						return (
							<label
								key={definition.id}
								className={`relative flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] text-[var(--text-secondary)] has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[var(--accent)]/60 ${disabled || pendingId !== null ? "opacity-50" : "cursor-pointer hover:bg-[var(--bg-overlay)]"}`}
							>
								<input
									type="checkbox"
									checked={selected}
									aria-label={`${selected ? "Unassign" : "Assign"} ${definition.name}`}
									disabled={disabled || pendingId !== null}
									onChange={() => void toggle(definition)}
									className="sr-only"
								/>
								<HermesTagDot color={definition.color} />
								<span className="min-w-0 flex-1 truncate">{definition.name}</span>
								<span aria-hidden="true" className="w-4 text-center text-[var(--accent)]">
									{selected ? "✓" : ""}
								</span>
							</label>
						);
					})
				)}
				{!loading && createName && !hasExactMatch && !creating && (
					<button
						type="button"
						onClick={() => setCreating(true)}
						className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[12px] text-[var(--accent)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60"
					>
						Create “{createName}”
					</button>
				)}
			</div>
			{creating && (
				<div className="border-t border-[var(--border-subtle)] p-2">
					<div className="mb-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
						Choose a color
					</div>
					<HermesTagColorPicker
						value={createColor}
						onChange={setCreateColor}
						disabled={pendingId !== null}
					/>
					<div className="mt-2 flex justify-end gap-1.5">
						<button
							type="button"
							onClick={() => setCreating(false)}
							className="h-7 rounded-[6px] px-2.5 text-[11px] text-[var(--text-tertiary)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60"
						>
							Cancel
						</button>
						<button
							type="button"
							disabled={pendingId !== null}
							onClick={() => void createAndAssign()}
							className="h-7 rounded-[6px] bg-[var(--accent)] px-2.5 text-[11px] font-medium text-[var(--accent-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 disabled:opacity-50"
						>
							Create tag
						</button>
					</div>
				</div>
			)}
			{error && (
				<div
					role="alert"
					className="px-3 py-1.5 text-[11px] text-[var(--danger)] [overflow-wrap:anywhere]"
				>
					{error}
				</div>
			)}
			<button
				type="button"
				onClick={onManage}
				className="h-9 border-t border-[var(--border-subtle)] px-3 text-left text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]/60"
			>
				Manage tags…
			</button>
		</div>
	);
}
