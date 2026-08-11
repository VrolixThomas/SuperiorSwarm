import { type KeyboardEvent, useId } from "react";
import { HERMES_TAG_COLORS, type HermesTagColor } from "../../../shared/hermes";
import { HermesTagDot } from "./HermesTagChip";

const COLOR_LABELS: Record<HermesTagColor, string> = {
	gray: "Gray",
	blue: "Blue",
	cyan: "Cyan",
	green: "Green",
	amber: "Amber",
	orange: "Orange",
	red: "Red",
	pink: "Pink",
	purple: "Purple",
};

export function HermesTagColorPicker({
	value,
	onChange,
	disabled = false,
}: {
	value: HermesTagColor;
	onChange: (color: HermesTagColor) => void;
	disabled?: boolean;
}) {
	const groupName = useId();

	function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, color: HermesTagColor) {
		const isPrevious = event.key === "ArrowLeft" || event.key === "ArrowUp";
		const isNext = event.key === "ArrowRight" || event.key === "ArrowDown";
		if (!isPrevious && !isNext && event.key !== "Home" && event.key !== "End") return;
		event.preventDefault();
		const currentIndex = HERMES_TAG_COLORS.indexOf(color);
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? HERMES_TAG_COLORS.length - 1
					: (currentIndex + (isPrevious ? -1 : 1) + HERMES_TAG_COLORS.length) %
						HERMES_TAG_COLORS.length;
		const nextColor = HERMES_TAG_COLORS[nextIndex];
		if (!nextColor) return;
		onChange(nextColor);
		const choices = event.currentTarget
			.closest('[role="radiogroup"]')
			?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
		choices?.[nextIndex]?.focus();
	}

	return (
		<div role="radiogroup" aria-label="Tag color" className="flex flex-wrap gap-1.5">
			{HERMES_TAG_COLORS.map((color) => (
				<label
					key={color}
					title={COLOR_LABELS[color]}
					className={`grid size-7 place-items-center rounded-[6px] border transition-colors has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--accent)]/60 ${disabled ? "opacity-40" : "cursor-pointer"} ${
						value === color
							? "border-[var(--border-active)] bg-[var(--bg-active)]"
							: "border-transparent hover:bg-[var(--bg-overlay)]"
					}`}
				>
					<input
						type="radio"
						name={groupName}
						checked={value === color}
						aria-label={`${COLOR_LABELS[color]} tag color`}
						disabled={disabled}
						tabIndex={value === color ? 0 : -1}
						onChange={() => onChange(color)}
						onKeyDown={(event) => handleKeyDown(event, color)}
						className="sr-only"
					/>
					<HermesTagDot color={color} />
				</label>
			))}
		</div>
	);
}
