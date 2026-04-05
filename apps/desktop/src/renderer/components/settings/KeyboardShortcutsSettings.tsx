import { useMemo } from "react";
import { type ActionCategory, CATEGORY_ORDER, useActionStore } from "../../stores/action-store";
import { ShortcutBadge } from "../ShortcutBadge";
import { PageHeading, SectionLabel } from "./SectionHeading";

export function KeyboardShortcutsSettings() {
	const actions = useActionStore((s) => s.actions);

	const grouped = useMemo(() => {
		const withShortcuts = Array.from(actions.values()).filter((a) => a.shortcut);
		const groups = new Map<ActionCategory, typeof withShortcuts>();
		for (const action of withShortcuts) {
			const list = groups.get(action.category) ?? [];
			list.push(action);
			groups.set(action.category, list);
		}
		const sorted = new Map<ActionCategory, typeof withShortcuts>();
		for (const cat of CATEGORY_ORDER) {
			const list = groups.get(cat);
			if (list) {
				list.sort((a, b) => a.label.localeCompare(b.label));
				sorted.set(cat, list);
			}
		}
		return sorted;
	}, [actions]);

	return (
		<div>
			<PageHeading title="Keyboard Shortcuts" subtitle="All available keyboard shortcuts" />

			{Array.from(grouped.entries()).map(([category, categoryActions]) => (
				<div key={category} className="mb-6">
					<SectionLabel>{category}</SectionLabel>
					<div className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
						{categoryActions.map((action) => (
							<div
								key={action.id}
								className="flex items-center justify-between px-4 py-3"
							>
								<span className="text-[13px] text-[var(--text-secondary)]">
									{action.label}
								</span>
								{action.shortcut && <ShortcutBadge shortcut={action.shortcut} />}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}
