import { safeStorage } from "electron";

interface SafeStorageAdapter {
	isEncryptionAvailable(): boolean;
	encryptString(value: string): Buffer;
	decryptString(value: Buffer): string;
}

export interface ProtectedHermesToken {
	storage: "safe-storage" | "memory";
	ciphertext: string | null;
}

export class HermesTokenVault {
	private readonly volatileTokens = new Map<string, string>();

	constructor(private readonly storage: SafeStorageAdapter = safeStorage) {}

	protect(connectionId: string, token: string): ProtectedHermesToken {
		if (this.storage.isEncryptionAvailable()) {
			this.volatileTokens.delete(connectionId);
			return {
				storage: "safe-storage",
				ciphertext: this.storage.encryptString(token).toString("base64"),
			};
		}
		this.volatileTokens.set(connectionId, token);
		return { storage: "memory", ciphertext: null };
	}

	reveal(connectionId: string, token: ProtectedHermesToken): string | null {
		if (token.storage === "memory") return this.volatileTokens.get(connectionId) ?? null;
		if (!token.ciphertext || !this.storage.isEncryptionAvailable()) return null;
		return this.storage.decryptString(Buffer.from(token.ciphertext, "base64"));
	}

	forget(connectionId: string): void {
		this.volatileTokens.delete(connectionId);
	}
}

export const hermesTokenVault = new HermesTokenVault();
