/** Deliberately excludes Git output, remote names, URLs and credentials. */
export interface ReviewFetchProgress {
	stage: "enumerating" | "counting" | "compressing" | "receiving" | "resolving" | "checking";
	percent?: number;
	current?: number;
	total?: number;
	bytes?: number;
}
const stageLabels: Record<ReviewFetchProgress["stage"], string> = {
	enumerating: "Enumerating objects",
	counting: "Counting objects",
	compressing: "Compressing objects",
	receiving: "Receiving objects",
	resolving: "Resolving deltas",
	checking: "Checking files",
};
export function formatReviewFetchProgress(progress: ReviewFetchProgress): string {
	const parts = [stageLabels[progress.stage]];
	if (progress.percent !== undefined) parts.push(`${progress.percent}%`);
	if (progress.current !== undefined)
		parts.push(
			progress.total === undefined
				? `${progress.current} objects`
				: `${progress.current} / ${progress.total}`
		);
	if (progress.bytes !== undefined) {
		const units = ["B", "KiB", "MiB", "GiB"];
		const index = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.max(1, progress.bytes)) / 10)));
		parts.push(`${(progress.bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`);
	}
	return parts.join(" · ");
}
