import type { Terminal } from "@xterm/xterm";

export function installTerminalInput(
	term: Pick<Terminal, "onData" | "onBinary">,
	isSuppressed: () => boolean,
	onText: (data: string) => void,
	onBinary: (data: string) => void
): () => void {
	const text = term.onData((data) => {
		if (!isSuppressed()) onText(data);
	});
	const binary = term.onBinary((data) => {
		if (!isSuppressed()) onBinary(data);
	});
	return () => {
		text.dispose();
		binary.dispose();
	};
}
