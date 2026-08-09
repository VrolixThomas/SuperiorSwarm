import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import {
	type HermesChildProcess,
	HermesSendError,
	HermesSendService,
} from "../src/main/hermes/hermes-send-service";

class FakeChild extends EventEmitter implements HermesChildProcess {
	readonly stdout = new EventEmitter();
	readonly stderr = new EventEmitter();
	readonly stdin = {
		end: (value?: string | Uint8Array) => {
			this.stdinValue = typeof value === "string" ? value : Buffer.from(value ?? []).toString();
			this.onEnd?.();
		},
	};
	stdinValue = "";
	killed = false;
	onEnd: (() => void) | null = null;

	kill(): boolean {
		this.killed = true;
		return true;
	}
}

describe("HermesSendService", () => {
	test("uses executable argv plus stdin with the owning profile and Hermes home", async () => {
		const child = new FakeChild();
		let invocation:
			| {
					executable: string;
					argv: string[];
					options: Record<string, unknown>;
			  }
			| undefined;
		child.onEnd = () => {
			queueMicrotask(() => {
				child.stdout.emit(
					"data",
					Buffer.from(JSON.stringify({ success: true, message_id: "provider-message-1" }))
				);
				child.emit("close", 0, null);
			});
		};
		const service = new HermesSendService({
			executableResolver: () => "/opt/hermes/bin/hermes",
			hermesHomeResolver: (profileId) => `/profiles/${profileId}`,
			spawnProcess: (executable, argv, options) => {
				invocation = { executable, argv, options };
				return child;
			},
		});

		const result = await service.send({
			profileId: "work",
			target: { channelId: "C01234567", threadId: "1786269600.123456" },
			content: "Explicit confirmed update",
		});

		expect(invocation?.executable).toBe("/opt/hermes/bin/hermes");
		expect(invocation?.argv).toEqual([
			"-p",
			"work",
			"send",
			"--to",
			"slack:C01234567:1786269600.123456",
			"--json",
		]);
		expect(invocation?.options).toMatchObject({
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});
		expect((invocation?.options["env"] as NodeJS.ProcessEnv)["HERMES_HOME"]).toBe("/profiles/work");
		expect(child.stdinValue).toBe("Explicit confirmed update");
		expect(invocation?.argv).not.toContain("Explicit confirmed update");
		expect(result).toEqual({ providerMessageId: "provider-message-1" });
	});

	test("bounds timeout and output and returns sanitized classifications", async () => {
		const timeoutChild = new FakeChild();
		const timeoutService = new HermesSendService({
			executableResolver: () => "hermes",
			hermesHomeResolver: () => "/profiles/work",
			spawnProcess: () => timeoutChild,
			timeoutMs: 5,
		});
		await expect(
			timeoutService.send({
				profileId: "work",
				target: { channelId: "C01234567", threadId: "1786269600.123456" },
				content: "secret report content",
			})
		).rejects.toMatchObject({ code: "timeout", retryable: true });
		expect(timeoutChild.killed).toBe(true);

		const largeChild = new FakeChild();
		largeChild.onEnd = () => {
			queueMicrotask(() => largeChild.stdout.emit("data", Buffer.alloc(65, "x")));
		};
		const largeService = new HermesSendService({
			executableResolver: () => "hermes",
			hermesHomeResolver: () => "/profiles/work",
			spawnProcess: () => largeChild,
			maxOutputBytes: 64,
		});
		await expect(
			largeService.send({
				profileId: "work",
				target: { channelId: "C01234567", threadId: "1786269600.123456" },
				content: "report",
			})
		).rejects.toMatchObject({ code: "output-too-large", retryable: true });
		expect(largeChild.killed).toBe(true);
	});

	test("rejects invalid content, unavailable executable, and malformed provider JSON", async () => {
		const unavailable = new HermesSendService({ executableResolver: () => null });
		expect(unavailable.isAvailable()).toBe(false);
		await expect(
			unavailable.send({
				profileId: "work",
				target: { channelId: "C01234567", threadId: "1786269600.123456" },
				content: "report",
			})
		).rejects.toMatchObject({ code: "unavailable", retryable: false });

		const malformedChild = new FakeChild();
		malformedChild.onEnd = () => {
			queueMicrotask(() => {
				malformedChild.stdout.emit("data", Buffer.from("not-json token=provider-secret"));
				malformedChild.emit("close", 0, null);
			});
		};
		const malformed = new HermesSendService({
			executableResolver: () => "hermes",
			hermesHomeResolver: () => "/profiles/work",
			spawnProcess: () => malformedChild,
		});
		try {
			await malformed.send({
				profileId: "work",
				target: { channelId: "C01234567", threadId: "1786269600.123456" },
				content: "report",
			});
			expect.unreachable("malformed provider output should fail");
		} catch (error) {
			expect(error).toBeInstanceOf(HermesSendError);
			expect((error as HermesSendError).code).toBe("malformed-output");
			expect((error as Error).message).not.toContain("provider-secret");
		}

		await expect(
			malformed.send({
				profileId: "work",
				target: { channelId: "C01234567", threadId: "1786269600.123456" },
				content: "   ",
			})
		).rejects.toMatchObject({ code: "invalid-content", retryable: false });
		await expect(
			malformed.send({
				profileId: "../../wrong-profile",
				target: { channelId: "C01234567", threadId: "1786269600.123456" },
				content: "report",
			})
		).rejects.toMatchObject({ code: "invalid-target", retryable: false });
	});
});
