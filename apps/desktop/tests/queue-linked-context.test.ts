import "./preload-electron-mock";
import { beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
	linkedWorkByWorkspace,
	linkedWorkForEntity,
} from "../src/main/activity-queue/linked-context";
import { listWorkspaceQueue, workspaceDone } from "../src/main/activity-queue/workspace-queue";
import { getDb } from "../src/main/db";
import {
	githubBranchPrs,
	terminalSessions,
	ticketBranchLinks,
	ticketCache,
	trackedPrs,
	workspaces,
} from "../src/main/db/schema";
import type { DaemonClient } from "../src/main/terminal/daemon-client";
import { setDaemonClient } from "../src/main/terminal/daemon-instance";
import { seedProject, seedWorkspace, setupTestDb } from "./helpers/db";

beforeAll(setupTestDb);
async function workspace() {
	return seedWorkspace(await seedProject(), { name: "Queue context" });
}
function link(id: string, provider: "linear" | "jira", ticketId: string) {
	getDb()
		.insert(ticketBranchLinks)
		.values({ id: crypto.randomUUID(), workspaceId: id, provider, ticketId, createdAt: new Date() })
		.run();
}
function cache(ticketId: string, data: unknown, provider: "linear" | "jira" = "linear") {
	getDb()
		.insert(ticketCache)
		.values({
			id: `${provider}:${ticketId}`,
			provider,
			data: JSON.stringify(data),
			groupId: "team",
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({ target: ticketCache.id, set: { data: JSON.stringify(data) } })
		.run();
}
function pr(workspaceId: string, owner: string, repo: string, number: number) {
	getDb()
		.insert(githubBranchPrs)
		.values({
			id: crypto.randomUUID(),
			workspaceId,
			prRepoOwner: owner,
			prRepoName: repo,
			prNumber: number,
			createdAt: new Date(),
		})
		.run();
}
function tracked(provider: string, owner: string, repo: string, number: number, title: string) {
	getDb()
		.insert(trackedPrs)
		.values({
			provider,
			identifier: `${owner}/${repo}#${number}`,
			repoOwner: owner,
			repoName: repo,
			number,
			title,
			state: "open",
			role: "author",
			firstSeenAt: new Date(),
			lastSeenAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing()
		.run();
}

test("multiple explicit links use exact global Linear ID; siblings and coordinators do not inherit", async () => {
	const id = await workspace();
	const sibling = await workspace();
	const ticketId = crypto.randomUUID();
	link(id, "linear", ticketId);
	cache(ticketId, {
		id: ticketId,
		identifier: "SUP-10",
		title: "Explain the queue",
		url: "https://linear.app/superiorset/issue/SUP-10/queue",
	});
	pr(id, "swarm", "desktop", 42);
	tracked("github", "swarm", "desktop", 42, "Review queue context");
	const list = linkedWorkByWorkspace([id, sibling]);
	expect(
		list
			.get(id)
			?.map((v) => v.title)
			.sort()
	).toEqual(["Explain the queue", "Review queue context"].sort());
	expect(list.get(sibling)).toBeUndefined();
	expect(linkedWorkForEntity({ kind: "coordinator", id })).toEqual([]);
	expect(linkedWorkForEntity({ kind: "workspace", id: "missing" })).toEqual([]);
});
test("Jira site-local key never imports another site cache; malformed/mismatched Linear stays explicit", async () => {
	const id = await workspace();
	const ticketId = crypto.randomUUID();
	const bad = crypto.randomUUID();
	link(id, "jira", "SUP-101");
	cache(
		"SUP-101",
		{ key: "SUP-101", summary: "Wrong site", webUrl: "https://other.atlassian.net/browse/SUP-101" },
		"jira"
	);
	link(id, "linear", ticketId);
	cache(ticketId, { id: crypto.randomUUID(), title: "Wrong global id" });
	link(id, "linear", bad);
	cache(bad, {});
	getDb()
		.update(ticketCache)
		.set({ data: "{" })
		.where(eq(ticketCache.id, `linear:${bad}`))
		.run();
	const list = linkedWorkForEntity({ kind: "workspace", id });
	expect(list).toHaveLength(3);
	expect(list.every((v) => !v.title && !v.url && v.metadata === "unavailable")).toBe(true);
	expect(list.find((v) => v.provider === "jira")?.unavailableReason).toContain("Jira site");
});
test("PR lookup is provider/repository-specific and explicit review link deduplicates", async () => {
	const id = await workspace();
	pr(id, "team-a", "app", 99);
	pr(id, "team-b", "app", 99);
	tracked("github", "team-a", "app", 99, "GitHub A");
	tracked("bitbucket", "team-a", "app", 99, "Bitbucket A");
	tracked("github", "team-b", "app", 99, "GitHub B");
	getDb()
		.update(workspaces)
		.set({ prProvider: "github", prIdentifier: "team-a/app#99" })
		.where(eq(workspaces.id, id))
		.run();
	let list = linkedWorkForEntity({ kind: "workspace", id });
	expect(list).toHaveLength(2);
	expect(list.map((v) => v.title)).toEqual(["GitHub A", "GitHub B"]);
	getDb()
		.update(workspaces)
		.set({ prProvider: "bitbucket", prIdentifier: "team-a/app#99" })
		.where(eq(workspaces.id, id))
		.run();
	list = linkedWorkForEntity({ kind: "workspace", id });
	expect(list).toHaveLength(3);
	expect(list.find((v) => v.provider === "bitbucket")?.url).toBe(
		"https://bitbucket.org/team-a/app/pull-requests/99"
	);
});
test("missing details retain links; unsafe URLs/control text and path traversal never escape", async () => {
	const id = await workspace();
	const ticketId = crypto.randomUUID();
	link(id, "linear", ticketId);
	cache(ticketId, {
		id: ticketId,
		identifier: "SUP-3",
		title: "Title\u0000\nclean",
		url: "javascript:alert(1)",
	});
	pr(id, "..", "repo", 1);
	pr(id, "owner", "missing", 23);
	const list = linkedWorkForEntity({ kind: "workspace", id });
	expect(list).toHaveLength(2);
	expect(list.find((v) => v.kind === "ticket")?.title).toBe("Title  clean");
	expect(list.find((v) => v.kind === "ticket")?.url).toBeUndefined();
	expect(list.find((v) => v.kind === "pr")).toMatchObject({
		label: "owner/missing#23",
		metadata: "unavailable",
		url: "https://github.com/owner/missing/pull/23",
	});
});
test("link removal and metadata refresh reflect immediately without mutating source tables", async () => {
	const id = await workspace();
	const ticketId = crypto.randomUUID();
	link(id, "linear", ticketId);
	cache(ticketId, { id: ticketId, identifier: "SUP-4", title: "Before" });
	expect(linkedWorkForEntity({ kind: "workspace", id })[0]?.title).toBe("Before");
	cache(ticketId, { id: ticketId, identifier: "SUP-4", title: "After" });
	expect(linkedWorkForEntity({ kind: "workspace", id })[0]?.title).toBe("After");
	getDb().delete(ticketBranchLinks).where(eq(ticketBranchLinks.workspaceId, id)).run();
	expect(linkedWorkForEntity({ kind: "workspace", id })).toEqual([]);
});

test("read-time context refresh preserves exact queue receipt and Done stays dismissed", async () => {
	const id = await workspace();
	const ticketId = crypto.randomUUID();
	const terminalId = crypto.randomUUID();
	getDb()
		.insert(terminalSessions)
		.values({
			id: terminalId,
			workspaceId: id,
			title: "Context chat",
			cwd: "/tmp",
			sortOrder: 0,
			updatedAt: new Date(),
		})
		.run();
	getDb()
		.update(workspaces)
		.set({ currentPhase: "blocked", needs: "Pick a queue behavior" })
		.where(eq(workspaces.id, id))
		.run();
	const daemon = {
		isConnected: true,
		async listSessionsStrict() {
			return [{ id: terminalId, cwd: "/tmp", pid: 1 }];
		},
	};
	setDaemonClient(daemon as unknown as DaemonClient);
	try {
		const before = (await listWorkspaceQueue()).items.find((v) => v.context.workspaceId === id);
		expect(before).toBeDefined();
		if (!before) throw Error("Expected workspace attention");
		link(id, "linear", ticketId);
		cache(ticketId, { id: ticketId, identifier: "SUP-9", title: "New context" });
		const after = (await listWorkspaceQueue()).items.find((v) => v.id === before.id);
		expect(after?.revision).toBe(before.revision);
		expect(after?.context.linkedWork?.[0]?.title).toBe("New context");
		expect((await workspaceDone({ id: before.id, revision: before.revision })).status).toBe(
			"acknowledged"
		);
		cache(ticketId, { id: ticketId, identifier: "SUP-9", title: "Changed context" });
		expect((await listWorkspaceQueue()).items.some((v) => v.id === before.id)).toBe(false);
	} finally {
		setDaemonClient(null);
	}
});
