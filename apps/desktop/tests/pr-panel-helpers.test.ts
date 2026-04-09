import { describe, expect, test } from "bun:test";
import {
	findActivePRIdentifier,
	resolveDisplayName,
} from "../src/renderer/components/pr-panel-helpers";

const project = (overrides: {
	name: string;
	remoteOwner: string | null;
	remoteRepo: string | null;
}) => ({
	id: "p1",
	name: overrides.name,
	repoPath: "/tmp/x",
	defaultBranch: "main",
	color: null,
	remoteOwner: overrides.remoteOwner,
	remoteRepo: overrides.remoteRepo,
	remoteHost: null,
	status: "ready" as const,
	createdAt: new Date(),
	updatedAt: new Date(),
});

describe("resolveDisplayName", () => {
	test("returns local Project.name when remote owner+repo match", () => {
		const projects = [project({ name: "portal", remoteOwner: "slotsgames", remoteRepo: "portal" })];
		expect(resolveDisplayName({ owner: "slotsgames", repo: "portal" }, projects)).toBe("portal");
	});

	test("falls back to owner/repo when no project matches", () => {
		const projects = [project({ name: "portal", remoteOwner: "slotsgames", remoteRepo: "portal" })];
		expect(resolveDisplayName({ owner: "facebook", repo: "react" }, projects)).toBe(
			"facebook/react"
		);
	});

	test("falls back to owner/repo when projectsList is undefined", () => {
		expect(resolveDisplayName({ owner: "facebook", repo: "react" }, undefined)).toBe(
			"facebook/react"
		);
	});

	test("falls back to owner/repo when projectsList is empty", () => {
		expect(resolveDisplayName({ owner: "a", repo: "b" }, [])).toBe("a/b");
	});

	test("does not match a project with null remote fields", () => {
		const projects = [project({ name: "local", remoteOwner: null, remoteRepo: null })];
		expect(resolveDisplayName({ owner: "a", repo: "b" }, projects)).toBe("a/b");
	});
});

describe("findActivePRIdentifier", () => {
	test("returns the identifier when activeWorkspaceId matches a value", () => {
		const map = new Map<string, string>([
			["owner/repo#1", "ws-a"],
			["owner/repo#2", "ws-b"],
		]);
		expect(findActivePRIdentifier(map, "ws-b")).toBe("owner/repo#2");
	});

	test("returns null when activeWorkspaceId is empty", () => {
		const map = new Map([["owner/repo#1", "ws-a"]]);
		expect(findActivePRIdentifier(map, "")).toBeNull();
	});

	test("returns null when no entry matches", () => {
		const map = new Map([["owner/repo#1", "ws-a"]]);
		expect(findActivePRIdentifier(map, "ws-z")).toBeNull();
	});

	test("returns null for an empty map", () => {
		expect(findActivePRIdentifier(new Map(), "ws-a")).toBeNull();
	});
});
