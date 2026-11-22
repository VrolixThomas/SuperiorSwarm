import { openOwnedChat } from "../../lib/owned-chat-launch";
import { usePaneStore } from "../../stores/pane-store";
import { useTabStore } from "../../stores/tab-store";
import { trpc } from "../../trpc/client";
import { NewChatMenu } from "./NewChatMenu";

export function NewOwnedChat({ workspaceId, paneId }: { workspaceId: string; paneId: string }) {
	const start = trpc.agentLaunch.startChat.useMutation();
	return (
		<NewChatMenu
			startChat={async (provider) => {
				const launch = await start.mutateAsync({ workspaceId, provider });
				await openOwnedChat(launch, {
					activateWorkspace: (id, cwd) => {
						useTabStore.getState().setActiveWorkspace(id, cwd);
						usePaneStore.getState().setFocusedPane(paneId);
					},
					addTerminal: (id, cwd, title, terminalId) =>
						useTabStore.getState().addTerminalTab(id, cwd, title, terminalId),
					createTerminal: (id, cwd, owner) => window.electron.terminal.create(id, cwd, owner),
					writeTerminal: (id, text) => window.electron.terminal.write(id, text),
				});
			}}
		/>
	);
}
