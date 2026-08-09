import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type HermesConnectionSummary, isHermesLoopbackUrl } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesConnections } from "../db/schema";
import { discoverHermesDashboardToken } from "./hermes-dashboard-token";
import {
	type HermesTokenVault,
	type ProtectedHermesToken,
	hermesTokenVault,
} from "./hermes-token-vault";

export { isHermesLoopbackUrl } from "../../shared/hermes";

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
		authMode: "token",
		connectionMode: isHermesLoopbackUrl(row.baseUrl) ? "loopback" : "remote",
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
	const loopback = isHermesLoopbackUrl(url.toString());
	if (!loopback && url.protocol !== "https:" && url.protocol !== "wss:") {
		throw new Error("Remote Hermes connections require HTTPS or WSS");
	}
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

export async function saveHermesConnectionWithDiscovery(
	input: SaveHermesConnectionInput,
	vault: HermesTokenVault = hermesTokenVault,
	discoverLoopbackToken: (baseUrl: string) => Promise<string> = discoverHermesDashboardToken
): Promise<HermesConnectionSummary> {
	const baseUrl = normalizeHermesBaseUrl(input.baseUrl);
	if (isHermesLoopbackUrl(baseUrl)) {
		const token = await discoverLoopbackToken(baseUrl);
		return saveHermesConnection({ ...input, baseUrl, token }, vault);
	}
	const existing = input.id ? getHermesConnectionWithToken(input.id, vault) : null;
	const canReuseExistingToken =
		existing?.connectionMode === "remote" &&
		existing.baseUrl === baseUrl &&
		existing.profileId === input.profileId.trim();
	if (!input.token && !canReuseExistingToken) {
		throw new Error("Remote Hermes connections require an explicit token");
	}
	return saveHermesConnection({ ...input, baseUrl }, vault);
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
