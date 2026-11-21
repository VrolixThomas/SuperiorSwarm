import { expect, test } from "bun:test";
import {
	defaultReviewPathSettings,
	parseReviewPathSettings,
	serializeReviewPathSettings,
} from "../src/renderer/stores/review-path-settings-store";
test("settings persist without relying on browser storage", () => {
	const settings = {
		...defaultReviewPathSettings(),
		autoMapOnReviewRequest: true,
		alsoReview: false,
		defaultRailMode: "files" as const,
	};
	expect(parseReviewPathSettings(serializeReviewPathSettings(settings))).toEqual(settings);
	expect(parseReviewPathSettings("broken")).toEqual(defaultReviewPathSettings());
	expect(parseReviewPathSettings('{"alsoReview":"false","defaultRailMode":"unexpected"}')).toEqual(
		defaultReviewPathSettings()
	);
});
