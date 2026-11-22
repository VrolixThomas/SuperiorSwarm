import { create } from "zustand";
import type { ReviewPathSettings } from "../../shared/review-path-types";

const STORAGE_KEY = "ss.review-path.settings.v1";
export function defaultReviewPathSettings(): ReviewPathSettings {
	return { autoMapOnReviewRequest: false, alsoReview: true, defaultRailMode: "auto" };
}
export function parseReviewPathSettings(raw: string | null): ReviewPathSettings {
	const defaults = defaultReviewPathSettings();
	if (!raw) return defaults;
	try {
		const value = JSON.parse(raw);
		if (!value || typeof value !== "object") return defaults;
		return {
			autoMapOnReviewRequest:
				typeof value.autoMapOnReviewRequest === "boolean"
					? value.autoMapOnReviewRequest
					: defaults.autoMapOnReviewRequest,
			alsoReview: typeof value.alsoReview === "boolean" ? value.alsoReview : defaults.alsoReview,
			defaultRailMode: ["path", "files", "auto"].includes(value.defaultRailMode)
				? value.defaultRailMode
				: defaults.defaultRailMode,
		};
	} catch {
		return defaults;
	}
}
export function serializeReviewPathSettings(settings: ReviewPathSettings): string {
	return JSON.stringify({
		autoMapOnReviewRequest: settings.autoMapOnReviewRequest,
		alsoReview: settings.alsoReview,
		defaultRailMode: settings.defaultRailMode,
	});
}
function readStorage() {
	try {
		return parseReviewPathSettings(
			typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY)
		);
	} catch {
		return defaultReviewPathSettings();
	}
}
interface ReviewPathSettingsStore extends ReviewPathSettings {
	connected: boolean;
	error?: string;
	setAutoMapOnReviewRequest: (enabled: boolean) => void;
	setAlsoReview: (enabled: boolean) => void;
	setDefaultRailMode: (mode: ReviewPathSettings["defaultRailMode"]) => void;
}
export const useReviewPathSettingsStore = create<ReviewPathSettingsStore>(() => ({
	...readStorage(),
	connected: false,
	setAutoMapOnReviewRequest: (enabled) => {
		void saveSettings({ autoMapOnReviewRequest: enabled });
	},
	setAlsoReview: (enabled) => {
		void saveSettings({ alsoReview: enabled });
	},
	setDefaultRailMode: (mode) => {
		void saveSettings({ defaultRailMode: mode });
	},
}));
function acceptSettings(settings: ReviewPathSettings) {
	useReviewPathSettingsStore.setState({ ...settings, connected: true, error: undefined });
	try {
		window.localStorage.setItem(STORAGE_KEY, serializeReviewPathSettings(settings));
	} catch {}
}
export async function initializeReviewPathSettings(): Promise<void> {
	try {
		acceptSettings(await settingsSync.load());
	} catch (error) {
		useReviewPathSettingsStore.setState({
			connected: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
async function saveSettings(patch: Partial<ReviewPathSettings>) {
	try {
		acceptSettings(await settingsSync.update(patch));
	} catch (error) {
		useReviewPathSettingsStore.setState({
			connected: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export interface ReviewPathSettingsTransport {
	get(): Promise<ReviewPathSettings>;
	importLegacy(settings: ReviewPathSettings): Promise<ReviewPathSettings>;
	update(patch: Partial<ReviewPathSettings>): Promise<ReviewPathSettings>;
}
/** The server atomically imports legacy values only if no authoritative settings exist. */
export function createReviewPathSettingsSync(
	transport: ReviewPathSettingsTransport,
	legacy: () => ReviewPathSettings | null
) {
	let imported = false;
	let loading: Promise<ReviewPathSettings> | undefined;
	let queue = Promise.resolve();
	const load = (): Promise<ReviewPathSettings> => {
		if (loading) return loading;
		loading = (async () => {
			const old = legacy();
			const settings = !imported && old ? await transport.importLegacy(old) : await transport.get();
			imported = true;
			return settings;
		})().finally(() => {
			loading = undefined;
		});
		return loading;
	};
	return {
		load,
		update: (patch: Partial<ReviewPathSettings>) => {
			const next = queue.then(async () => {
				await load();
				return transport.update(patch);
			});
			queue = next.then(
				() => {},
				() => {}
			);
			return next;
		},
	};
}

const settingsSync = createReviewPathSettingsSync(
	{
		get: async () => (await import("../trpc/client")).trpcVanilla.reviewPath.getSettings.query(),
		importLegacy: async (settings) =>
			(await import("../trpc/client")).trpcVanilla.reviewPath.importLegacySettings.mutate(settings),
		update: async (patch) => {
			const client = (await import("../trpc/client")).trpcVanilla.reviewPath;
			const settings = await client.getSettings.query();
			return client.updateSettings.mutate({ ...settings, ...patch });
		},
	},
	() => {
		try {
			const raw = window.localStorage.getItem(STORAGE_KEY);
			return raw ? parseReviewPathSettings(raw) : null;
		} catch {
			return null;
		}
	}
);
