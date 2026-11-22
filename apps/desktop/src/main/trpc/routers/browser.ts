import { getWorkspaceCwdOrThrow } from "../../agent-launch/workspace-cwd-lookup";
import { browserRuntime, workspaceBrowser } from "../../browser/instance";
import { createBrowserRouter } from "../../browser/router";

export const browserRouter = createBrowserRouter(
	workspaceBrowser,
	getWorkspaceCwdOrThrow,
	browserRuntime
);
