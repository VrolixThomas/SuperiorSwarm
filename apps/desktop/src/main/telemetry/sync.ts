import { app } from "electron";
import log from "electron-log/main.js";
import { getDb } from "../db";
import { supabase } from "../supabase/client";
import { buildSnapshot } from "./snapshot";
import { getTelemetryState, markSynced } from "./state";

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

type SyncSkipReason = "no-state" | "opt-out" | "not-due" | "no-session" | "upsert-error";

type SyncResult = { ok: true } | { ok: false; reason: SyncSkipReason; detail?: string };

export async function syncIfDue(force = false): Promise<SyncResult> {
	const db = getDb();
	const state = getTelemetryState(db);
	if (!state) return { ok: false, reason: "no-state" };
	if (state.optOut) return { ok: false, reason: "opt-out" };

	if (!force && state.lastSyncedAt) {
		const age = Date.now() - state.lastSyncedAt.getTime();
		if (age < SYNC_INTERVAL_MS) return { ok: false, reason: "not-due" };
	}

	const { data: sessionData } = await supabase.auth.getSession();
	if (!sessionData.session) return { ok: false, reason: "no-session" };
	const user = sessionData.session.user;

	const snapshot = buildSnapshot(db, {
		userId: user.id,
		authProvider: user.app_metadata.provider ?? null,
		appVersion: app.getVersion(),
		osPlatform: process.platform,
		osArch: process.arch,
		locale: app.getLocale() || null,
	});

	const { error } = await supabase.from("usage_snapshots").upsert(snapshot);

	if (error) {
		log.debug("[telemetry] sync failed:", error.message);
		return { ok: false, reason: "upsert-error", detail: error.message };
	}

	markSynced(db);
	log.debug("[telemetry] snapshot synced");
	return { ok: true };
}
