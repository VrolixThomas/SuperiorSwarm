import { assigneeColorFromId } from "../../../shared/tickets";
import { initials } from "../../lib/format";

interface AssigneeAvatarProps {
	assigneeId: string | null | undefined;
	assigneeName: string | null | undefined;
	size?: number;
	onClick?: (e: React.MouseEvent) => void;
}

export function AssigneeAvatar({
	assigneeId,
	assigneeName,
	size = 16,
	onClick,
}: AssigneeAvatarProps) {
	const isUnassigned = !assigneeId;
	const displayInitials = !assigneeName ? "—" : initials(assigneeName);
	const bgColor = assigneeColorFromId(assigneeId);
	const fontSize = Math.max(7, Math.round(size * 0.45));

	if (isUnassigned) {
		return (
			<button
				type="button"
				onClick={onClick}
				title="Unassigned"
				className="flex shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[var(--bg-overlay)]"
				style={{
					width: size,
					height: size,
					border: "1px dashed rgba(255,255,255,0.2)",
					fontSize,
					color: "var(--text-quaternary)",
				}}
			>
				—
			</button>
		);
	}

	return (
		<button
			type="button"
			onClick={onClick}
			title={assigneeName ?? "Assigned"}
			className="flex shrink-0 items-center justify-center rounded-full font-semibold text-[var(--accent-foreground)] transition-opacity hover:opacity-80"
			style={{
				width: size,
				height: size,
				backgroundColor: `${bgColor}33`,
				color: bgColor,
				fontSize,
			}}
		>
			{displayInitials}
		</button>
	);
}
