import { Terminal } from "@xterm/xterm";
import { installTerminalWheelHandler } from "../../src/renderer/components/terminal-wheel";

let term: Terminal | undefined;
let cleanup: (() => void) | undefined;
const host = document.createElement("div");
host.style.cssText = "position:absolute;top:0;left:0;width:1000px;height:500px";
document.body.append(host);
const tick = () =>
	new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
let start = 0;
let text: string[] = [];
let events: unknown[] = [];
host.addEventListener(
	"wheel",
	(event) => {
		const legacy = event as WheelEvent & { wheelDeltaY: number };
		events.push({
			dy: event.deltaY,
			dx: event.deltaX,
			mode: event.deltaMode,
			legacy: legacy.wheelDeltaY,
			trusted: event.isTrusted,
		});
	},
	{ capture: true }
);

const api = {
	async setup(
		adapter: boolean,
		mode: "normal" | "alternate" | "sgr" | "sgr-pixels",
		sensitivity: number
	) {
		cleanup?.();
		term?.dispose();
		host.replaceChildren();
		term = new Terminal({
			allowProposedApi: true,
			cols: 80,
			rows: 24,
			fontSize: 13,
			lineHeight: 1.2,
			scrollback: 1000,
			scrollSensitivity: sensitivity,
			smoothScrollDuration: 0,
		});
		term.open(host);
		cleanup = adapter ? installTerminalWheelHandler(host, term, () => true) : undefined;
		await new Promise<void>((r) => term?.write("history\r\n".repeat(400), r));
		if (mode !== "normal") await new Promise<void>((r) => term?.write("\x1b[?1049h", r));
		if (mode === "sgr" || mode === "sgr-pixels")
			await new Promise<void>((r) => term?.write("\x1b[?1003h\x1b[?1006h", r));
		if (mode === "sgr-pixels") await new Promise<void>((r) => term?.write("\x1b[?1016h", r));
		if (mode === "normal") term.scrollToLine(200);
		await tick();
		text = [];
		events = [];
		term.onData((s) => text.push(s));
		start = term.buffer.active.viewportY;
		const rect = host.querySelector(".xterm-screen")?.getBoundingClientRect();
		if (!rect) throw Error("Missing terminal screen");
		return {
			x: rect.left + rect.width / 2,
			y: rect.top + rect.height / 2,
			cellHeight: rect.height / term.rows,
		};
	},
	async result() {
		await tick();
		return { movement: (term?.buffer.active.viewportY ?? start) - start, text, events };
	},
};
(window as unknown as { nativeWheel: typeof api }).nativeWheel = api;
