import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import { type Project, projects, workspaces } from "../db/schema";
import { detectDefaultBranch, getGitRoot, isGitRepo, parseRemoteUrl } from "../git/operations";
import { ensureRepoExclude } from "./git-exclude";
import { randomColor } from "./project-colors";

export function resolveTilde(p: string): string {
	if (p.startsWith("~/")) return join(homedir(), p.slice(2));
	if (p === "~") return homedir();
	return p;
}

export interface OpenFolderInput {
	path: string;
	/** Open as folder even when the path is a git repository. */
	force?: boolean;
	/** Quick-terminal path: skip the git-repo prompt entirely. */
	quick?: boolean;
}

export interface OpenFolderResult {
	project: Project | null;
	/** True when the path is a git repo and neither force nor quick was set. */
	isGitRepo: boolean;
}

export async function openFolderProject(input: OpenFolderInput): Promise<OpenFolderResult> {
	const path = resolveTilde(input.path);
	if (!isAbsolute(path)) {
		throw new Error("Path must be absolute");
	}
	if (!existsSync(path)) {
		throw new Error(`Folder does not exist: ${path}`);
	}
	if (!statSync(path).isDirectory()) {
		throw new Error(`Not a folder: ${path}`);
	}

	const canonical = realpathSync(path);

	const db = getDb();
	const existing = db.select().from(projects).where(eq(projects.repoPath, canonical)).get();
	if (existing) {
		return { project: existing, isGitRepo: false };
	}

	if (!input.force && !input.quick && (await isGitRepo(canonical))) {
		return { project: null, isGitRepo: true };
	}

	const now = new Date();
	const project = {
		id: nanoid(),
		name: canonical.split("/").pop() ?? "folder",
		repoPath: canonical,
		defaultBranch: "main",
		color: randomColor(),
		remoteOwner: null as string | null,
		remoteRepo: null as string | null,
		remoteHost: null as string | null,
		kind: "folder" as const,
		status: "ready" as const,
		createdAt: now,
		updatedAt: now,
	};
	db.insert(projects).values(project).run();
	db.insert(workspaces)
		.values({
			id: nanoid(),
			projectId: project.id,
			type: "folder",
			name: "default",
			worktreeId: null,
			terminalId: null,
			folderPath: null, // null = project root
			createdAt: now,
			updatedAt: now,
		})
		.run();

	return { project, isGitRepo: false };
}

export interface CreateFolderWorkspaceInput {
	projectId: string;
	name: string;
	folderPath?: string;
}

export interface CreateFolderWorkspaceResult {
	workspaceId: string;
	folderPath: string | null;
}

export async function createFolderWorkspace(
	input: CreateFolderWorkspaceInput
): Promise<CreateFolderWorkspaceResult> {
	const trimmed = input.name.trim();
	if (trimmed.length === 0) {
		throw new Error("Name cannot be empty");
	}

	const db = getDb();
	const project = db.select().from(projects).where(eq(projects.id, input.projectId)).get();
	if (!project) {
		throw new Error(`Project not found: ${input.projectId}`);
	}
	if (project.kind !== "folder") {
		throw new Error("Workspaces with a custom folder can only be added to folder projects");
	}

	let folderPath: string | null = null;
	if (input.folderPath) {
		const candidate = resolveTilde(input.folderPath);
		if (!isAbsolute(candidate)) {
			throw new Error("Folder path must be absolute");
		}
		if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
			throw new Error(`Folder does not exist: ${candidate}`);
		}
		const realBase = realpathSync(project.repoPath);
		const realCandidate = realpathSync(candidate);
		if (realCandidate !== realBase && !realCandidate.startsWith(realBase + sep)) {
			throw new Error("Folder must be inside the project folder");
		}
		folderPath = realCandidate === realBase ? null : realCandidate;
	}

	const dup = db
		.select({ id: workspaces.id })
		.from(workspaces)
		.where(and(eq(workspaces.projectId, input.projectId), eq(workspaces.name, trimmed)))
		.get();
	if (dup) throw new Error(`Name "${trimmed}" is already in use in this project`);

	const now = new Date();
	const id = nanoid();
	db.insert(workspaces)
		.values({
			id,
			projectId: input.projectId,
			type: "folder",
			name: trimmed,
			worktreeId: null,
			terminalId: null,
			folderPath,
			createdAt: now,
			updatedAt: now,
		})
		.run();

	return { workspaceId: id, folderPath };
}

export async function convertProjectToRepo(input: { id: string }): Promise<Project> {
	const db = getDb();
	const project = db.select().from(projects).where(eq(projects.id, input.id)).get();
	if (!project) {
		throw new Error(`Project not found: ${input.id}`);
	}
	if (project.kind !== "folder") {
		return project;
	}

	const gitRoot = await getGitRoot(project.repoPath);
	if (!gitRoot) {
		throw new Error("Not a git repository. Run git init in the folder first.");
	}
	if (realpathSync(gitRoot) !== realpathSync(project.repoPath)) {
		throw new Error(
			`Folder is inside a git repository rooted at ${gitRoot}. Open that path as a repository instead.`
		);
	}

	const defaultBranch = await detectDefaultBranch(project.repoPath);
	const remote = await parseRemoteUrl(project.repoPath);
	const now = new Date();
	db.update(projects)
		.set({
			kind: "repo",
			defaultBranch,
			remoteOwner: remote?.owner ?? null,
			remoteRepo: remote?.repo ?? null,
			remoteHost: remote?.host ?? null,
			updatedAt: now,
		})
		.where(eq(projects.id, input.id))
		.run();
	try {
		ensureRepoExclude(project.repoPath);
	} catch (err) {
		console.warn("[git-exclude] failed:", err);
	}

	// Promote the default folder workspace (cwd = project root) to the branch workspace.
	const defaultWs = db
		.select()
		.from(workspaces)
		.where(
			and(
				eq(workspaces.projectId, input.id),
				eq(workspaces.type, "folder"),
				isNull(workspaces.folderPath)
			)
		)
		.get();
	if (defaultWs) {
		db.update(workspaces)
			.set({ type: "branch", name: defaultBranch, updatedAt: now })
			.where(eq(workspaces.id, defaultWs.id))
			.run();
	} else {
		db.insert(workspaces)
			.values({
				id: nanoid(),
				projectId: input.id,
				type: "branch",
				name: defaultBranch,
				worktreeId: null,
				terminalId: null,
				createdAt: now,
				updatedAt: now,
			})
			.run();
	}

	const updated = db.select().from(projects).where(eq(projects.id, input.id)).get();
	if (!updated) throw new Error(`Project not found after convert: ${input.id}`);
	return updated;
}
