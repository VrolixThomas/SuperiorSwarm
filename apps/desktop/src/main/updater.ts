import { eq } from "drizzle-orm";
import { app, autoUpdater as nativeUpdater } from "electron";
import { autoUpdater } from "electron-updater";
import * as semver from "semver";
import { type UpdateNotification, initialUpdateLifecycle } from "../shared/updater";
import { getDb } from "./db";
import { sessionState } from "./db/schema";
import { GITHUB_API_BASE } from "./github/constants";
import { log } from "./logger";
import { createUpdaterLifecycle } from "./updater-lifecycle";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
let lifecycle: ReturnType<typeof createUpdaterLifecycle> | null = null;
let initialization: Promise<void> | null = null;
let generation = 0;

let updateCheckTimer: ReturnType<typeof setInterval> | null = null;

// --- Pure utility functions (exported for testing) ---

export type VersionDiffType = "major" | "minor" | "patch";

export function getVersionDiffType(oldVersion: string, newVersion: string): VersionDiffType | null {
	if (!semver.valid(oldVersion) || !semver.valid(newVersion)) return null;
	const diff = semver.diff(oldVersion, newVersion);
	if (diff === "major" || diff === "premajor") return "major";
	if (diff === "minor" || diff === "preminor") return "minor";
	if (diff === "patch" || diff === "prepatch" || diff === "prerelease") return "patch";
	return null;
}

export function extractReleaseSummary(body: string | null | undefined): string | null {
	if (!body) return null;
	const lines = body.split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("#")) continue;
		if (trimmed.startsWith("---")) continue;
		if (trimmed.length > 117) return `${trimmed.slice(0, 117)}...`;
		return trimmed;
	}
	return null;
}

// --- GitHub release notes fetching ---

const GITHUB_OWNER = "VrolixThomas";
const GITHUB_REPO = "SuperiorSwarm";

const releaseNotesCache = new Map<string, { body: string; publishedAt: string }>();

export async function fetchReleaseNotes(
	version: string
): Promise<{ body: string; publishedAt: string } | null> {
	const cached = releaseNotesCache.get(version);
	if (cached) return cached;

	const tags = [`v${version}`, version];
	for (const tag of tags) {
		try {
			const res = await fetch(
				`${GITHUB_API_BASE}/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`,
				{
					headers: { Accept: "application/vnd.github.v3+json" },
				}
			);
			if (res.ok) {
				const data = (await res.json()) as { body?: string; published_at?: string };
				const result = {
					body: data.body ?? "",
					publishedAt: data.published_at ?? "",
				};
				releaseNotesCache.set(version, result);
				return result;
			}
		} catch {
			// Network error — try next tag or give up
		}
	}
	return null;
}

// --- Updater state ---

export type PendingNotification = UpdateNotification;

interface UpdaterState {
	currentVersion: string;
	lastSeenVersion: string | null;
	pendingNotification: PendingNotification | null;
	dismissedUpdateVersion: string | null;
}

const state: UpdaterState = {
	currentVersion: "",
	lastSeenVersion: null,
	pendingNotification: null,
	dismissedUpdateVersion: null,
};

export function getUpdaterState() {
	return { ...state, ...(lifecycle?.getState() ?? initialUpdateLifecycle) };
}

export function clearPendingNotification(): void {
	state.pendingNotification = null;
}

function getLastSeenVersion(): string | null {
	const db = getDb();
	const row = db.select().from(sessionState).where(eq(sessionState.key, "lastSeenVersion")).get();
	return row?.value ?? null;
}

function setLastSeenVersion(version: string): void {
	const db = getDb();
	db.insert(sessionState)
		.values({ key: "lastSeenVersion", value: version })
		.onConflictDoUpdate({
			target: sessionState.key,
			set: { value: version },
		})
		.run();
}

function getDismissedUpdateVersion(): string | null {
	const db = getDb();
	const row = db
		.select()
		.from(sessionState)
		.where(eq(sessionState.key, "dismissedUpdateVersion"))
		.get();
	return row?.value ?? null;
}

function setDismissedUpdateVersion(version: string | null): void {
	const db = getDb();
	if (version === null) {
		db.delete(sessionState).where(eq(sessionState.key, "dismissedUpdateVersion")).run();
	} else {
		db.insert(sessionState)
			.values({ key: "dismissedUpdateVersion", value: version })
			.onConflictDoUpdate({
				target: sessionState.key,
				set: { value: version },
			})
			.run();
	}
}

export function markVersionSeen(version: string): void {
	setLastSeenVersion(version);
	clearPendingNotification();
}

export function dismissUpdateVersion(version: string): void {
	setDismissedUpdateVersion(version);
	state.dismissedUpdateVersion = version;
}

export function teardownUpdater(): void {
	generation++;
	lifecycle?.dispose();
	lifecycle = null;
	initialization = null;
	if (updateCheckTimer) {
		clearInterval(updateCheckTimer);
		updateCheckTimer = null;
	}
}

// --- Initialization ---

export function initializeUpdater(options: { restoreWindow?: () => void } = {}): Promise<void> {
	if (initialization) return initialization;
	const pending = initialize(options);
	initialization = pending;
	void pending.catch(() => {
		if (initialization === pending) initialization = null;
	});
	return pending;
}

export async function checkForUpdates() {
	await lifecycle?.check();
	return getUpdaterState();
}

export function installUpdate() {
	lifecycle?.install();
	return getUpdaterState();
}

async function initialize(options: { restoreWindow?: () => void }): Promise<void> {
	const currentGeneration = ++generation;
	state.currentVersion = app.getVersion();
	state.lastSeenVersion = getLastSeenVersion();
	state.dismissedUpdateVersion = getDismissedUpdateVersion();

	// If the dismissed version is now the running version, the update was installed — clear the flag
	if (state.dismissedUpdateVersion === state.currentVersion) {
		setDismissedUpdateVersion(null);
		state.dismissedUpdateVersion = null;
	}

	// First launch — just record the version, no notification
	if (!state.lastSeenVersion) {
		setLastSeenVersion(state.currentVersion);
		state.lastSeenVersion = state.currentVersion;
	}

	// Check if version changed since last seen
	const diffType = getVersionDiffType(state.lastSeenVersion, state.currentVersion);
	if (diffType) {
		const release = await fetchReleaseNotes(state.currentVersion);
		if (currentGeneration !== generation) return;
		const releaseNotes = release?.body ?? null;
		const summary = extractReleaseSummary(releaseNotes);

		state.pendingNotification = {
			type: diffType,
			version: state.currentVersion,
			releaseNotes,
			summary,
		};

		// For patch: mark seen immediately (no modal to wait for)
		if (diffType === "patch") {
			setLastSeenVersion(state.currentVersion);
			state.lastSeenVersion = state.currentVersion;
		}
	}

	// Skip electron-updater in dev mode — it requires a packaged app
	if (!app.isPackaged) {
		log.info("[updater] Skipping auto-updater in dev mode");
		return;
	}

	lifecycle = createUpdaterLifecycle(autoUpdater, nativeUpdater, {
		platform: process.platform,
		restoreWindow: options.restoreWindow,
	});
	void checkForUpdates();
	updateCheckTimer = setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
	updateCheckTimer.unref();
}
