import { createRoot } from "react-dom/client";
import { Terminal } from "../../../src/renderer/components/Terminal";
import "@xterm/xterm/css/xterm.css";

const element = document.getElementById("root");
if (!element) throw new Error("Fixture root missing");
createRoot(element).render(
	<Terminal id="fixture-terminal" workspaceId="fixture-workspace" active={true} />
);
