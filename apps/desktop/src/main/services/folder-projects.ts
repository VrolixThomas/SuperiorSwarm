import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import { type Project, projects, workspaces } from "../db/schema";
import { isGitRepo } from "../git/operations";
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
		folderPath = realCandidate === realBase ? null : candidate;
	}

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
