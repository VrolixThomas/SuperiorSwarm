import { openOwnedChat } from "../../../src/renderer/lib/owned-chat-launch";
import { useTabStore } from "../../../src/renderer/stores/tab-store";
const order: string[] = [];
let output = "";
Object.assign(window, {
	nativeLaunchProbe: {
		order,
		output: () => output,
		start: async (launch: Parameters<typeof openOwnedChat>[0]) => {
			window.electron.terminal.onData(launch.terminalId, (data) => {
				output = (output + data).slice(-50000);
				if (data.includes("\x1b[6n"))
					void window.electron.terminal.write(launch.terminalId, "\x1b[1;1R");
			});
			await openOwnedChat(launch, {
				activateWorkspace: (id, cwd) => useTabStore.getState().setActiveWorkspace(id, cwd),
				addTerminal: (id, cwd, title, terminalId) =>
					useTabStore.getState().addTerminalTab(id, cwd, title, terminalId),
				createTerminal: async (id, cwd, owner) => {
					order.push("create:start");
					const value = await window.electron.terminal.create(id, cwd, owner);
					order.push("create:complete");
					return value;
				},
				writeTerminal: async (id, text) => {
					order.push("write");
					return window.electron.terminal.write(id, text);
				},
			});
		},
	},
});
window.electron.agentConfirm.onRequest((request) =>
	window.electron.agentConfirm.reply(request.id, true)
);
document.body.innerHTML = "<main>Isolated external queue native launch verification</main>";
