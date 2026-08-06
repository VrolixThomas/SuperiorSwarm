import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { HermesConnectionSummary } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesConnections } from "../db/schema";
import {
	type HermesTokenVault,
	type ProtectedHermesToken,
	hermesTokenVault,
} from "./hermes-token-vault";

export interface SaveHermesConnectionInput {
	id?: string;
	label: string;
	baseUrl: string;
	profileId: string;
	token?: string;
}

function timestamp(value: Date | null): number | null {
	return value?.getTime() ?? null;
}

function toSummary(
	row: typeof hermesConnections.$inferSelect,
	vault: HermesTokenVault = hermesTokenVault
): HermesConnectionSummary {
	const protectedToken = { storage: row.tokenStorage, ciphertext: row.encryptedToken };
	return {
		id: row.id,
		label: row.label,
		baseUrl: row.baseUrl,
		profileId: row.profileId,
		hasToken:
			row.tokenStorage === "safe-storage"
				? row.encryptedToken !== null
				: vault.reveal(row.id, protectedToken) !== null,
		tokenStorage: row.tokenStorage,
		lastConnectedAt: timestamp(row.lastConnectedAt),
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime(),
	};
}

export function normalizeHermesBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new Error("Enter a valid Hermes URL");
	}
	if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
		throw new Error("Hermes URL must use http, https, ws, or wss");
	}
	if (url.username || url.password) throw new Error("Hermes URL must not contain credentials");
	const hostname = url.hostname.toLowerCase();
	const loopback =
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname === "[::1]" ||
		/^127(?:\.\d{1,3}){3}$/.test(hostname);
	if (!loopback) throw new Error("Hermes connections currently require a loopback URL");
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

export function listHermesConnections(
	vault: HermesTokenVault = hermesTokenVault
): HermesConnectionSummary[] {
	return getDb()
		.select()
		.from(hermesConnections)
		.all()
		.map((row) => toSummary(row, vault));
}

export function saveHermesConnection(
	input: SaveHermesConnectionInput,
	vault: HermesTokenVault = hermesTokenVault
): HermesConnectionSummary {
	const db = getDb();
	const id = input.id ?? `hermes-${nanoid(10)}`;
	const existing = db.select().from(hermesConnections).where(eq(hermesConnections.id, id)).get();
	const now = new Date();
	let protectedToken: ProtectedHermesToken = existing
		? { storage: existing.tokenStorage, ciphertext: existing.encryptedToken }
		: { storage: "memory", ciphertext: null };
	if (input.token !== undefined) protectedToken = vault.protect(id, input.token);

	const values = {
		id,
		label: input.label.trim(),
		baseUrl: normalizeHermesBaseUrl(input.baseUrl),
		profileId: input.profileId.trim() || "default",
		encryptedToken: protectedToken.ciphertext,
		tokenStorage: protectedToken.storage,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	db.insert(hermesConnections)
		.values(values)
		.onConflictDoUpdate({
			target: hermesConnections.id,
			set: {
				label: values.label,
				baseUrl: values.baseUrl,
				profileId: values.profileId,
				encryptedToken: values.encryptedToken,
				tokenStorage: values.tokenStorage,
				updatedAt: now,
			},
		})
		.run();
	const saved = db.select().from(hermesConnections).where(eq(hermesConnections.id, id)).get();
	if (!saved) throw new Error("Hermes connection could not be saved");
	const summary = toSummary(saved, vault);
	if (protectedToken.storage === "memory" && vault.reveal(id, protectedToken)) {
		return { ...summary, hasToken: true };
	}
	return summary;
}

export function getHermesConnectionWithToken(
	id: string,
	vault: HermesTokenVault = hermesTokenVault
): (HermesConnectionSummary & { token: string }) | null {
	const row = getDb().select().from(hermesConnections).where(eq(hermesConnections.id, id)).get();
	if (!row) return null;
	const token = vault.reveal(id, {
		storage: row.tokenStorage,
		ciphertext: row.encryptedToken,
	});
	if (!token) return null;
	return { ...toSummary(row, vault), hasToken: true, token };
}

export function markHermesConnectionConnected(id: string): void {
	const now = new Date();
	getDb()
		.update(hermesConnections)
		.set({ lastConnectedAt: now, updatedAt: now })
		.where(eq(hermesConnections.id, id))
		.run();
}

export function deleteHermesConnection(
	id: string,
	vault: HermesTokenVault = hermesTokenVault
): void {
	getDb().delete(hermesConnections).where(eq(hermesConnections.id, id)).run();
	vault.forget(id);
}
