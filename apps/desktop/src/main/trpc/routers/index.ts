import { router } from "../index";
import { aiReviewRouter } from "./ai-review";
import { atlassianRouter } from "./atlassian";
import { branchesRouter } from "./branches";
import { diffRouter } from "./diff";
import { githubRouter } from "./github";
import { linearRouter } from "./linear";
import { projectsRouter } from "./projects";
import { reviewWorkspacesRouter } from "./review-workspaces";
import { sharedFilesRouter } from "./shared-files";
import { terminalSessionsRouter } from "./terminal-sessions";
import { ticketsRouter } from "./tickets";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	aiReview: aiReviewRouter,
	projects: projectsRouter,
	workspaces: workspacesRouter,
	reviewWorkspaces: reviewWorkspacesRouter,
	branches: branchesRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
	diff: diffRouter,
	sharedFiles: sharedFilesRouter,
	linear: linearRouter,
	github: githubRouter,
	tickets: ticketsRouter,
});

export type AppRouter = typeof appRouter;
