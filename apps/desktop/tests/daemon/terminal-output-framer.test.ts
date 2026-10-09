import { expect, test } from "bun:test";
import { TerminalOutputFramer } from "../../src/daemon/terminal-output-framer";

test("framing preserves bytes for every split of mixed Unicode and terminal controls", () => {
	const data = "hello🚀\x1b[31mred\x1b[0m\x1b]0;title\x07\x1bPpayload\x1b\\done\r\n";
	for (let split = 0; split <= data.length; split++) {
		const framer = new TerminalOutputFramer();
		expect(framer.push(data.slice(0, split)) + framer.push(data.slice(split))).toBe(data);
	}
});

test("an oversized unfinished control string is discarded through its terminator", () => {
	const framer = new TerminalOutputFramer(16);
	expect(framer.push(`before\x1b]0;${"x".repeat(20)}`)).toBe("before");
	expect(framer.push("more payload")).toBe("");
	expect(framer.push("\x07after\x1b[3")).toBe("after");
	expect(framer.push("1mred")).toBe("\x1b[31mred");
});
