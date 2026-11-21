export interface QueueLaterOption {
	id: string;
	label: string;
	until?: number;
	untilChange: boolean;
}

/** Calendar options use the caller's local timezone, including DST transitions. */
export function laterOptions(now: Date): QueueLaterOption[] {
	const evening = new Date(now);
	evening.setHours(18, 0, 0, 0);
	if (evening.getTime() <= now.getTime()) evening.setDate(evening.getDate() + 1);
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	tomorrow.setHours(9, 0, 0, 0);
	const monday = new Date(now);
	monday.setDate(monday.getDate() + ((8 - monday.getDay()) % 7 || 7));
	monday.setHours(9, 0, 0, 0);
	return [
		{ id: "until-change", label: "Until it changes", untilChange: true },
		{ id: "one-hour", label: "In 1 hour", until: now.getTime() + 3_600_000, untilChange: false },
		{ id: "evening", label: "This evening", until: evening.getTime(), untilChange: false },
		{ id: "tomorrow", label: "Tomorrow", until: tomorrow.getTime(), untilChange: false },
		{ id: "next-monday", label: "Next Monday", until: monday.getTime(), untilChange: false },
	];
}
