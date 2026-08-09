import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { hermesCreateInputSchema } from "../src/main/trpc/routers/hermes";

describe("Hermes task session creation contract", () => {
	test("accepts task and connection infrastructure but rejects a preselected cwd", () => {
		expect(
			hermesCreateInputSchema.parse({
				connectionId: "connection-1",
				topic: "Investigate the release failure across relevant repositories",
				profileId: "work",
			})
		).toEqual({
			connectionId: "connection-1",
			topic: "Investigate the release failure across relevant repositories",
			profileId: "work",
		});
		for (const forbidden of [
			{ cwd: "/repos/preselected-worktree" },
			{ workspaceId: "workspace-preselected" },
		]) {
			expect(
				hermesCreateInputSchema.safeParse({
					connectionId: "connection-1",
					topic: "Investigate the release failure",
					profileId: "work",
					...forbidden,
				}).success
			).toBe(false);
		}
	});
});
