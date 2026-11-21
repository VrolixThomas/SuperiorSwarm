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
	setAutoMapOnReviewRequest: (enabled: boolean) => void;
	setAlsoReview: (enabled: boolean) => void;
	setDefaultRailMode: (mode: ReviewPathSettings["defaultRailMode"]) => void;
}
export const useReviewPathSettingsStore = create<ReviewPathSettingsStore>((set, get) => {
	function update(patch: Partial<ReviewPathSettings>) {
		set(patch);
		try {
			if (typeof window !== "undefined")
				window.localStorage.setItem(STORAGE_KEY, serializeReviewPathSettings(get()));
		} catch {
			/* Preferences remain usable when browser storage is unavailable. */
		}
	}
	return {
		...readStorage(),
		setAutoMapOnReviewRequest: (enabled) => update({ autoMapOnReviewRequest: enabled }),
		setAlsoReview: (enabled) => update({ alsoReview: enabled }),
		setDefaultRailMode: (mode) => update({ defaultRailMode: mode }),
	};
});
