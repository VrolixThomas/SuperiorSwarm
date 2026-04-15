import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { lspTrustedRepos } from "../db/schema";

export interface RepoTrustDecision {
	trusted: boolean;
	decided: boolean;
}

export function getRepoTrust(repoPath: string): RepoTrustDecision {
	const db = getDb();
	const row = db.select().from(lspTrustedRepos).where(eq(lspTrustedRepos.repoPath, repoPath)).get();
	if (!row) return { trusted: false, decided: false };
	return { trusted: row.trusted, decided: true };
}

export function setRepoTrust(repoPath: string, trusted: boolean): void {
	const db = getDb();
	const now = new Date();
	db.insert(lspTrustedRepos)
		.values({ repoPath, trusted, decidedAt: now })
		.onConflictDoUpdate({
			target: lspTrustedRepos.repoPath,
			set: { trusted, decidedAt: now },
		})
		.run();
}
