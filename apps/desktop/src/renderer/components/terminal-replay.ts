import type { Terminal } from "@xterm/xterm";
import { decodeTerminalReplay } from "../../shared/terminal-replay";

let replaySequence = 0;

export function writeTerminalReplay(term: Terminal, data: string, onComplete: () => void): void {
	const snapshot = decodeTerminalReplay(data);
	if (!snapshot) {
		term.write(data, onComplete);
		return;
	}
	const { cols, rows } = term;
	const marker = `superiorswarm-restore-${++replaySequence}`;
	// Apply the reset and dimensions inside xterm's parser queue. Resizing or
	// resetting immediately would corrupt previously queued output, or another
	// snapshot arriving before this one's write callback.
	const resize = term.parser.registerOscHandler(777, (value) => {
		if (value !== marker) return false;
		term.resize(snapshot.cols, snapshot.rows);
		return true;
	});
	term.write(`\x1bc\x1b]777;${marker}\x07${snapshot.data}`, () => {
		resize.dispose();
		term.resize(cols, rows);
		onComplete();
	});
}
