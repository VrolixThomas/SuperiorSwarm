import "./preload-electron-mock";
import { describe, expect, test } from "bun:test";
import { HermesTokenVault } from "../src/main/hermes/hermes-token-vault";

describe("HermesTokenVault", () => {
	test("persists only safeStorage ciphertext when encryption is available", () => {
		const vault = new HermesTokenVault({
			isEncryptionAvailable: () => true,
			encryptString: (value) => Buffer.from(`encrypted:${value}`),
			decryptString: (value) => value.toString().replace(/^encrypted:/, ""),
		});
		const protectedToken = vault.protect("connection-1", "hermes-secret");

		expect(protectedToken.storage).toBe("safe-storage");
		expect(protectedToken.ciphertext).not.toContain("hermes-secret");
		expect(vault.reveal("connection-1", protectedToken)).toBe("hermes-secret");
	});

	test("keeps tokens memory-only when safeStorage is unavailable", () => {
		const vault = new HermesTokenVault({
			isEncryptionAvailable: () => false,
			encryptString: () => Buffer.alloc(0),
			decryptString: () => "",
		});
		const protectedToken = vault.protect("connection-1", "hermes-secret");

		expect(protectedToken).toEqual({ storage: "memory", ciphertext: null });
		expect(vault.reveal("connection-1", protectedToken)).toBe("hermes-secret");
		expect(JSON.stringify(protectedToken)).not.toContain("hermes-secret");
	});
});
