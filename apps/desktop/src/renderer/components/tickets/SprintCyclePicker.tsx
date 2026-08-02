import { useCallback, useMemo, useRef, useState } from "react";
import type { TicketIteration, TicketScope } from "../../../shared/tickets";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";

interface SprintCyclePickerProps {
	scope: TicketScope;
	iterations: TicketIteration[];
	onSelect: (scope: TicketScope) => void;
}

const STATE_META = {
	active: { label: "Active", color: "#30d158" },
	future: { label: "Upcoming", color: "#0a84ff" },
	closed: { label: "Completed", color: "#6e6e73" },
} as const;

function iterationKey(iteration: TicketIteration): string {
	return `${iteration.provider}:${iteration.id}`;
}

function IterationRow({
	iteration,
	selected,
	onSelect,
}: {
	iteration: TicketIteration;
	selected: boolean;
	onSelect: (iteration: TicketIteration) => void;
}) {
	return (
		<button
			type="button"
			aria-current={selected ? "true" : undefined}
			onClick={() => onSelect(iteration)}
			className={`flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left transition-colors ${
				selected
					? "bg-[rgba(10,132,255,0.12)] text-[var(--text)]"
					: "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
			}`}
		>
			<span
				className="h-1.5 w-1.5 shrink-0 rounded-full"
				style={{ backgroundColor: STATE_META[iteration.state].color }}
			/>
			<span className="min-w-0 flex-1 truncate text-[11px]">{iteration.name}</span>
			{selected && (
				<svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<path
						d="m2.5 6 2.1 2.1L9.5 3.5"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
		</button>
	);
}

export function SprintCyclePicker({ scope, iterations, onSelect }: SprintCyclePickerProps) {
	const [open, setOpen] = useState(false);
	const [showCompleted, setShowCompleted] = useState(false);
	const [completedSearch, setCompletedSearch] = useState("");
	const ref = useRef<HTMLDivElement>(null);

	const selectedKey = scope.kind === "iteration" ? `${scope.provider}:${scope.iterationId}` : null;
	const selectedIteration = iterations.find((iteration) => iterationKey(iteration) === selectedKey);
	const active = useMemo(
		() => iterations.filter((iteration) => iteration.state === "active"),
		[iterations]
	);
	const future = useMemo(
		() => iterations.filter((iteration) => iteration.state === "future"),
		[iterations]
	);
	const completed = useMemo(
		() => iterations.filter((iteration) => iteration.state === "closed"),
		[iterations]
	);
	const filteredCompleted = useMemo(() => {
		const query = completedSearch.trim().toLocaleLowerCase();
		if (!query) return completed;
		return completed.filter((iteration) =>
			`${iteration.name} ${iteration.groupId}`.toLocaleLowerCase().includes(query)
		);
	}, [completed, completedSearch]);

	const close = useCallback(() => {
		setOpen(false);
		setShowCompleted(false);
		setCompletedSearch("");
	}, []);
	useClickOutside(ref, close, open);
	useEscapeKey(close, open);

	const selectIteration = useCallback(
		(iteration: TicketIteration) => {
			onSelect({
				kind: "iteration",
				provider: iteration.provider,
				iterationId: iteration.id,
			});
			close();
		},
		[close, onSelect]
	);

	const sections = [
		{ state: "active" as const, iterations: active },
		{ state: "future" as const, iterations: future },
	];

	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				disabled={iterations.length === 0}
				aria-expanded={open}
				onClick={() => {
					if (!open && selectedIteration?.state === "closed") setShowCompleted(true);
					setOpen((value) => !value);
				}}
				title="Choose a sprint or cycle"
				className={`flex h-[24px] max-w-[190px] items-center gap-1.5 rounded-[5px] border px-2 text-[10px] transition-colors disabled:opacity-40 ${
					scope.kind === "iteration"
						? "border-[rgba(10,132,255,0.28)] bg-[rgba(10,132,255,0.08)] text-[var(--text)]"
						: "border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-tertiary)] hover:border-[var(--border)]"
				}`}
			>
				{selectedIteration && (
					<span
						className="h-1.5 w-1.5 shrink-0 rounded-full"
						style={{ backgroundColor: STATE_META[selectedIteration.state].color }}
					/>
				)}
				<span className="min-w-0 flex-1 truncate">
					{selectedIteration?.name ?? (iterations.length === 0 ? "No sprints" : "Sprint / cycle…")}
				</span>
				<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
					<path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
				</svg>
			</button>

			{open && (
				<div className="absolute left-0 top-full z-50 mt-1 w-[290px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-xl">
					<div className="border-b border-[var(--border-subtle)] px-3 py-2">
						<div className="text-[11px] font-medium text-[var(--text)]">Sprint or cycle</div>
						<div className="mt-0.5 text-[9px] text-[var(--text-quaternary)]">
							Active and upcoming work
						</div>
					</div>

					<div className="max-h-[360px] overflow-y-auto p-1.5">
						{sections.map(({ state, iterations: sectionIterations }) =>
							sectionIterations.length > 0 ? (
								<div key={state} className="pb-1">
									<div className="flex items-center justify-between px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
										<span>{STATE_META[state].label}</span>
										<span className="tabular-nums">{sectionIterations.length}</span>
									</div>
									{sectionIterations.map((iteration) => (
										<IterationRow
											key={iterationKey(iteration)}
											iteration={iteration}
											selected={iterationKey(iteration) === selectedKey}
											onSelect={selectIteration}
										/>
									))}
								</div>
							) : null
						)}

						{active.length === 0 && future.length === 0 && (
							<div className="px-2 py-3 text-center text-[10px] text-[var(--text-quaternary)]">
								No active or upcoming sprints
							</div>
						)}

						{completed.length > 0 && (
							<div className="mt-1 border-t border-[var(--border-subtle)] pt-1">
								<button
									type="button"
									onClick={() => {
										setShowCompleted((value) => !value);
										setCompletedSearch("");
									}}
									className="flex w-full items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-[10px] text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
								>
									<svg
										width="9"
										height="9"
										viewBox="0 0 10 10"
										fill="none"
										aria-hidden="true"
										className={`transition-transform ${showCompleted ? "rotate-90" : ""}`}
									>
										<path d="m3.5 2 3 3-3 3" stroke="currentColor" strokeWidth="1.1" />
									</svg>
									<span className="flex-1">Browse completed</span>
									<span className="tabular-nums">{completed.length}</span>
								</button>

								{showCompleted && (
									<div className="pt-1">
										<input
											value={completedSearch}
											onChange={(event) => setCompletedSearch(event.target.value)}
											placeholder="Find a completed sprint…"
											className="mb-1 w-full rounded-[5px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[10px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)] focus:border-[var(--border)]"
										/>
										{filteredCompleted.map((iteration) => (
											<IterationRow
												key={iterationKey(iteration)}
												iteration={iteration}
												selected={iterationKey(iteration) === selectedKey}
												onSelect={selectIteration}
											/>
										))}
										{filteredCompleted.length === 0 && (
											<div className="px-2 py-3 text-center text-[10px] text-[var(--text-quaternary)]">
												No completed sprint matches
											</div>
										)}
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
