import { useCallback, useMemo, useRef, useState } from "react";
import type { TicketNavigationTarget, TicketProvider } from "../../../shared/tickets";
import { ticketNavigationTargetsEqual } from "../../../shared/tickets";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useEscapeKey } from "../../hooks/useEscapeKey";

export interface TicketNavigationEntry {
	target: Extract<TicketNavigationTarget, { kind: "group" }>;
	name: string;
	meta: string;
	provider: TicketProvider;
	count: number;
}

interface TicketBoardNavigatorProps {
	entries: TicketNavigationEntry[];
	activeTarget: TicketNavigationTarget;
	defaultTarget: TicketNavigationTarget | null;
	onSelect: (target: TicketNavigationTarget) => void;
	onSetDefault: (target: TicketNavigationTarget) => void;
}

function StarIcon({ filled }: { filled: boolean }) {
	return (
		<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<path
				d="m8 2 1.75 3.55 3.92.57-2.84 2.77.67 3.91L8 10.95 4.5 12.8l.67-3.91-2.84-2.77 3.92-.57L8 2Z"
				fill={filled ? "currentColor" : "none"}
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function TicketBoardNavigator({
	entries,
	activeTarget,
	defaultTarget,
	onSelect,
	onSetDefault,
}: TicketBoardNavigatorProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const ref = useRef<HTMLDivElement>(null);
	const close = useCallback(() => {
		setOpen(false);
		setSearch("");
	}, []);
	useClickOutside(ref, close, open);
	useEscapeKey(close, open);

	const activeEntry = entries.find((entry) =>
		ticketNavigationTargetsEqual(entry.target, activeTarget)
	);
	const filteredEntries = useMemo(() => {
		const query = search.trim().toLocaleLowerCase();
		if (!query) return entries;
		return entries.filter((entry) =>
			`${entry.name} ${entry.meta}`.toLocaleLowerCase().includes(query)
		);
	}, [entries, search]);
	const jiraEntries = filteredEntries.filter((entry) => entry.provider === "jira");
	const linearEntries = filteredEntries.filter((entry) => entry.provider === "linear");
	const isDefault = ticketNavigationTargetsEqual(activeTarget, defaultTarget);

	return (
		<div ref={ref} className="relative px-2">
			<div className="mb-1 flex items-center justify-between px-0.5">
				<span className="text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
					Boards & teams
				</span>
				{defaultTarget && (
					<span className="max-w-[120px] truncate text-[9px] text-[var(--text-quaternary)]">
						Default set
					</span>
				)}
			</div>
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					aria-expanded={open}
					className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border)] hover:text-[var(--text)]"
				>
					<div
						className={`h-[7px] w-[7px] shrink-0 ${activeEntry?.provider === "linear" ? "rounded-full" : "rounded-[2px]"} bg-[var(--text-quaternary)]`}
					/>
					<span className="min-w-0 flex-1 truncate">
						{activeEntry?.name ??
							(activeTarget.kind === "all" ? "Choose a board or team" : "Unknown board")}
					</span>
					<svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
						<path d="m3 4.5 3 3 3-3" stroke="currentColor" strokeWidth="1.2" />
					</svg>
				</button>
				<button
					type="button"
					onClick={() => onSetDefault(activeTarget)}
					title={isDefault ? "Current default" : "Set current view as default"}
					className={`flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-[5px] transition-colors ${
						isDefault
							? "bg-[rgba(255,190,48,0.12)] text-[#e6a928]"
							: "text-[var(--text-quaternary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-tertiary)]"
					}`}
				>
					<StarIcon filled={isDefault} />
				</button>
			</div>

			{open && (
				<div className="absolute left-2 top-full z-50 mt-1 w-[280px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--bg-overlay)] shadow-xl">
					<div className="border-b border-[var(--border-subtle)] p-2">
						<input
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Find a board or team…"
							className="w-full rounded-[5px] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)] focus:border-[var(--border)]"
						/>
					</div>
					<div className="max-h-[360px] overflow-y-auto py-1">
						{(
							[
								["Jira boards", jiraEntries],
								["Linear teams", linearEntries],
							] as const
						).map(([label, sectionEntries]) =>
							sectionEntries.length > 0 ? (
								<div key={label} className="pb-1">
									<div className="px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.5px] text-[var(--text-quaternary)]">
										{label}
									</div>
									{sectionEntries.map((entry) => {
										const active = ticketNavigationTargetsEqual(entry.target, activeTarget);
										const defaultEntry = ticketNavigationTargetsEqual(entry.target, defaultTarget);
										return (
											<div
												key={`${entry.provider}:${entry.target.groupId}:${entry.target.contextId ?? "group"}`}
												className={`group flex items-center px-1 ${active ? "bg-[rgba(10,132,255,0.08)]" : ""}`}
											>
												<button
													type="button"
													onClick={() => {
														onSelect(entry.target);
														close();
													}}
													className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] px-1.5 py-1.5 text-left hover:bg-[var(--bg-elevated)]"
												>
													<div className="min-w-0 flex-1">
														<div className="truncate text-[11px] text-[var(--text-secondary)]">
															{entry.name}
														</div>
														<div className="truncate text-[9px] text-[var(--text-quaternary)]">
															{entry.meta}
														</div>
													</div>
													<span className="text-[10px] tabular-nums text-[var(--text-quaternary)]">
														{entry.count}
													</span>
												</button>
												<button
													type="button"
													onClick={() => onSetDefault(entry.target)}
													title={defaultEntry ? "Current default" : "Set as default"}
													className={`mr-1 flex h-6 w-6 items-center justify-center rounded-[4px] ${
														defaultEntry
															? "text-[#e6a928]"
															: "text-[var(--text-quaternary)] opacity-0 hover:bg-[var(--bg-elevated)] group-hover:opacity-100"
													}`}
												>
													<StarIcon filled={defaultEntry} />
												</button>
											</div>
										);
									})}
								</div>
							) : null
						)}
						{filteredEntries.length === 0 && (
							<div className="px-3 py-6 text-center text-[11px] text-[var(--text-quaternary)]">
								No matching boards or teams
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
