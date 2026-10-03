import { realpath } from "node:fs/promises";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";

/** Only the user-selected workspace root may back browser/editor operations. */
export async function resolveWorkspaceFileRoot(input: {
	workspaceId?: string;
	repoPath: string;
}): Promise<string> {
	if (!input.workspaceId) throw new Error("A registered workspace is required");
	const registered = await realpath(getWorkspaceCwdOrThrow(input.workspaceId));
	if ((await realpath(input.repoPath)) !== registered)
		throw new Error("File root does not match the workspace");
	return registered;
}
