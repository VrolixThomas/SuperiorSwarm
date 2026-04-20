import { useEffect, useRef, useState } from "react";
import type { TicketTeamMember } from "../../../shared/tickets";
import { Popover } from "../ui/Popover";
import { AssigneeAvatar } from "./AssigneeAvatar";

interface AssigneePickerProps {
	members: TicketTeamMember[];
	currentAssigneeId: string | null;
	position: { x: number; y: number };
	onSelect: (userId: string | null) => void;
	onClose: () => void;
}

export function AssigneePicker({
	members,
	currentAssigneeId,
	position,
	onSelect,
	onClose,
}: AssigneePickerProps) {
	const [search, setSearch] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	useEffect(() => {
		inputRef.current?.focus();
	}, []);
	const filtered = search
		? members.filter((m) => m.name.toLowerCase().includes(search.toLowerCase()))
		: members;

	return (
		<Popover
			position={position}
			onClose={onClose}
			className="flex max-h-[280px] w-[200px] flex-col overflow-hidden"
		>
			<div className="border-b border-[var(--border-subtle)] px-2 py-1.5">
				<input
					ref={inputRef}
					type="text"
					placeholder="Search..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="w-full bg-transparent text-[11px] text-[var(--text)] outline-none placeholder:text-[var(--text-quaternary)]"
				/>
			</div>
			<div className="overflow-y-auto py-1">
				<button
					type="button"
					onClick={() => onSelect(null)}
					className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] ${currentAssigneeId === null ? "bg-[rgba(10,132,255,0.08)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
				>
					<span
						className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[8px] text-[var(--text-quaternary)]"
						style={{ border: "1px dashed rgba(255,255,255,0.2)" }}
					>
						—
					</span>
					Unassigned
				</button>
				{filtered.map((member) => (
					<button
						key={member.id}
						type="button"
						onClick={() => onSelect(member.id)}
						className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] ${currentAssigneeId === member.id ? "bg-[rgba(10,132,255,0.08)] text-[var(--text)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"}`}
					>
						<AssigneeAvatar assigneeId={member.id} assigneeName={member.name} size={18} />
						<span className="truncate">{member.name}</span>
					</button>
				))}
			</div>
		</Popover>
	);
}
