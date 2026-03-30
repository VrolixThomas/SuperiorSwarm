import { useMemo, useState } from "react";
import { TICKETS, TICKET_STATUSES } from "./mock-data";

type ViewMode = "board" | "list" | "table";

const VIEW_MODES: { mode: ViewMode; label: string }[] = [
	{ mode: "board", label: "Board" },
	{ mode: "list", label: "List" },
	{ mode: "table", label: "Table" },
];

/* ── State icon SVGs matching the real app's StateIcon component ───────── */

function StateIcon({ type, color, size = 8 }: { type: string; color: string; size?: number }) {
	const svgProps = {
		width: size,
		height: size,
		viewBox: "0 0 14 14",
		fill: "none",
		className: "shrink-0",
	};

	switch (type) {
		case "backlog":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
				</svg>
			);
		case "unstarted":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<circle cx="7" cy="7" r="2" fill={color} />
				</svg>
			);
		case "started":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="5.5" stroke={color} strokeWidth="1.5" fill="none" />
					<path d="M7 1.5 A5.5 5.5 0 0 1 7 12.5" fill={color} />
				</svg>
			);
		case "completed":
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="6" fill={color} />
					<path
						d="M4.5 7.2 L6.2 8.9 L9.5 5.5"
						stroke="#fff"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						fill="none"
					/>
				</svg>
			);
		default:
			return (
				<svg aria-hidden="true" {...svgProps}>
					<circle cx="7" cy="7" r="4" fill={color} />
				</svg>
			);
	}
}

/* ── Map mock statuses to state types + SVG colors ─────────────────────── */

const STATUS_CONFIG: Record<string, { type: string; svgColor: string; rank: number }> = {
	Backlog: { type: "backlog", svgColor: "#636366", rank: 2 },
	Todo: { type: "unstarted", svgColor: "#a1a1a6", rank: 1 },
	"In Progress": { type: "started", svgColor: "#febc2e", rank: 0 },
	Done: { type: "completed", svgColor: "#28c840", rank: 3 },
};

function getStatusConfig(status: string) {
	return STATUS_CONFIG[status] ?? { type: "default", svgColor: "#636366", rank: 99 };
}

/* ── Column structure for board & list views ───────────────────────────── */

const COLUMNS = TICKET_STATUSES.map((s) => {
	const cfg = getStatusConfig(s.name);
	const items = TICKETS.filter((t) => t.status === s.name);
	return { label: s.name, type: cfg.type, svgColor: cfg.svgColor, items };
});

/* ── Board View ────────────────────────────────────────────────────────── */

function BoardView() {
	return (
		<div className="flex h-full gap-2.5 overflow-x-auto px-3 py-2">
			{COLUMNS.map((col) => (
				<div key={col.label} className="flex min-w-[200px] flex-1 flex-col gap-1.5">
					<div className="flex items-center gap-1.5 px-1 py-1 text-[9px] font-semibold uppercase tracking-[0.3px] text-text-muted">
						<StateIcon type={col.type} color={col.svgColor} size={8} />
						<span>{col.label}</span>
						<span className="ml-auto font-normal tabular-nums opacity-50">{col.items.length}</span>
					</div>
					<div className="flex flex-1 flex-col gap-1.5">
						{col.items.map((ticket) => {
							const { type, svgColor } = getStatusConfig(ticket.status);
							return (
								<div
									key={ticket.key}
									className="flex w-full flex-col gap-1 rounded-[6px] border border-border bg-bg-elevated px-2.5 py-2 text-left"
								>
									<div className="flex items-center gap-1.5">
										<StateIcon type={type} color={svgColor} size={10} />
										<span className="text-[10px] font-medium text-text-faint">{ticket.key}</span>
										<span className="ml-auto text-[8px] text-text-faint opacity-60">
											{ticket.provider}
										</span>
									</div>
									<span className="line-clamp-2 text-[11px] leading-[1.35] text-text-primary">
										{ticket.title}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

/* ── List View ─────────────────────────────────────────────────────────── */

function ListView() {
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const toggle = (label: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(label)) next.delete(label);
			else next.add(label);
			return next;
		});
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto px-3 py-2">
			{COLUMNS.map((col) => (
				<div key={col.label}>
					<button
						type="button"
						onClick={() => toggle(col.label)}
						className="flex w-full items-center gap-1.5 px-1 py-1.5 text-[9px] font-semibold uppercase tracking-[0.3px] text-text-muted"
					>
						<svg
							width="8"
							height="8"
							viewBox="0 0 10 10"
							fill="none"
							className={`shrink-0 transition-transform duration-150 ${
								!collapsed.has(col.label) ? "rotate-90" : ""
							}`}
							aria-hidden="true"
						>
							<path
								d="M3 1.5L7 5L3 8.5"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						<StateIcon type={col.type} color={col.svgColor} size={8} />
						<span>{col.label}</span>
						<span className="font-normal tabular-nums opacity-50">{col.items.length}</span>
					</button>
					{!collapsed.has(col.label) && (
						<div>
							{col.items.map((ticket) => {
								const { type, svgColor } = getStatusConfig(ticket.status);
								return (
									<div
										key={ticket.key}
										className="ml-4 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left hover:bg-[rgba(255,255,255,0.03)]"
									>
										<StateIcon type={type} color={svgColor} size={8} />
										<span className="w-[58px] shrink-0 text-[11px] font-medium text-text-faint">
											{ticket.key}
										</span>
										<span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
											{ticket.title}
										</span>
										<span className="shrink-0 text-[9px] text-text-faint">{ticket.provider}</span>
									</div>
								);
							})}
						</div>
					)}
				</div>
			))}
		</div>
	);
}

/* ── Table View ────────────────────────────────────────────────────────── */

type SortField = "identifier" | "title" | "status" | "project" | "provider";
type SortDir = "asc" | "desc";

function TableView() {
	const [sortField, setSortField] = useState<SortField>("status");
	const [sortDir, setSortDir] = useState<SortDir>("asc");

	const toggleSort = (field: SortField) => {
		if (sortField === field) {
			setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDir("asc");
		}
	};

	const sorted = useMemo(
		() =>
			[...TICKETS].sort((a, b) => {
				const dir = sortDir === "asc" ? 1 : -1;
				switch (sortField) {
					case "identifier":
						return dir * a.key.localeCompare(b.key);
					case "title":
						return dir * a.title.localeCompare(b.title);
					case "status":
						return dir * (getStatusConfig(a.status).rank - getStatusConfig(b.status).rank);
					case "project":
						return dir * a.project.localeCompare(b.project);
					case "provider":
						return dir * a.provider.localeCompare(b.provider);
					default:
						return 0;
				}
			}),
		[sortField, sortDir]
	);

	const headerClass =
		"text-[10px] font-semibold uppercase tracking-[0.3px] text-text-faint cursor-pointer select-none";
	const arrow = (field: SortField) =>
		sortField === field ? (sortDir === "asc" ? " \u2191" : " \u2193") : "";

	const statusPillColor: Record<string, string> = {
		"In Progress": "bg-yellow/15 text-yellow",
		Todo: "bg-text-secondary/15 text-text-secondary",
		Backlog: "bg-text-faint/20 text-text-muted",
		Done: "bg-green/15 text-green",
	};

	return (
		<div className="flex h-full flex-col overflow-y-auto">
			<div className="sticky top-0 z-10 flex items-center gap-2.5 border-b border-border bg-bg-surface px-4 py-2">
				<span className="w-[14px]" />
				<button
					type="button"
					className={`w-[62px] text-left ${headerClass}`}
					onClick={() => toggleSort("identifier")}
				>
					ID{arrow("identifier")}
				</button>
				<button
					type="button"
					className={`min-w-0 flex-1 text-left ${headerClass}`}
					onClick={() => toggleSort("title")}
				>
					Title{arrow("title")}
				</button>
				<button
					type="button"
					className={`w-[80px] text-left ${headerClass}`}
					onClick={() => toggleSort("status")}
				>
					Status{arrow("status")}
				</button>
				<button
					type="button"
					className={`w-[50px] text-left ${headerClass}`}
					onClick={() => toggleSort("project")}
				>
					Project{arrow("project")}
				</button>
				<button
					type="button"
					className={`w-[44px] text-left ${headerClass}`}
					onClick={() => toggleSort("provider")}
				>
					Source{arrow("provider")}
				</button>
			</div>
			{sorted.map((ticket) => {
				const { type, svgColor } = getStatusConfig(ticket.status);
				return (
					<div
						key={ticket.key}
						className="flex items-center gap-2.5 border-b border-[rgba(255,255,255,0.02)] px-4 py-1.5 text-left hover:bg-[rgba(255,255,255,0.02)]"
					>
						<StateIcon type={type} color={svgColor} size={8} />
						<span className="w-[62px] shrink-0 text-[11px] font-medium text-text-faint">
							{ticket.key}
						</span>
						<span className="min-w-0 flex-1 truncate text-[11px] text-text-secondary">
							{ticket.title}
						</span>
						<span
							className={`w-[80px] shrink-0 rounded-full px-2 py-0.5 text-center text-[9px] font-medium ${
								statusPillColor[ticket.status] ?? "bg-text-faint/20 text-text-muted"
							}`}
						>
							{ticket.status}
						</span>
						<span className="w-[50px] shrink-0 text-[10px] text-text-muted">{ticket.project}</span>
						<span className="w-[44px] shrink-0 text-[10px] text-text-faint">{ticket.provider}</span>
					</div>
				);
			})}
		</div>
	);
}

/* ── Main exported component ───────────────────────────────────────────── */

export function TicketBoardView() {
	const [viewMode, setViewMode] = useState<ViewMode>("board");

	return (
		<div className="flex flex-1 flex-col overflow-hidden">
			{/* Toolbar — matches TicketsToolbar from the real app */}
			<div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
				<span className="text-[13px] font-semibold text-text-primary">All Tickets</span>
				<span className="text-[10px] text-text-faint">
					All providers &middot; {TICKETS.length} tickets
				</span>
				<div className="flex-1" />
				<div className="flex gap-0.5 rounded-[6px] bg-bg-elevated p-[2px]">
					{VIEW_MODES.map(({ mode, label }) => (
						<button
							key={mode}
							type="button"
							onClick={() => setViewMode(mode)}
							className={`rounded-[4px] px-2.5 py-1 text-[10px] transition-colors ${
								viewMode === mode
									? "bg-bg-overlay font-medium text-text-primary"
									: "text-text-faint hover:text-text-muted"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* View content */}
			{viewMode === "board" && <BoardView />}
			{viewMode === "list" && <ListView />}
			{viewMode === "table" && <TableView />}
		</div>
	);
}
