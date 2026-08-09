import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { type HermesConnectionSummary, isHermesLoopbackUrl } from "../../shared/hermes";
import { getDb } from "../db";
import { hermesConnections } from "../db/schema";
import { HERMES_PROFILE_ID_PATTERN, normalizeManagedHermesProfileId } from "./hermes-cli";
import { discoverHermesDashboardToken } from "./hermes-dashboard-token";
import {
	type HermesTokenVault,
	type ProtectedHermesToken,
	hermesTokenVault,
} from "./hermes-token-vault";

export { isHermesLoopbackUrl } from "../../shared/hermes";

export const HERMES_LOCAL_MANAGED_URL = "hermes-local://managed";
const HERMES_LOCAL_MANAGED_ID = "hermes-local-managed";

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
	const managed = row.managementMode === "managed";
	const protectedToken = { storage: row.tokenStorage, ciphertext: row.encryptedToken };
	return {
		id: row.id,
		label: row.label,
		baseUrl: managed ? null : row.baseUrl,
		profileId: row.profileId,
		authMode: "token",
		connectionMode: managed || isHermesLoopbackUrl(row.baseUrl) ? "loopback" : "remote",
		managementMode: row.managementMode,
		hasToken: managed
			? false
			: row.tokenStorage === "safe-storage"
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

export function ensureHermesLocalConnection(
	input: { id?: string; label?: string; profileId?: string } = {},
	vault: HermesTokenVault = hermesTokenVault
): HermesConnectionSummary {
	const db = getDb();
	const requested = input.id
		? db.select().from(hermesConnections).where(eq(hermesConnections.id, input.id)).get()
		: null;
	if (requested && requested.managementMode !== "managed") {
		throw new Error("The selected Hermes connection is not managed locally");
	}
	const existing =
		requested ??
		db
			.select()
			.from(hermesConnections)
			.all()
			.find((connection) => connection.managementMode === "managed");
	const requestedProfileId = input.profileId?.trim() || existing?.profileId || "default";
	if (!HERMES_PROFILE_ID_PATTERN.test(requestedProfileId)) {
		throw new Error("Hermes profile is invalid");
	}
	const profileId = normalizeManagedHermesProfileId(requestedProfileId);
	const fixedIdCollision = existing
		? null
		: db
				.select()
				.from(hermesConnections)
				.where(eq(hermesConnections.id, HERMES_LOCAL_MANAGED_ID))
				.get();
	const id =
		existing?.id ?? (fixedIdCollision ? `hermes-local-${nanoid(10)}` : HERMES_LOCAL_MANAGED_ID);
	const now = new Date();
	const values = {
		id,
		label: input.label?.trim() || existing?.label || "Local Hermes",
		baseUrl: existing?.baseUrl ?? HERMES_LOCAL_MANAGED_URL,
		profileId,
		managementMode: "managed" as const,
		encryptedToken: existing?.encryptedToken ?? null,
		tokenStorage: existing?.tokenStorage ?? ("memory" as const),
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
				profileId,
				managementMode: values.managementMode,
				encryptedToken: values.encryptedToken,
				tokenStorage: values.tokenStorage,
				updatedAt: now,
			},
		})
		.run();
	if (!existing || existing.baseUrl === HERMES_LOCAL_MANAGED_URL) vault.forget(id);
	const saved = db.select().from(hermesConnections).where(eq(hermesConnections.id, id)).get();
	if (!saved) throw new Error("Local Hermes configuration could not be saved");
	return toSummary(saved, vault);
}

export function saveHermesConnection(
	input: SaveHermesConnectionInput,
	vault: HermesTokenVault = hermesTokenVault
): HermesConnectionSummary {
	const db = getDb();
	const id = input.id ?? `hermes-${nanoid(10)}`;
	const existing = db.select().from(hermesConnections).where(eq(hermesConnections.id, id)).get();
	if (existing?.managementMode === "managed") {
		throw new Error("Managed Local Hermes cannot be replaced by an external connection");
	}
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
		managementMode: "external" as const,
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
				managementMode: values.managementMode,
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
		existing?.managementMode === "external" &&
		existing.connectionMode === "remote" &&
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
	if (!row || row.managementMode === "managed") return null;
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
	const row = getDb().select().from(hermesConnections).where(eq(hermesConnections.id, id)).get();
	if (row?.managementMode === "managed") {
		throw new Error("Managed Local Hermes cannot be deleted");
	}
	getDb().delete(hermesConnections).where(eq(hermesConnections.id, id)).run();
	vault.forget(id);
}
