import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "./RailIcons";
import { RailList, type RailListProps } from "./RailList";
import { SkeletonRow } from "./RailRows";

export function PathRail(props: RailListProps & { mapping?: boolean }) {
	const [expanded, setExpanded] = useState(false);
	const otherIndex = props.items.findIndex((item) => item.kind === "other-files");
	const mainItems = useMemo(
		() => (otherIndex < 0 ? props.items : props.items.slice(0, otherIndex)),
		[props.items, otherIndex]
	);
	const otherItems = useMemo(
		() => (otherIndex < 0 ? [] : props.items.slice(otherIndex + 1)),
		[props.items, otherIndex]
	);
	const other = otherIndex < 0 ? undefined : props.items[otherIndex];
	useEffect(() => {
		if (otherItems.some((item) => "path" in item && item.path === props.selectedPath))
			setExpanded(true);
	}, [props.selectedPath, otherItems]);
	return (
		<>
			<RailList {...props} items={mainItems}>
				{props.mapping && (
					<>
						<SkeletonRow />
						<SkeletonRow />
					</>
				)}
			</RailList>
			{other && "title" in other && (
				<div
					className={`flex min-h-0 flex-col border-t border-[var(--border-subtle)] ${expanded ? "max-h-[45%]" : "shrink-0"}`}
				>
					<button
						type="button"
						aria-expanded={expanded}
						onClick={() => setExpanded(!expanded)}
						className="flex h-9 shrink-0 items-center gap-2 px-4 text-[12px] text-[var(--text-secondary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
					>
						{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
						{other.title}
						<span className="text-[var(--text-tertiary)]">{other.count}</span>
					</button>
					{expanded && <RailList {...props} items={otherItems} />}
				</div>
			)}
		</>
	);
}
