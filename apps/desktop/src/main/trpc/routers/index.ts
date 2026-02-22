import { router } from "../index";
import { branchesRouter } from "./branches";
import { projectsRouter } from "./projects";
import { workspacesRouter } from "./workspaces";

export const appRouter = router({
	projects: projectsRouter,
	workspaces: workspacesRouter,
	branches: branchesRouter,
});

export type AppRouter = typeof appRouter;
