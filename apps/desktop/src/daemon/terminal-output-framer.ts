// Keep incomplete control sequences and surrogate pairs out of both the
// published stream and snapshots. Otherwise an attach between "ESC[" and
// "31m" would restore a parser in the wrong state and print the continuation.
export class TerminalOutputFramer {
	private state: "text" | "escape" | "csi" | "osc" | "string" = "text";
	private pending: string[] = [];
	private pendingLength = 0;
	private discarding = false;

	// Match xterm's OSC/DCS payload bound. A malformed unterminated string
	// must not retain an unlimited amount of output in the daemon.
	constructor(private maxPending = 10_000_000) {}

	push(data: string): string {
		let complete = 0;
		let start = 0;
		for (let i = 0; i < data.length; i++) {
			const c = data.charCodeAt(i);
			if (c === 0x18 || c === 0x1a) this.state = "text";
			else if (c === 0x1b) this.state = "escape";
			else if (c === 0x9c) this.state = "text";
			else if (this.state === "escape") {
				if (c === 0x5b) this.state = "csi";
				else if (c === 0x5d) this.state = "osc";
				else if ([0x50, 0x58, 0x5e, 0x5f].includes(c)) this.state = "string";
				else if (c >= 0x30 && c <= 0x7e) this.state = "text";
			} else if (this.state === "csi") {
				if (c >= 0x40 && c <= 0x7e) this.state = "text";
			} else if (this.state === "osc") {
				if (c === 0x07) this.state = "text";
			} else if (this.state === "text") {
				if (c === 0x9b) this.state = "csi";
				else if (c === 0x9d) this.state = "osc";
				else if ([0x90, 0x98, 0x9e, 0x9f].includes(c)) this.state = "string";
			}
			if (this.state === "text" && !(i === data.length - 1 && c >= 0xd800 && c <= 0xdbff)) {
				if (this.discarding) {
					this.discarding = false;
					start = i + 1;
				}
				complete = i + 1;
			}
		}
		if (this.discarding) return "";
		let output = "";
		if (complete > 0) {
			output = this.pending.join("") + data.slice(start, complete);
			this.pending = [];
			this.pendingLength = 0;
		}
		if (complete < data.length) {
			this.pending.push(data.slice(complete));
			this.pendingLength += data.length - complete;
			if (this.pendingLength > this.maxPending) {
				this.pending = [];
				this.pendingLength = 0;
				this.discarding = true;
			}
		}
		return output;
	}
}
