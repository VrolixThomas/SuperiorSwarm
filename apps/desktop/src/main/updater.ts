import { eq } from "drizzle-orm";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import * as semver from "semver";
import { getDb } from "./db";
import { sessionState } from "./db/schema";
import { GITHUB_API_BASE } from "./github/constants";

const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
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

export interface PendingNotification {
	type: VersionDiffType;
	version: string;
	releaseNotes: string | null;
	summary: string | null;
}

interface UpdaterState {
	currentVersion: string;
	lastSeenVersion: string | null;
	pendingNotification: PendingNotification | null;
	updateAvailable: boolean;
	updateVersion: string | null;
	downloadProgress: number | null;
	updateDownloaded: boolean;
	dismissedUpdateVersion: string | null;
}

const state: UpdaterState = {
	currentVersion: "",
	lastSeenVersion: null,
	pendingNotification: null,
	updateAvailable: false,
	updateVersion: null,
	downloadProgress: null,
	updateDownloaded: false,
	dismissedUpdateVersion: null,
};

export function getUpdaterState(): Readonly<UpdaterState> {
	return state;
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
	if (updateCheckTimer) {
		clearInterval(updateCheckTimer);
		updateCheckTimer = null;
	}
}

// --- Initialization ---

export async function initializeUpdater(): Promise<void> {
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
		return;
	}

	// Check if version changed since last seen
	const diffType = getVersionDiffType(state.lastSeenVersion, state.currentVersion);
	if (diffType) {
		const release = await fetchReleaseNotes(state.currentVersion);
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
		console.log("[updater] Skipping auto-updater in dev mode");
		return;
	}

	// Set up electron-updater
	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;

	autoUpdater.on("update-available", (info) => {
		state.updateAvailable = true;
		state.updateVersion = info.version;
	});

	autoUpdater.on("download-progress", (progress) => {
		state.downloadProgress = Math.round(progress.percent);
	});

	autoUpdater.on("update-downloaded", () => {
		state.updateDownloaded = true;
		state.downloadProgress = null;
	});

	autoUpdater.on("error", (err) => {
		console.error("[updater] Auto-update error:", err);
	});

	autoUpdater.checkForUpdates().catch((err) => {
		console.error("[updater] Failed to check for updates:", err);
	});

	if (updateCheckTimer) clearInterval(updateCheckTimer);
	updateCheckTimer = setInterval(() => {
		autoUpdater.checkForUpdates().catch((err) => {
			console.error("[updater] Failed to check for updates:", err);
		});
	}, UPDATE_CHECK_INTERVAL_MS);
}
