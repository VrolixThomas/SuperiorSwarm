import { expect, test } from "bun:test";
import { laterOptions } from "../src/shared/queue-later-options";

test("event option comes first, calendar options use local time and input is unchanged", () => {
	const now = new Date(2026, 10, 20, 16, 30); // Friday
	const before = now.getTime();
	const options = laterOptions(now);
	expect(options.map((option) => option.label)).toEqual([
		"Until it changes",
		"In 1 hour",
		"This evening",
		"Tomorrow",
		"Next Monday",
	]);
	expect(options[0]).toEqual({ id: "until-change", label: "Until it changes", untilChange: true });
	expect(options.map((option) => option.until)).toEqual([
		undefined,
		before + 3_600_000,
		new Date(2026, 10, 20, 18).getTime(),
		new Date(2026, 10, 21, 9).getTime(),
		new Date(2026, 10, 23, 9).getTime(),
	]);
	expect(new Set(options.map((option) => option.id)).size).toBe(5);
	expect(now.getTime()).toBe(before);
});

test("at/after 18h evening moves to tomorrow; Monday means the following Monday", () => {
	for (const hour of [18, 23]) {
		const now = new Date(2026, 10, 23, hour);
		expect(laterOptions(now)[2]?.until).toBe(new Date(2026, 10, 24, 18).getTime());
		expect(laterOptions(now)[4]?.until).toBe(new Date(2026, 10, 30, 9).getTime());
	}
	expect(laterOptions(new Date(2026, 10, 22, 23))[4]?.until).toBe(
		new Date(2026, 10, 23, 9).getTime()
	);
});

test("calendar choices preserve wall clock time through month/year and DST boundaries", () => {
	for (const now of [
		new Date(2026, 11, 31, 23, 30),
		new Date(2026, 2, 28, 23, 30),
		new Date(2026, 9, 24, 23, 30),
	]) {
		const tomorrow = new Date(now);
		tomorrow.setDate(tomorrow.getDate() + 1);
		tomorrow.setHours(9, 0, 0, 0);
		expect(laterOptions(now)[3]?.until).toBe(tomorrow.getTime());
		expect(new Date(laterOptions(now)[3]?.until ?? 0).getHours()).toBe(9);
		expect(new Date(laterOptions(now)[4]?.until ?? 0).getDay()).toBe(1);
	}
});
