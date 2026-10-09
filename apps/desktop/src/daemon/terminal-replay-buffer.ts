import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import headless from "@xterm/headless";
import type { Terminal } from "@xterm/headless";
import {
	MAX_TERMINAL_REPLAY_CHARS,
	TERMINAL_SCROLLBACK_LINES,
	encodeTerminalReplay,
} from "../shared/terminal-replay";
import { TerminalOutputFramer } from "./terminal-output-framer";

// Output is published only after parsing. A synchronous snapshot therefore
// precedes all output delivered to a newly attached client, without a race
// between taking the snapshot and subscribing to the live stream.
export class TerminalReplayBuffer {
	// The published package is CommonJS. Node's ESM loader cannot infer its
	// named Terminal export when electron-vite leaves this dependency external.
	private terminal = new headless.Terminal({
		allowProposedApi: true,
		cols: 80,
		rows: 24,
		scrollback: TERMINAL_SCROLLBACK_LINES,
	});
	private serializer = new SerializeAddon();
	private hasOutput = false;
	private mouseEncoding = "";
	private cursorVisible = true;
	private framer = new TerminalOutputFramer();
	private disposed = false;
	private regions: Record<"normal" | "alternate", string> = { normal: "", alternate: "" };

	constructor() {
		// These addons support headless terminals at runtime; their declarations
		// name the browser Terminal, which has additional DOM-only members.
		type Addon = Parameters<Terminal["loadAddon"]>[0];
		this.terminal.loadAddon(this.serializer as unknown as Addon);
		this.terminal.loadAddon(new Unicode11Addon() as unknown as Addon);
		this.terminal.unicode.activeVersion = "11";
		this.terminal.parser.registerCsiHandler({ final: "r" }, (params) => {
			const top = typeof params[0] === "number" ? params[0] || 1 : 1;
			const bottom =
				typeof params[1] === "number" && params[1] > 0
					? Math.min(params[1], this.terminal.rows)
					: this.terminal.rows;
			if (bottom > top) {
				this.regions[this.terminal.buffer.active.type] = `\x1b[${top};${bottom}r`;
			}
			return false;
		});
		this.terminal.parser.registerCsiHandler({ intermediates: "!", final: "p" }, () => {
			this.regions[this.terminal.buffer.active.type] = "";
			this.cursorVisible = true;
			return false;
		});
		for (const final of ["h", "l"]) {
			this.terminal.parser.registerCsiHandler({ prefix: "?", final }, (params) => {
				for (const mode of params) {
					if (mode === 1006 || mode === 1016) {
						this.mouseEncoding = final === "h" ? `\x1b[?${mode}h` : "";
					}
					if (mode === 25) this.cursorVisible = final === "h";
				}
				return false;
			});
		}
		this.terminal.parser.registerEscHandler({ final: "c" }, () => {
			this.mouseEncoding = "";
			this.cursorVisible = true;
			this.regions = { normal: "", alternate: "" };
			return false;
		});
		// Never connect headless onData/onBinary to the PTY: only the renderer
		// answers device queries. Replaying these answers would corrupt input.
	}

	write(data: string, onParsed: (output: string) => void): void {
		const output = this.framer.push(data);
		this.terminal.write(output, () => {
			this.hasOutput ||= output.length > 0;
			onParsed(output);
		});
	}

	resize(cols: number, rows: number): void {
		this.terminal.write("", () => {
			if (!this.disposed && (cols !== this.terminal.cols || rows !== this.terminal.rows)) {
				this.terminal.resize(cols, rows);
				this.regions = { normal: "", alternate: "" };
			}
		});
	}

	afterWrites(callback: () => void): void {
		this.terminal.write("", callback);
	}

	snapshot(): string {
		if (!this.hasOutput) return "";
		let scrollback = TERMINAL_SCROLLBACK_LINES;
		let data = this.serializer.serialize({ scrollback });
		// Bound pathological styled histories by dropping whole oldest rows,
		// never by cutting escape sequences or discarding all history on redraw.
		while (data.length > MAX_TERMINAL_REPLAY_CHARS && scrollback > 0) {
			scrollback = Math.floor(scrollback / 2);
			data = this.serializer.serialize({ scrollback });
		}
		const restoreRegion = (region: string) => (region ? `\x1b7${region}\x1b8` : "");
		if (this.terminal.buffer.active.type === "alternate") {
			const alternate = data.indexOf("\x1b[?1049h");
			if (alternate !== -1) {
				data =
					data.slice(0, alternate) + restoreRegion(this.regions.normal) + data.slice(alternate);
			}
		}
		return encodeTerminalReplay(
			data +
				restoreRegion(this.regions[this.terminal.buffer.active.type]) +
				this.mouseEncoding +
				(this.cursorVisible ? "\x1b[?25h" : "\x1b[?25l"),
			this.terminal.cols,
			this.terminal.rows
		);
	}

	dispose(): void {
		this.disposed = true;
		this.terminal.dispose();
	}
}
