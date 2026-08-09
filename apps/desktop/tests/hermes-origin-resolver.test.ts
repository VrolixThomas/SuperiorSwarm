import { describe, expect, test } from "bun:test";
import {
	resolveHermesOrigin,
	validateManualSlackThreadUrl,
} from "../src/main/hermes/hermes-origin-resolver";
import { stockSessionDetail } from "./fixtures/hermes-stock";

describe("Hermes Slack origin resolver", () => {
	test("projects a valid stock Slack detail without exposing routing metadata", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: stockSessionDetail.id,
				profileId: stockSessionDetail.profile,
				source: stockSessionDetail.source,
				displayName: stockSessionDetail.display_name,
				sessionKey: stockSessionDetail.session_key,
				chatId: stockSessionDetail.chat_id,
				chatType: "channel",
				threadId: stockSessionDetail.thread_id,
				originJson: stockSessionDetail.origin_json,
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection).toEqual({
			platform: "slack",
			displayLabel: "#release · thread",
			hasThread: true,
			canOpenThread: true,
			canReport: true,
			openUrl: "https://app.slack.com/client/T01234567/C01234567/thread-C01234567-1786269600123456",
		});
		expect(resolved.target).toEqual({
			channelId: "C01234567",
			threadId: "1786269600.123456",
		});
		const rendererJson = JSON.stringify(resolved.projection);
		expect(rendererJson).not.toContain("U01234567");
		expect(rendererJson).not.toContain("origin_json");
		expect(rendererJson).not.toContain("agent:work:slack");
	});

	test("uses a supported stock session-key shape only as a compatibility fallback", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "slack",
				displayName: null,
				sessionKey: "agent:work:slack:channel:T01234567:C01234567:1786269600.123456",
				chatId: null,
				chatType: null,
				threadId: null,
				originJson: null,
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection.hasThread).toBe(true);
		expect(resolved.target?.channelId).toBe("C01234567");
	});

	test("rejects malformed/control-character routes and never promotes non-Slack rows", () => {
		const malformed = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "slack",
				displayName: "Slack\nspoof",
				sessionKey: null,
				chatId: "C012\nBAD",
				chatType: "channel",
				threadId: "not-a-timestamp",
				originJson: JSON.stringify({ team_id: "T012\u0000BAD" }),
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);
		expect(malformed.projection).toMatchObject({
			displayLabel: "Slack",
			hasThread: false,
			canOpenThread: false,
			canReport: false,
			openUrl: null,
		});
		expect(malformed.target).toBeNull();

		const local = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "desktop",
				displayName: "pretend Slack",
				sessionKey: "agent:work:slack:channel:T01234567:C01234567:1786269600.123456",
				chatId: "C01234567",
				chatType: "channel",
				threadId: "1786269600.123456",
				originJson: { platform: "slack", team_id: "T01234567" },
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);
		expect(local.projection.platform).toBe("desktop");
		expect(local.target).toBeNull();

		const malformedSource = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "desktop\nspoof",
				displayName: null,
				sessionKey: null,
				chatId: null,
				chatType: null,
				threadId: null,
				originJson: null,
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);
		expect(malformedSource.projection.platform).toBe("unknown");
	});

	test("degrades remote, threadless, and unavailable-sender origins without blocking projection", () => {
		const remote = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "slack",
				displayName: "#release",
				sessionKey: null,
				chatId: "C01234567",
				chatType: "channel",
				threadId: null,
				originJson: { team_id: "T01234567" },
			},
			{ connectionMode: "remote", senderAvailable: false }
		);
		expect(remote.projection).toMatchObject({
			platform: "slack",
			hasThread: false,
			canOpenThread: false,
			canReport: false,
		});
	});

	test("accepts only trusted HTTPS Slack thread URLs for manual navigation", () => {
		expect(
			validateManualSlackThreadUrl("https://acme.slack.com/archives/C01234567/p1786269600123456")
		).toBe("https://acme.slack.com/archives/C01234567/p1786269600123456");
		expect(validateManualSlackThreadUrl("http://acme.slack.com/archives/C1/p1")).toBeNull();
		expect(validateManualSlackThreadUrl("https://slack.example.com/archives/C1/p1")).toBeNull();
		expect(validateManualSlackThreadUrl("https://user:pass@app.slack.com/client/T/C")).toBeNull();
	});
});
