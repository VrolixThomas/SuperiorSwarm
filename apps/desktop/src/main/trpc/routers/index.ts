import { router } from "../index";
import { atlassianRouter } from "./atlassian";
import { branchesRouter } from "./branches";
import { projectsRouter } from "./projects";
import { terminalSessionsRouter } from "./terminal-sessions";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	projects: projectsRouter,
	workspaces: workspacesRouter,
	branches: branchesRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
});

export type AppRouter = typeof appRouter;
