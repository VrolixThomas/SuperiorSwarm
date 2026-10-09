// An OSC envelope keeps stored snapshots valid terminal text for older readers.
// Only the replay path interprets it; application output cannot resize the UI.
const PREFIX = "\x1b]777;superiorswarm-replay;1;";
export const TERMINAL_SCROLLBACK_LINES = 10_000;
export const MAX_TERMINAL_REPLAY_CHARS = 8_000_000;
export const TERMINAL_SNAPSHOT_CAPABILITY = "terminal-snapshot-v1";

export function encodeTerminalReplay(data: string, cols: number, rows: number): string {
	return `${PREFIX}${cols};${rows}\x07${data}`;
}

export function decodeTerminalReplay(data: string) {
	if (!data.startsWith(PREFIX)) return null;
	const end = data.indexOf("\x07", PREFIX.length);
	if (end === -1 || end > PREFIX.length + 20) return null;
	const dimensions = data.slice(PREFIX.length, end);
	if (!/^\d+;\d+$/.test(dimensions)) return null;
	const [cols, rows] = dimensions.split(";").map(Number);
	if (!cols || !rows || cols < 2 || cols > 10_000 || rows > 10_000) return null;
	return { cols, rows, data: data.slice(end + 1) };
}
