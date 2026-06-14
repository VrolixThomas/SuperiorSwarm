import { beforeEach, describe, expect, test } from "bun:test";
import {
	defaultBandState,
	parsePersisted,
	sanitizeOrder,
	useSidebarBandsStore,
} from "../src/renderer/stores/sidebar-bands";

describe("sanitizeOrder", () => {
	test("returns the three ids in default order for empty input", () => {
		expect(sanitizeOrder([])).toEqual(["folders", "repositories", "orchestrators"]);
	});
	test("dedupes and drops unknown ids, appends missing in default order", () => {
		expect(sanitizeOrder(["orchestrators", "orchestrators", "bogus"])).toEqual([
			"orchestrators",
			"folders",
			"repositories",
		]);
	});
});

describe("parsePersisted", () => {
	test("defaults when raw is null and no legacy key", () => {
		expect(parsePersisted(null, null)).toEqual(defaultBandState());
	});
	test("valid JSON overrides defaults and ignores legacy", () => {
		const raw = JSON.stringify({
			order: ["orchestrators", "repositories", "folders"],
			open: { orchestrators: false },
			heights: { folders: 150 },
		});
		const s = parsePersisted(raw, "false");
		expect(s.order).toEqual(["orchestrators", "repositories", "folders"]);
		expect(s.open.orchestrators).toBe(false);
		expect(s.open.repositories).toBe(true);
		expect(s.heights.folders).toBe(150);
	});
	test("corrupt JSON falls back to defaults", () => {
		expect(parsePersisted("{not json", null)).toEqual(defaultBandState());
	});
	test("legacy orchCollapsed=true seeds orchestrators closed", () => {
		expect(parsePersisted(null, "true").open.orchestrators).toBe(false);
	});
	test("legacy orchCollapsed=false seeds orchestrators open", () => {
		expect(parsePersisted(null, "false").open.orchestrators).toBe(true);
	});
});

describe("useSidebarBandsStore", () => {
	beforeEach(() => {
		useSidebarBandsStore.setState({ ...defaultBandState(), hydrated: false });
	});
	test("toggleOpen flips a band", () => {
		useSidebarBandsStore.getState().toggleOpen("folders");
		expect(useSidebarBandsStore.getState().open.folders).toBe(false);
		useSidebarBandsStore.getState().toggleOpen("folders");
		expect(useSidebarBandsStore.getState().open.folders).toBe(true);
	});
	test("setOrder sanitizes input", () => {
		useSidebarBandsStore.getState().setOrder(["orchestrators"]);
		expect(useSidebarBandsStore.getState().order).toEqual([
			"orchestrators",
			"folders",
			"repositories",
		]);
	});
	test("setHeight stores an explicit height and null resets it", () => {
		useSidebarBandsStore.getState().setHeight("repositories", 240);
		expect(useSidebarBandsStore.getState().heights.repositories).toBe(240);
		useSidebarBandsStore.getState().setHeight("repositories", null);
		expect(useSidebarBandsStore.getState().heights.repositories).toBeNull();
	});
});
