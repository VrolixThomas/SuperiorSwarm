import { createRoot } from "react-dom/client";
import { Terminal } from "../../../src/renderer/components/Terminal";
import { readTerminalDiagnostics } from "../../../src/renderer/components/terminal-diagnostics";
import "@xterm/xterm/css/xterm.css";
const element = document.getElementById("root");
if (!element) throw Error("Missing root");
const root = createRoot(element);
const tick = () =>
	new Promise<void>((resolve) =>
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
	);
const api = {
	async navigate(mounted: boolean, active = true) {
		root.render(
			mounted ? (
				<div style={{ visibility: active ? "visible" : "hidden" }}>
					<Terminal id="lifecycle" workspaceId="lifecycle-workspace" active={active} />
				</div>
			) : (
				<div>Another workspace</div>
			)
		);
		await tick();
	},
	diagnostics: () => readTerminalDiagnostics("lifecycle"),
};
(window as unknown as { lifecycle: typeof api }).lifecycle = api;
void api.navigate(true);
