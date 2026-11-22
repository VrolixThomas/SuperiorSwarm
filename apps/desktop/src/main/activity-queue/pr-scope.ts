import { eq } from "drizzle-orm";
import type { ActivityQueueItem } from "../../shared/activity-queue";
import { getDb } from "../db";
import { atlassianAuth, githubAuth } from "../db/schema";
/** Read identity without decrypting credentials. Providers currently support these public hosts only. */
export function currentPRScope(provider: "github" | "bitbucket") {
	const row =
		provider === "github"
			? getDb().select({ accountId: githubAuth.accountId }).from(githubAuth).get()
			: getDb()
					.select({ accountId: atlassianAuth.accountId })
					.from(atlassianAuth)
					.where(eq(atlassianAuth.service, "bitbucket"))
					.get();
	return row
		? { accountId: row.accountId, host: provider === "github" ? "github.com" : "bitbucket.org" }
		: null;
}
export function isPRQueueItemCurrent(item: ActivityQueueItem) {
	if (item.target.type !== "pr") return false;
	const scope = currentPRScope(item.target.provider);
	return !!scope && item.target.accountId === scope.accountId && item.target.host === scope.host;
}
