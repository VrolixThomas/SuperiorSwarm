import "./preload-electron-mock";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { executeBrowserAgentRequest } from "../src/main/browser/agent";
import { BrowserService } from "../src/main/browser/service";
import { startControlPlane } from "../src/main/control-plane";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

let server: Awaited<ReturnType<typeof startControlPlane>>;
let workspace: string;
let other: string;
let called: string[];
beforeEach(async () => {
	setupTestDb();
	const project = await seedProject();
	workspace = await seedWorkspace(project, { name: "browser-test" });
	other = await seedWorkspace(project, { name: "browser-test" });
	called = [];
	const service = new BrowserService(() => {
		throw Error("This test must not create a native page.");
	});
	server = await startControlPlane({
		confirm: async () => true,
		spawnFn: async () => ({ sessionId: "s", terminalId: "t" }),
		browserRequest: (id, request) => {
			called.push(id);
			return executeBrowserAgentRequest(service, id, request, () => {});
		},
	});
});
afterEach(async () => {
	await server?.stop();
});
async function request(headers: Record<string, string>, body: unknown) {
	return fetch(`http://127.0.0.1:${server.port}/browser.execute`, {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}
test("browser route requires bearer and a registered workspace identity", async () => {
	expect((await request({}, { operation: "list" })).status).toBe(401);
	expect(
		(await request({ Authorization: `Bearer ${server.token}` }, { operation: "list" })).status
	).toBe(403);
	expect(
		(
			await request(
				{ Authorization: `Bearer ${server.token}`, "X-Workspace-Id": "missing" },
				{ operation: "list" }
			)
		).status
	).toBe(403);
	expect(called).toEqual([]);
});
test("caller scope comes from authenticated context, not a tool-supplied workspace", async () => {
	const result = await request(
		{ Authorization: `Bearer ${server.token}`, "X-Workspace-Id": workspace },
		{ operation: "list", workspaceId: other }
	);
	expect(result.status).toBe(200);
	expect(called).toEqual([workspace]);
	expect((await result.json()).tabs).toEqual([]);
});
test("privileged URLs and agent control bypass commands never reach browser service", async () => {
	const headers = { Authorization: `Bearer ${server.token}`, "X-Workspace-Id": workspace };
	expect((await request(headers, { operation: "open", url: "file:///tmp/secret" })).status).toBe(
		400
	);
	expect(
		(
			await request(headers, {
				operation: "act",
				browserId: "b",
				action: { kind: "agent-control", enabled: true },
			})
		).status
	).toBe(400);
	expect(called).toEqual([]);
});
