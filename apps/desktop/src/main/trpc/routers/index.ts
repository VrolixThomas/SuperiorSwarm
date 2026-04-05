import { router } from "../index";
import { aiReviewRouter } from "./ai-review";
import { atlassianRouter } from "./atlassian";
import { authRouter } from "./auth";
import { branchesRouter } from "./branches";
import { commentSolverRouter } from "./comment-solver";
import { diffRouter } from "./diff";
import { githubRouter } from "./github";
import { linearRouter } from "./linear";
import { mergeRouter } from "./merge";
import { prPollerRouter } from "./pr-poller";
import { projectsRouter } from "./projects";
import { rebaseRouter } from "./rebase";
import { remoteRouter } from "./remote";
import { sharedFilesRouter } from "./shared-files";
import { terminalSessionsRouter } from "./terminal-sessions";
import { ticketsRouter } from "./tickets";
import { updatesRouter } from "./updates";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	auth: authRouter,
	aiReview: aiReviewRouter,
	commentSolver: commentSolverRouter,
	projects: projectsRouter,
	workspaces: workspacesRouter,
	branches: branchesRouter,
	merge: mergeRouter,
	rebase: rebaseRouter,
	remote: remoteRouter,
	terminalSessions: terminalSessionsRouter,
	atlassian: atlassianRouter,
	diff: diffRouter,
	sharedFiles: sharedFilesRouter,
	linear: linearRouter,
	github: githubRouter,
	tickets: ticketsRouter,
	prPoller: prPollerRouter,
	updates: updatesRouter,
});

export type AppRouter = typeof appRouter;
