import { describe, expect, test } from "bun:test";
import {
	resolveHermesOrigin,
	validateManualSlackThreadUrl,
} from "../src/main/hermes/hermes-origin-resolver";
import { stockSessionDetail, stockTelegramSessionDetail } from "./fixtures/hermes-stock";

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
			source: "slack",
			displayLabel: "#release · thread",
			workspaceLabel: null,
			accountLabel: "Maya",
			chatLabel: null,
			channelLabel: "#release",
			threadLabel: null,
			hasThread: true,
			canOpenThread: true,
			canReport: true,
		});
		expect(resolved.openUrl).toBe(
			"https://app.slack.com/client/T01234567/C01234567/thread-C01234567-1786269600123456"
		);
		expect(resolved.target).toEqual({
			channelId: "C01234567",
			threadId: "1786269600.123456",
		});
		const rendererJson = JSON.stringify(resolved.projection);
		expect(rendererJson).not.toContain("U01234567");
		expect(rendererJson).not.toContain("origin_json");
		expect(rendererJson).not.toContain("agent:work:slack");
		expect(rendererJson).not.toContain("app.slack.com");
	});

	test("projects producer-shaped Telegram origin names without exposing routes or Slack controls", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: stockTelegramSessionDetail.id,
				profileId: stockTelegramSessionDetail.profile,
				source: stockTelegramSessionDetail.source,
				displayName: stockTelegramSessionDetail.display_name,
				sessionKey: stockTelegramSessionDetail.session_key,
				chatId: stockTelegramSessionDetail.chat_id,
				chatType: stockTelegramSessionDetail.chat_type,
				threadId: stockTelegramSessionDetail.thread_id,
				originJson: stockTelegramSessionDetail.origin_json,
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection).toEqual({
			platform: "telegram",
			source: "telegram",
			displayLabel: "Ops room",
			workspaceLabel: null,
			accountLabel: "Alex",
			chatLabel: "Ops room",
			channelLabel: null,
			threadLabel: "Release incident",
			hasThread: true,
			canOpenThread: false,
			canReport: false,
		});
		expect(resolved.target).toBeNull();
		expect(resolved.openUrl).toBeNull();
		const rendererJson = JSON.stringify(resolved.projection);
		expect(rendererJson).not.toContain("-1001234567890");
		expect(rendererJson).not.toContain("99887766");
		expect(rendererJson).not.toContain('"77"');
	});

	test("sanitizes token-like and bearer-like labels in selected Telegram details", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: stockTelegramSessionDetail.id,
				profileId: stockTelegramSessionDetail.profile,
				source: stockTelegramSessionDetail.source,
				displayName: "token=display-secret",
				sessionKey: stockTelegramSessionDetail.session_key,
				chatId: stockTelegramSessionDetail.chat_id,
				chatType: stockTelegramSessionDetail.chat_type,
				threadId: stockTelegramSessionDetail.thread_id,
				originJson: JSON.stringify({
					platform: "telegram",
					chat_id: stockTelegramSessionDetail.chat_id,
					chat_name: "Authorization: Bearer chat-secret",
					chat_type: "group",
					user_id: "99887766",
					user_name: "Bearer account-secret",
					thread_id: stockTelegramSessionDetail.thread_id,
					chat_topic: "api_key=topic-secret",
					scope_name: "cookie=workspace-secret",
				}),
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection).toMatchObject({
			displayLabel: "token=[redacted]",
			workspaceLabel: "cookie=[redacted]",
			accountLabel: "[redacted]",
			chatLabel: "Authorization: [redacted]",
			threadLabel: "api_key=[redacted]",
		});
		const rendererJson = JSON.stringify(resolved.projection);
		for (const secret of [
			"display-secret",
			"workspace-secret",
			"account-secret",
			"chat-secret",
			"topic-secret",
		]) {
			expect(rendererJson).not.toContain(secret);
		}
	});

	test("suppresses selected Telegram labels equal to stock routing identifiers", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: stockTelegramSessionDetail.id,
				profileId: stockTelegramSessionDetail.profile,
				source: stockTelegramSessionDetail.source,
				displayName: stockTelegramSessionDetail.chat_id,
				sessionKey: stockTelegramSessionDetail.session_key,
				chatId: stockTelegramSessionDetail.chat_id,
				chatType: stockTelegramSessionDetail.chat_type,
				threadId: stockTelegramSessionDetail.thread_id,
				originJson: JSON.stringify({
					platform: "telegram",
					chat_id: stockTelegramSessionDetail.chat_id,
					chat_name: stockTelegramSessionDetail.chat_id,
					chat_type: "group",
					user_id: "99887766",
					user_name: "99887766",
					thread_id: stockTelegramSessionDetail.thread_id,
					chat_topic: stockTelegramSessionDetail.thread_id,
					scope_id: "telegram-scope-route",
					scope_name: "telegram-scope-route",
				}),
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection).toMatchObject({
			displayLabel: "telegram",
			workspaceLabel: null,
			accountLabel: null,
			chatLabel: null,
			threadLabel: null,
		});
		const rendererJson = JSON.stringify(resolved.projection);
		for (const route of ["-1001234567890", "99887766", '"77"', "telegram-scope-route"]) {
			expect(rendererJson).not.toContain(route);
		}
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
		});
		expect(malformed.openUrl).toBeNull();
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

	test("rejects conflicting valid Slack route fields instead of choosing by precedence", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "slack",
				displayName: "#release",
				sessionKey: "agent:work:slack:channel:T01234567:C01234567:1786269600.123456",
				chatId: "C99999999",
				chatType: "channel",
				threadId: "1786269600.999999",
				originJson: {
					platform: "slack",
					scope_id: "T01234567",
					chat_id: "C01234567",
					thread_id: "1786269600.123456",
				},
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection).toMatchObject({
			platform: "slack",
			hasThread: false,
			canOpenThread: false,
			canReport: false,
		});
		expect(resolved.openUrl).toBeNull();
		expect(resolved.target).toBeNull();
	});

	test("rejects conflicts among stock Slack team aliases themselves", () => {
		const resolved = resolveHermesOrigin(
			{
				durableSessionId: "stored",
				profileId: "work",
				source: "slack",
				displayName: "#release",
				sessionKey: "agent:work:slack:channel:T01234567:C01234567:1786269600.123456",
				chatId: "C01234567",
				chatType: "channel",
				threadId: "1786269600.123456",
				originJson: {
					platform: "slack",
					scope_id: "T01234567",
					team_id: "T99999999",
					guild_id: "T88888888",
					chat_id: "C01234567",
					thread_id: "1786269600.123456",
				},
			},
			{ connectionMode: "loopback", senderAvailable: true }
		);

		expect(resolved.projection).toMatchObject({
			hasThread: true,
			canOpenThread: false,
			canReport: false,
		});
		expect(resolved.openUrl).toBeNull();
		expect(resolved.target).toBeNull();
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
