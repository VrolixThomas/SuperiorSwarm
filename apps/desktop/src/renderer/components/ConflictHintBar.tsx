export type ConflictZone = "sidebar" | "nav" | "edit";

export interface HintItem {
	key: string;
	label: string;
	accent?: string;
}

export function getHintItems(
	zone: ConflictZone,
	allResolved: boolean,
	mergeType: "merge" | "rebase"
): HintItem[] {
	if (zone === "edit") {
		return [
			{ key: "⌘↵", label: "mark resolved", accent: "var(--color-success)" },
			{ key: "Esc", label: "exit edit" },
		];
	}
	if (zone === "sidebar") {
		const items: HintItem[] = [
			{ key: "j/k", label: "navigate" },
			{ key: "↵", label: "open" },
			{ key: "n", label: "next conflict" },
			{ key: "p", label: "prev conflict" },
		];
		if (allResolved) {
			const commitLabel = mergeType === "merge" ? "apply & commit" : "continue rebase";
			items.push({ key: "↵", label: commitLabel, accent: "var(--color-success)" });
		}
		return items;
	}
	// nav
	return [
		{ key: "t", label: "theirs", accent: "var(--accent)" },
		{ key: "b", label: "ours", accent: "var(--color-purple)" },
		{ key: "+", label: "both" },
		{ key: "↑↓", label: "hunk" },
		{ key: "e", label: "edit", accent: "rgba(255,215,0,0.8)" },
		{ key: "⌘Z", label: "undo" },
		{ key: "Esc", label: "back" },
	];
}

interface Props {
	zone: ConflictZone;
	allResolved: boolean;
	mergeType: "merge" | "rebase";
}

export function ConflictHintBar({ zone, allResolved, mergeType }: Props) {
	const items = getHintItems(zone, allResolved, mergeType);
	const isEdit = zone === "edit";

	return (
		<div
			className="flex h-[22px] shrink-0 items-center gap-1.5 border-t px-3"
			style={{
				borderColor: isEdit ? "rgba(255,215,0,0.2)" : "var(--border)",
				background: isEdit ? "rgba(255,215,0,0.04)" : "rgba(0,0,0,0.2)",
			}}
		>
			<span className="mr-1 text-[9px] uppercase tracking-wider text-[var(--text-quaternary)]">
				{zone}
			</span>
			{items.map((item, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: static list derived from pure function, never reorders
					key={i}
					className="flex items-center gap-1 rounded px-1 py-0.5 text-[9px]"
					style={{
						color: item.accent ?? "rgba(255,255,255,0.4)",
						background: "rgba(255,255,255,0.06)",
					}}
				>
					<code className="font-mono">{item.key}</code>
					<span>{item.label}</span>
				</span>
			))}
		</div>
	);
}
