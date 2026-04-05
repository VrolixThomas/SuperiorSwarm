import type { QuickAction } from "../db/schema";

type ShortcutAction = Pick<QuickAction, "id" | "shortcut" | "label" | "command" | "cwd">;

export function buildShortcutMap(
	actions: ShortcutAction[]
): Map<string, ShortcutAction> {
	const map = new Map<string, ShortcutAction>();
	for (const action of actions) {
		if (action.shortcut) {
			map.set(action.shortcut, action);
		}
	}
	return map;
}

let registeredShortcuts: string[] = [];

export function syncShortcuts(
	actions: ShortcutAction[],
	onTrigger: (action: ShortcutAction) => void,
	registerFn: (accelerator: string, callback: () => void) => void,
	unregisterFn: (accelerator: string) => void
): void {
	for (const acc of registeredShortcuts) {
		unregisterFn(acc);
	}
	registeredShortcuts = [];

	const map = buildShortcutMap(actions);
	for (const [accelerator, action] of map) {
		registerFn(accelerator, () => onTrigger(action));
		registeredShortcuts.push(accelerator);
	}
}
