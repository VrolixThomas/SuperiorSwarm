import { describe, expect, mock, test } from "bun:test";

describe("buildShortcutMap", () => {
	test("builds map from actions with shortcuts", () => {
		const { buildShortcutMap } = require("../src/main/quick-actions/shortcuts");
		const actions = [
			{ id: "1", shortcut: "CommandOrControl+Shift+B", label: "Build", command: "bun run build" },
			{ id: "2", shortcut: null, label: "Test", command: "bun test" },
			{ id: "3", shortcut: "CommandOrControl+Shift+T", label: "Type Check", command: "bun run type-check" },
		];
		const map = buildShortcutMap(actions);
		expect(map.size).toBe(2);
		expect(map.get("CommandOrControl+Shift+B")?.id).toBe("1");
		expect(map.get("CommandOrControl+Shift+T")?.id).toBe("3");
	});

	test("returns empty map for no actions", () => {
		const { buildShortcutMap } = require("../src/main/quick-actions/shortcuts");
		const map = buildShortcutMap([]);
		expect(map.size).toBe(0);
	});

	test("skips actions with empty shortcut strings", () => {
		const { buildShortcutMap } = require("../src/main/quick-actions/shortcuts");
		const actions = [
			{ id: "1", shortcut: "", label: "Build", command: "bun run build" },
		];
		const map = buildShortcutMap(actions);
		expect(map.size).toBe(0);
	});
});
