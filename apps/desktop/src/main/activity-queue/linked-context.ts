import { inArray } from "drizzle-orm";
import type { QueueEntity } from "../../shared/activity-queue";
import type { QueueLinkedWork } from "../../shared/queue-linked-context";
import { getDb } from "../db";
import {
	githubBranchPrs,
	ticketBranchLinks,
	ticketCache,
	trackedPrs,
	workspaces,
} from "../db/schema";

function text(value: unknown, limit = 240): string | undefined {
	if (typeof value !== "string") return undefined;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip display controls from remote metadata.
	const controls = /[\x00-\x1f\x7f]/g;
	return value.replace(controls, " ").trim().slice(0, limit) || undefined;
}
function linearUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		if (
			url.protocol !== "https:" ||
			url.hostname !== "linear.app" ||
			url.username ||
			url.password ||
			url.port ||
			!/^\/[^/]+\/issue\/[^/]+/.test(url.pathname)
		)
			return undefined;
		return url.toString();
	} catch {
		return undefined;
	}
}

/** Batch local explicit links. Coordinators never inherit a linked project's work. */
export function linkedWorkByWorkspace(workspaceIds: string[]): Map<string, QueueLinkedWork[]> {
	const result = new Map<string, QueueLinkedWork[]>();
	const ids = [...new Set(workspaceIds)];
	if (!ids.length) return result;
	const db = getDb();
	// Only existing workspaces own these FK-backed links, never a same-ID coordinator.
	const owners = db.select().from(workspaces).where(inArray(workspaces.id, ids)).all();
	const owned = new Set(owners.map((row) => row.id));
	const add = (id: string, value: QueueLinkedWork) => {
		if (!owned.has(id)) return;
		const values = result.get(id) ?? [];
		if (
			!values.some(
				(item) =>
					item.kind === value.kind && item.provider === value.provider && item.id === value.id
			)
		)
			values.push(value);
		result.set(id, values);
	};
	const links = db
		.select()
		.from(ticketBranchLinks)
		.where(inArray(ticketBranchLinks.workspaceId, ids))
		.all();
	const cacheIds = links
		.filter((row) => row.provider === "linear")
		.map((row) => `linear:${row.ticketId}`);
	const cached = new Map(
		(cacheIds.length
			? db.select().from(ticketCache).where(inArray(ticketCache.id, cacheIds)).all()
			: []
		).map((row) => [row.id, row])
	);
	for (const link of links) {
		const value: QueueLinkedWork = {
			kind: "ticket",
			provider: link.provider,
			id: link.ticketId,
			label: text(link.ticketId) ?? "Linked ticket",
			metadata: "unavailable",
			unavailableReason: "Ticket details are not cached.",
		};
		// Jira keys are site-local; historical links/cache lack site identity. Never join on key alone.
		if (link.provider === "jira")
			value.unavailableReason =
				"This link has no saved Jira site. Open Tickets to verify its details.";
		const row = cached.get(`linear:${link.ticketId}`);
		if (
			link.provider === "linear" &&
			row?.provider === "linear" &&
			/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(link.ticketId)
		) {
			try {
				const data: unknown = JSON.parse(row.data);
				if (data && typeof data === "object" && "id" in data && data.id === link.ticketId) {
					const item = data as Record<string, unknown>;
					value.label = text(item["identifier"]) ?? value.label;
					value.title = text(item["title"]);
					value.url = linearUrl(item["url"]);
					if (value.title) {
						value.metadata = "cached";
						value.updatedAt = row.updatedAt.getTime();
						value.unavailableReason = undefined;
					}
				}
			} catch {
				/* An invalid cache row must not remove the explicit link. */
			}
		}
		add(link.workspaceId, value);
	}
	const prs = db
		.select()
		.from(githubBranchPrs)
		.where(inArray(githubBranchPrs.workspaceId, ids))
		.all()
		.map((row) => ({
			workspaceId: row.workspaceId,
			provider: "github",
			identifier: `${row.prRepoOwner}/${row.prRepoName}#${row.prNumber}`,
		}));
	for (const row of owners)
		if (row.prProvider && row.prIdentifier)
			prs.push({ workspaceId: row.id, provider: row.prProvider, identifier: row.prIdentifier });
	const prIds = [...new Set(prs.map((row) => row.identifier))];
	const observed = new Map(
		(prIds.length
			? db.select().from(trackedPrs).where(inArray(trackedPrs.identifier, prIds)).all()
			: []
		).map((row) => [`${row.provider}:${row.identifier}`, row])
	);
	for (const pr of prs) {
		if (pr.provider !== "github" && pr.provider !== "bitbucket") continue;
		const parsed = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)#([1-9][0-9]*)$/.exec(pr.identifier);
		if (!parsed) continue;
		const [, owner, repo, num] = parsed;
		const number = Number(num);
		if (
			!Number.isSafeInteger(number) ||
			owner === "." ||
			owner === ".." ||
			repo === "." ||
			repo === ".."
		)
			continue;
		const row = observed.get(`${pr.provider}:${pr.identifier}`);
		const valid = row && row.repoOwner === owner && row.repoName === repo && row.number === number;
		// The current provider adapters address github.com / bitbucket.org exclusively.
		const url =
			pr.provider === "github"
				? `https://github.com/${owner}/${repo}/pull/${number}`
				: `https://bitbucket.org/${owner}/${repo}/pull-requests/${number}`;
		const title = valid ? text(row.title) : undefined;
		add(pr.workspaceId, {
			kind: "pr",
			provider: pr.provider,
			id: pr.identifier,
			label: pr.identifier,
			title,
			url,
			metadata: title ? "cached" : "unavailable",
			...(title && row
				? { updatedAt: row.lastSeenAt.getTime() }
				: { unavailableReason: "PR details are not cached." }),
		});
	}
	for (const values of result.values())
		values.sort((a, b) =>
			`${a.kind}:${a.provider}:${a.id}`.localeCompare(`${b.kind}:${b.provider}:${b.id}`)
		);
	return result;
}

export function linkedWorkForEntity(entity: QueueEntity): QueueLinkedWork[] {
	return entity.kind === "workspace"
		? (linkedWorkByWorkspace([entity.id]).get(entity.id) ?? [])
		: [];
}
