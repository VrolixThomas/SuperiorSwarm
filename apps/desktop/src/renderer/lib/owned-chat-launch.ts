import type { OwnedChatLaunch } from "../../shared/owned-chat";
import { agentScriptInput } from "./agent-script-input";

export interface OwnedChatTerminalActions {
	activateWorkspace(workspaceId: string, cwd: string): void;
	addTerminal(workspaceId: string, cwd: string, title: string, terminalId: string): string;
	createTerminal(terminalId: string, cwd: string, workspaceId: string): Promise<unknown>;
	writeTerminal(terminalId: string, text: string): Promise<boolean>;
}

/** Run only from an explicit launch action; rendering or a retry never replays the script. */
export async function openOwnedChat(
	launch: OwnedChatLaunch,
	actions: OwnedChatTerminalActions
): Promise<void> {
	actions.activateWorkspace(launch.workspaceId, launch.cwd);
	const terminalId = actions.addTerminal(
		launch.workspaceId,
		launch.cwd,
		launch.title,
		launch.terminalId
	);
	if (terminalId !== launch.terminalId)
		throw Error("The requested chat terminal could not be opened");
	await actions.createTerminal(terminalId, launch.cwd, launch.workspaceId);
	const sent = await actions.writeTerminal(terminalId, agentScriptInput(launch.scriptPath));
	if (sent === false)
		throw Error("The terminal opened, but startup was not sent. Open it before trying again.");
}
