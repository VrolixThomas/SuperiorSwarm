import { eq } from "drizzle-orm";
import { app } from "electron";
import * as semver from "semver";
import { getDb } from "./db";
import { sessionState } from "./db/schema";

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
const GITHUB_REPO = "BranchFlux";

export async function fetchReleaseNotes(
	version: string
): Promise<{ body: string; publishedAt: string } | null> {
	const tags = [`v${version}`, version];
	for (const tag of tags) {
		try {
			const res = await fetch(
				`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${tag}`,
				{
					headers: { Accept: "application/vnd.github.v3+json" },
				}
			);
			if (res.ok) {
				const data = (await res.json()) as { body?: string; published_at?: string };
				return {
					body: data.body ?? "",
					publishedAt: data.published_at ?? "",
				};
			}
		} catch {
			// Network error — try next tag or give up
		}
	}
	// Fallback: try latest release
	try {
		const res = await fetch(
			`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
			{ headers: { Accept: "application/vnd.github.v3+json" } }
		);
		if (res.ok) {
			const data = (await res.json()) as { body?: string; published_at?: string };
			return {
				body: data.body ?? "",
				publishedAt: data.published_at ?? "",
			};
		}
	} catch {
		// Offline — no release notes available
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
}

const state: UpdaterState = {
	currentVersion: "",
	lastSeenVersion: null,
	pendingNotification: null,
	updateAvailable: false,
	updateVersion: null,
	downloadProgress: null,
	updateDownloaded: false,
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

export function markVersionSeen(version: string): void {
	setLastSeenVersion(version);
	clearPendingNotification();
}

// --- Initialization ---

export async function initializeUpdater(): Promise<void> {
	state.currentVersion = app.getVersion();
	state.lastSeenVersion = getLastSeenVersion();

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

	// Set up electron-updater (imported dynamically to avoid issues in dev)
	try {
		const { autoUpdater } = await import("electron-updater");
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

		// Check for updates in background
		autoUpdater.checkForUpdates().catch((err) => {
			console.error("[updater] Failed to check for updates:", err);
		});
	} catch (err) {
		console.error("[updater] Failed to initialize electron-updater:", err);
	}
}
