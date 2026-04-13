import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Action, ActionCategory } from "../stores/action-store";
import { CATEGORY_ORDER, useActionStore } from "../stores/action-store";
import { ShortcutBadge } from "./ShortcutBadge";

function categoryIndex(cat: ActionCategory): number {
	const idx = CATEGORY_ORDER.indexOf(cat);
	return idx === -1 ? CATEGORY_ORDER.length : idx;
}

export function CommandPalette() {
	const isPaletteOpen = useActionStore((s) => s.isPaletteOpen);
	const closePalette = useActionStore((s) => s.closePalette);
	const getAvailable = useActionStore((s) => s.getAvailable);

	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Reset on open
	useEffect(() => {
		if (isPaletteOpen) {
			setQuery("");
			setSelectedIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [isPaletteOpen]);

	// Get filtered actions
	const { filteredActions, groupedActions } = useMemo(() => {
		const available = getAvailable().filter((a) => a.id !== "general.commandPalette");
		const q = query.toLowerCase().trim();

		const filtered = q
			? available.filter((a) => {
					const haystack = [a.label, ...(a.keywords ?? [])].join(" ").toLowerCase();
					return haystack.includes(q);
				})
			: available;

		filtered.sort((a, b) => {
			const catDiff = categoryIndex(a.category) - categoryIndex(b.category);
			if (catDiff !== 0) return catDiff;
			return a.label.localeCompare(b.label);
		});

		const grouped = new Map<ActionCategory, Action[]>();
		for (const action of filtered) {
			const list = grouped.get(action.category) ?? [];
			list.push(action);
			grouped.set(action.category, list);
		}

		return { filteredActions: filtered, groupedActions: grouped };
	}, [query, getAvailable]);

	// Clamp selected index
	useEffect(() => {
		if (selectedIndex >= filteredActions.length) {
			setSelectedIndex(Math.max(0, filteredActions.length - 1));
		}
	}, [filteredActions.length, selectedIndex]);

	// Scroll selected item into view
	useEffect(() => {
		const selected = listRef.current?.querySelector("[data-selected='true']");
		selected?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, filteredActions.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			const action = filteredActions[selectedIndex];
			if (action) {
				closePalette();
				requestAnimationFrame(() => useActionStore.getState().execute(action.id));
			}
		} else if (e.key === "Escape") {
			e.preventDefault();
			closePalette();
		}
	}

	if (!isPaletteOpen) return null;

	const hasQuery = query.trim().length > 0;

	return createPortal(
		<div
			className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
			onClick={(e) => {
				if (e.target === e.currentTarget) closePalette();
			}}
			onKeyDown={() => {}}
			role="presentation"
		>
			{/* Backdrop */}
			<div className="fixed inset-0 bg-black/40" aria-hidden="true" />

			{/* Palette */}
			<div className="relative z-10 flex w-[500px] max-h-[60vh] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-[var(--shadow-lg)] backdrop-blur-md">
				{/* Search input */}
				<div className="flex items-center border-b border-[var(--border-subtle)] px-4 py-3">
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						className="mr-3 shrink-0 text-[var(--text-quaternary)]"
						aria-hidden="true"
					>
						<circle cx="7" cy="7" r="5" />
						<path d="M11 11l3.5 3.5" strokeLinecap="round" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Type a command..."
						className="flex-1 bg-transparent text-[14px] text-[var(--text)] placeholder-[var(--text-quaternary)] outline-none"
						autoComplete="off"
						spellCheck={false}
					/>
				</div>

				{/* Results */}
				<div ref={listRef} className="overflow-y-auto py-2" role="listbox">
					{filteredActions.length === 0 && (
						<div className="px-4 py-6 text-center text-[13px] text-[var(--text-quaternary)]">
							No matching commands
						</div>
					)}

					{hasQuery
						? filteredActions.map((action, i) => (
								<PaletteRow
									key={action.id}
									action={action}
									isSelected={i === selectedIndex}
									onSelect={() => {
										closePalette();
										requestAnimationFrame(() => useActionStore.getState().execute(action.id));
									}}
									onHover={() => setSelectedIndex(i)}
								/>
							))
						: Array.from(groupedActions.entries()).map(([category, actions]) => {
								const startIdx = filteredActions.indexOf(actions[0]!);
								return (
									<div key={category}>
										<div className="px-4 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-quaternary)]">
											{category}
										</div>
										{actions.map((action, i) => (
											<PaletteRow
												key={action.id}
												action={action}
												isSelected={startIdx + i === selectedIndex}
												onSelect={() => {
													closePalette();
													requestAnimationFrame(() => useActionStore.getState().execute(action.id));
												}}
												onHover={() => setSelectedIndex(startIdx + i)}
											/>
										))}
									</div>
								);
							})}
				</div>
			</div>
		</div>,
		document.body
	);
}

function PaletteRow({
	action,
	isSelected,
	onSelect,
	onHover,
}: {
	action: Action;
	isSelected: boolean;
	onSelect: () => void;
	onHover: () => void;
}) {
	return (
		<div
			role="option"
			aria-selected={isSelected}
			data-selected={isSelected}
			onClick={onSelect}
			onMouseEnter={onHover}
			className={`mx-2 flex cursor-pointer items-center justify-between rounded-[6px] px-3 py-2 text-[13px] transition-colors ${
				isSelected
					? "bg-[var(--bg-elevated)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
			}`}
		>
			<span className="truncate">{action.label}</span>
			{(action.shortcut ?? action.displayShortcut) && (
				<ShortcutBadge shortcut={(action.shortcut ?? action.displayShortcut)!} />
			)}
		</div>
	);
}
