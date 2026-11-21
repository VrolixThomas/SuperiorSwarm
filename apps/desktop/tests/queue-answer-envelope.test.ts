import { expect, test } from "bun:test";
import {
	answerContinuationFits,
	answerContinuationPrompt,
} from "../src/shared/queue-answer-continuation";
import { hasUnsafeTerminalText } from "../src/shared/terminal-files";

test("continuation embeds the exact saved answer losslessly without terminal command controls", () => {
	for (const content of [
		"Use blue",
		"/resume elsewhere",
		"!echo shell",
		"line\n\tindent",
		"\x1b[201~x\x1b[200~",
		'\u202e\u009bquoted"',
		"\ud800",
	]) {
		const prompt = answerContinuationPrompt({ questionId: "q", answerId: "a" }, content);
		const encoded = prompt.split("\n")[1];
		if (!encoded) throw Error("Missing encoded answer");
		expect(JSON.parse(encoded)).toBe(content);
		expect(prompt.startsWith("The saved answer")).toBe(true);
		expect(hasUnsafeTerminalText(prompt.replaceAll("\n", ""))).toBe(false);
	}
});
test("normal full-size saved answers fit while expansion beyond frame budget is explicit", () => {
	expect(
		answerContinuationFits(
			answerContinuationPrompt({ questionId: "q", answerId: "a" }, "a".repeat(16000))
		)
	).toBe(true);
	expect(
		answerContinuationFits(
			answerContinuationPrompt({ questionId: "q", answerId: "a" }, "\u202e".repeat(16000))
		)
	).toBe(false);
});
