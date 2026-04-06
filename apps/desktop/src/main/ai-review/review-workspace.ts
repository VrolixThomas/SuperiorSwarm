import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { checkoutBranchWorktree } from "../git/operations";

export async function ensureReviewWorkspace(opts: {
	projectId: string;
	prProvider: string;
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
}): Promise<{ workspaceId: string; worktreePath: string }> {
	const { basename, dirname, join } = await import("node:path");
	const { nanoid } = await import("nanoid");
	const db = getDb();

	// 1. Check for existing review workspace
	let workspace = db
		.select()
		.from(schema.workspaces)
		.where(
			and(
				eq(schema.workspaces.projectId, opts.projectId),
				eq(schema.workspaces.prProvider, opts.prProvider),
				eq(schema.workspaces.prIdentifier, opts.prIdentifier)
			)
		)
		.get();

	// 2. Create if not exists
	if (!workspace) {
		const id = nanoid();
		const now = new Date();
		const prParts = opts.prIdentifier.split("#");
		const prNumber = prParts.length > 1 ? prParts[1] : opts.prIdentifier;
		const safePrNumber = prNumber || opts.prIdentifier || "unknown";
		const name = `PR #${safePrNumber}: ${opts.prTitle}`;
		db.insert(schema.workspaces)
			.values({
				id,
				projectId: opts.projectId,
				name,
				type: "review",
				prProvider: opts.prProvider,
				prIdentifier: opts.prIdentifier,
				createdAt: now,
				updatedAt: now,
			})
			.run();
		workspace = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).get()!;
	}

	// 3. Ensure worktree exists
	const project = db
		.select()
		.from(schema.projects)
		.where(eq(schema.projects.id, opts.projectId))
		.get();
	if (!project) throw new Error("Project not found");

	function worktreeBasePath(repoPath: string): string {
		const parent = dirname(repoPath);
		const name = basename(repoPath) || "repo";
		return join(parent, `${name}-worktrees`);
	}

	if (!workspace.worktreeId) {
		// Compute worktree path
		const sanitizedId = opts.prIdentifier.replace(/[^a-zA-Z0-9-]/g, "-");
		const wtPath = join(worktreeBasePath(project.repoPath), `pr-review-${sanitizedId}`);

		const { existsSync } = await import("node:fs");
		if (!existsSync(wtPath)) {
			// Worktree doesn't exist on disk — create it
			await checkoutBranchWorktree(project.repoPath, wtPath, opts.sourceBranch);
		} else {
			// Worktree already exists on disk (e.g., previous cleanup deleted DB records
			// but failed to remove the directory). Reuse it — just fetch latest.
			const { execSync } = await import("node:child_process");
			try {
				execSync("git fetch origin", { cwd: wtPath, stdio: "pipe" });
				execSync(`git reset --hard origin/${opts.sourceBranch}`, {
					cwd: wtPath,
					stdio: "pipe",
				});
			} catch (err) {
				console.error("[ai-review] Failed to update existing worktree, continuing:", err);
			}
		}

		// Register worktree in DB and link to workspace
		const now = new Date();
		const worktreeId = nanoid();
		db.insert(schema.worktrees)
			.values({
				id: worktreeId,
				projectId: opts.projectId,
				path: wtPath,
				branch: opts.sourceBranch,
				baseBranch: opts.targetBranch,
				createdAt: now,
				updatedAt: now,
			})
			.run();

		db.update(schema.workspaces)
			.set({ worktreeId, updatedAt: now })
			.where(eq(schema.workspaces.id, workspace.id))
			.run();

		return { workspaceId: workspace.id, worktreePath: wtPath };
	}

	// Worktree exists — update to latest
	const worktree = db
		.select()
		.from(schema.worktrees)
		.where(eq(schema.worktrees.id, workspace.worktreeId))
		.get();

	if (!worktree?.path) throw new Error("Worktree record not found");

	const { execSync } = await import("node:child_process");
	try {
		execSync("git fetch origin", { cwd: worktree.path, stdio: "pipe" });
		execSync(`git reset --hard origin/${opts.sourceBranch}`, {
			cwd: worktree.path,
			stdio: "pipe",
		});
	} catch (err) {
		console.error("[ai-review] Failed to update worktree, continuing with current state:", err);
	}

	return { workspaceId: workspace.id, worktreePath: worktree.path };
}
