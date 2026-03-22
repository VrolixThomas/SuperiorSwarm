import { router } from "../index";
import { aiReviewRouter } from "./ai-review";
import { commentSolverRouter } from "./comment-solver";
import { atlassianRouter } from "./atlassian";
import { branchesRouter } from "./branches";
import { diffRouter } from "./diff";
import { githubRouter } from "./github";
import { linearRouter } from "./linear";
import { prPollerRouter } from "./pr-poller";
import { projectsRouter } from "./projects";
import { sharedFilesRouter } from "./shared-files";
import { terminalSessionsRouter } from "./terminal-sessions";
import { ticketsRouter } from "./tickets";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	aiReview: aiReviewRouter,
	commentSolver: commentSolverRouter,
	projects: projectsRouter,
	workspaces: workspacesRouter,
	branches: branchesRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
	diff: diffRouter,
	sharedFiles: sharedFilesRouter,
	linear: linearRouter,
	github: githubRouter,
	tickets: ticketsRouter,
	prPoller: prPollerRouter,
});

export type AppRouter = typeof appRouter;
