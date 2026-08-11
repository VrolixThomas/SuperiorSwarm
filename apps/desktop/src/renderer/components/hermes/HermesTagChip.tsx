import type { HermesTagColor, HermesTagDefinition } from "../../../shared/hermes";

export const HERMES_TAG_COLOR_CLASSES: Record<HermesTagColor, string> = {
	gray: "border-[var(--tag-gray-border)] bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]",
	blue: "border-[var(--tag-blue-border)] bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]",
	cyan: "border-[var(--tag-cyan-border)] bg-[var(--tag-cyan-bg)] text-[var(--tag-cyan-fg)]",
	green: "border-[var(--tag-green-border)] bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]",
	amber: "border-[var(--tag-amber-border)] bg-[var(--tag-amber-bg)] text-[var(--tag-amber-fg)]",
	orange: "border-[var(--tag-orange-border)] bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]",
	red: "border-[var(--tag-red-border)] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]",
	pink: "border-[var(--tag-pink-border)] bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]",
	purple: "border-[var(--tag-purple-border)] bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]",
};

export function HermesTagDot({ color }: { color: HermesTagColor }) {
	return (
		<span
			aria-hidden="true"
			data-tag-color={color}
			className={`size-2 shrink-0 rounded-full border ${HERMES_TAG_COLOR_CLASSES[color]}`}
		/>
	);
}

export function HermesTagChip({ tag }: { tag: HermesTagDefinition }) {
	return (
		<span
			title={tag.name}
			data-tag-color={tag.color}
			className={`inline-flex h-[17px] max-w-20 shrink-0 items-center truncate rounded-full border px-1.5 text-[9px] font-medium leading-none ${HERMES_TAG_COLOR_CLASSES[tag.color]}`}
		>
			{tag.name}
		</span>
	);
}
