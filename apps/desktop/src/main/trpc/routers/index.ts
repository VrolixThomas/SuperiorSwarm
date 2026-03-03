import { router } from "../index";
import { atlassianRouter } from "./atlassian";
import { branchesRouter } from "./branches";
import { diffRouter } from "./diff";
import { linearRouter } from "./linear";
import { projectsRouter } from "./projects";
import { sharedFilesRouter } from "./shared-files";
import { terminalSessionsRouter } from "./terminal-sessions";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	projects: projectsRouter,
	workspaces: workspacesRouter,
	branches: branchesRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
	diff: diffRouter,
	sharedFiles: sharedFilesRouter,
	linear: linearRouter,
});

export type AppRouter = typeof appRouter;
