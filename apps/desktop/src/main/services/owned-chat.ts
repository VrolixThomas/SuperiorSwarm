import { randomUUID } from "node:crypto";
import type { OwnedChatLaunch, OwnedChatProvider } from "../../shared/owned-chat";
import { queueEntities } from "../activity-queue/entities";
import { getWorkspaceCwdOrThrow } from "../agent-launch/workspace-cwd-lookup";
import { getAgentSessionManager } from "./agent-session-manager-handle";
import { type SpawnFn, buildLaunchScript, defaultSpawnFn } from "./workspace-service";

/** A local user's own chat is app-owned, but never an orchestrator dispatch target. */
export async function startOwnedChat(
	input: { workspaceId: string; provider: OwnedChatProvider },
	deps: { spawn?: SpawnFn } = {}
): Promise<OwnedChatLaunch> {
	if (!["claude", "codex"].includes(input.provider)) throw Error("Unsupported chat provider");
	if (!queueEntities().has(input.workspaceId)) throw Error("This workspace is no longer available");
	if (!getAgentSessionManager()) throw Error("Chat startup is not available yet");
	const cwd = getWorkspaceCwdOrThrow(input.workspaceId);
	const queueLaunchId = randomUUID();
	const providerSessionId = input.provider === "claude" ? randomUUID() : null;
	const title = input.provider === "claude" ? "Claude chat" : "Codex chat";
	// Ordinary chats inherit the provider's user/project configuration. Review-specific
	// bypass preferences must not silently change an ordinary chat's permissions.
	const launchScriptContent = buildLaunchScript({
		cwd,
		cliPreset: input.provider,
		queueLaunchId,
		cliSessionId: providerSessionId,
		skipPermissions: false,
	});
	const result = await (deps.spawn ?? defaultSpawnFn)({
		workspaceId: input.workspaceId,
		cwd,
		title,
		openInRenderer: false,
		launchScriptContent,
		agent: {
			provider: input.provider,
			providerSessionId,
			skipPermissions: false,
			managed: false,
			initialPrompt: false,
			queueLaunchId,
		},
	});
	if (!result.launch) throw Error("Chat startup returned no terminal launch");
	return { workspaceId: input.workspaceId, terminalId: result.terminalId, ...result.launch };
}
