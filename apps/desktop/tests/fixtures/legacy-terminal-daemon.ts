import type { TerminalDataMeta } from "../../src/shared/daemon-protocol";

export type Data = (data: string, meta?: TerminalDataMeta) => void;
export class LegacyDaemon {
	supportsTerminalSnapshots = false;
	raw = "";
	onData: Data | undefined;
	onExit: ((code: number) => void) | undefined;
	attaches = 0;
	detaches = 0;
	disposals = 0;
	foreground = "codex";
	async create(
		_id: string,
		_cwd: string | undefined,
		onData: Data,
		onExit: (code: number) => void
	) {
		this.onData = onData;
		this.onExit = onExit;
	}
	async attach(_id: string, onData: Data, onExit: (code: number) => void) {
		this.attaches++;
		this.onData = onData;
		this.onExit = onExit;
		if (this.raw) onData(this.raw, { replay: true, fg: this.foreground });
	}
	emit(data: string) {
		this.raw = (this.raw + data).slice(-200_000);
		this.onData?.(data);
	}
	detach(_id: string) {
		this.detaches++;
		this.onData = undefined;
	}
	dispose(_id: string) {
		this.disposals++;
		this.onData = undefined;
	}
	resize(_id: string, _cols: number, _rows: number) {}
}
