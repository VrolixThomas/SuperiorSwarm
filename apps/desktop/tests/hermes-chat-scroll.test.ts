import { describe, expect, test } from "bun:test";
import {
	isHermesChatNearBottom,
	shouldAnchorHermesChat,
} from "../src/renderer/hermes/hermes-chat-scroll";

describe("Hermes chat scrolling", () => {
	test("anchors an initially opened history to the latest message", () => {
		expect(shouldAnchorHermesChat({ initialHistory: true, following: false })).toBe(true);
	});

	test("follows streaming updates only while the user remains near the bottom", () => {
		expect(isHermesChatNearBottom({ scrollTop: 680, scrollHeight: 1_000, clientHeight: 300 })).toBe(
			true
		);
		expect(shouldAnchorHermesChat({ initialHistory: false, following: true })).toBe(true);
	});

	test("preserves a manual scroll-up during streaming", () => {
		expect(isHermesChatNearBottom({ scrollTop: 300, scrollHeight: 1_000, clientHeight: 300 })).toBe(
			false
		);
		expect(shouldAnchorHermesChat({ initialHistory: false, following: false })).toBe(false);
	});
});
