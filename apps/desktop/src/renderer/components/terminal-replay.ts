import type { IDisposable, Terminal } from "@xterm/xterm";
import { decodeTerminalReplay } from "../../shared/terminal-replay";

let replaySequence = 0;

// Completion is exactly once, including parse/resize failure and view disposal.
// Callers must cancel before disposing xterm, which cancels its write callbacks.
export function writeTerminalReplay(
	term: Terminal,
	data: string,
	onComplete: (error?: Error) => void
): () => void {
	const snapshot = decodeTerminalReplay(data);
	const { cols, rows } = term;
	let resize: IDisposable | undefined;
	let finished = false;
	let failure: Error | undefined;
	const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)));
	const finish = (error?: Error, restoreSize = true) => {
		if (finished) return;
		finished = true;
		let completionError = error;
		resize?.dispose();
		try {
			if (snapshot && restoreSize) term.resize(cols, rows);
		} catch (cause) {
			completionError ??= asError(cause);
		}
		onComplete(completionError ?? failure);
	};
	try {
		if (!snapshot) term.write(data, () => finish());
		else {
			const marker = `superiorswarm-restore-${++replaySequence}`;
			// Reset and dimensions run inside the parser queue, after prior output.
			resize = term.parser.registerOscHandler(777, (value) => {
				if (value !== marker) return false;
				try {
					term.resize(snapshot.cols, snapshot.rows);
				} catch (error) {
					failure = asError(error);
				}
				return true;
			});
			term.write(`\x1bc\x1b]777;${marker}\x07${snapshot.data}`, () => finish());
		}
	} catch (error) {
		finish(asError(error));
	}
	return () => finish(new Error("Terminal view was closed during restoration"), false);
}
