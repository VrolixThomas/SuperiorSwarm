import type { UnifiedThread } from "../../shared/github-types";
import type { ReviewPath, ReviewPathStep } from "../../shared/review-path-types";

type FileLike = { path: string };
export interface RailFileItem {
	kind: "step" | "context" | "test" | "file";
	id: string;
	path: string;
	changed: boolean;
	entryId?: string;
	stepId?: string;
	step?: ReviewPathStep;
	number?: number;
	fileIndex?: number;
	fileTotal?: number;
	folderLabel?: string;
}
export type RailItem =
	| RailFileItem
	| {
			kind: "entry" | "folder" | "other-files";
			id: string;
			title: string;
			entryId?: string;
			count?: number;
	  };
export function selectableRailItems(items: RailItem[]): RailFileItem[] {
	return items.filter((item): item is RailFileItem => "path" in item);
}
export function folderGroups<T extends FileLike>(files: T[]): { folder: string; files: T[] }[] {
	const groups = new Map<string, T[]>();
	for (const file of files) {
		const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
		const group = groups.get(folder) ?? [];
		group.push(file);
		groups.set(folder, group);
	}
	return [...groups].map(([folder, files]) => ({ folder, files }));
}
export function numberSteps(path: ReviewPath): Map<string, number> {
	const result = new Map<string, number>();
	for (const entry of path.entries)
		for (const step of entry.steps)
			if (step.kind === "changed") result.set(step.id, result.size + 1);
	return result;
}
function coveredPaths(path: ReviewPath): string[] {
	return [
		...path.entries.flatMap((entry) =>
			entry.steps.flatMap((step) =>
				step.kind === "changed"
					? [step.path, ...step.tests.filter((test) => test.changed).map((test) => test.path)]
					: []
			)
		),
		...path.otherFiles,
	];
}
export function coverage(path: ReviewPath, files: FileLike[]) {
	const counts = new Map<string, number>();
	for (const file of coveredPaths(path)) counts.set(file, (counts.get(file) ?? 0) + 1);
	return {
		missing: files.filter((file) => !counts.has(file.path)).map((file) => file.path),
		duplicated: [...counts].filter(([, count]) => count > 1).map(([path]) => path),
	};
}
export function railItems(
	path: ReviewPath | null,
	files: FileLike[],
	mode: "path" | "files"
): RailItem[] {
	if (!path) {
		return [...files]
			.sort(
				(a, b) =>
					(a.path.split("/").pop() ?? a.path).localeCompare(b.path.split("/").pop() ?? b.path) ||
					a.path.localeCompare(b.path)
			)
			.map((file, index) => ({
				kind: "file",
				id: `file:${file.path}`,
				path: file.path,
				changed: true,
				fileIndex: index + 1,
				fileTotal: files.length,
				folderLabel: file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "",
			}));
	}
	if (mode === "files") {
		let index = 0;
		return folderGroups(files).flatMap((group) => [
			{ kind: "folder" as const, id: `folder:${group.folder}`, title: group.folder },
			...group.files.map((file) => ({
				kind: "file" as const,
				id: `file:${file.path}`,
				path: file.path,
				changed: true,
				fileIndex: ++index,
				fileTotal: files.length,
			})),
		]);
	}
	const changed = new Set(files.map((file) => file.path));
	const seen = new Set<string>();
	const numbers = numberSteps(path);
	const items: RailItem[] = [];
	const noLongerChanged: string[] = [];
	for (const entry of path.entries) {
		items.push({ kind: "entry", id: `entry:${entry.id}`, entryId: entry.id, title: entry.title });
		for (const step of entry.steps) {
			if (step.kind === "changed" && !changed.has(step.path)) {
				noLongerChanged.push(step.path);
				continue;
			}
			if (!seen.has(step.path)) {
				seen.add(step.path);
				items.push({
					kind: step.kind === "changed" ? "step" : changed.has(step.path) ? "file" : "context",
					id: step.id,
					path: step.path,
					changed: changed.has(step.path),
					entryId: entry.id,
					stepId: step.id,
					step,
					number: numbers.get(step.id),
				});
			}
			if (step.kind === "changed")
				for (const test of step.tests) {
					if (seen.has(test.path)) continue;
					seen.add(test.path);
					items.push({
						kind: "test",
						id: `test:${step.id}:${test.path}`,
						path: test.path,
						changed: changed.has(test.path),
						entryId: entry.id,
						stepId: step.id,
						step,
					});
				}
		}
	}
	const others = [
		...new Set([...path.otherFiles, ...coverage(path, files).missing, ...noLongerChanged]),
	].filter((file) => !seen.has(file));
	if (others.length) {
		items.push({
			kind: "other-files",
			id: "other-files",
			title: path.status === "mapping" ? "Not placed yet" : "Other files",
			count: others.length,
		});
		for (const file of others)
			items.push({ kind: "file", id: `file:${file}`, path: file, changed: changed.has(file) });
	}
	return items;
}
export function viewedProgress(files: FileLike[], viewedSet: ReadonlySet<string>) {
	return { viewed: files.filter((file) => viewedSet.has(file.path)).length, total: files.length };
}
export function countsByPath(threads: UnifiedThread[]) {
	const counts = new Map<string, { openThreads: number; pendingFindings: number }>();
	for (const thread of threads) {
		const count = counts.get(thread.path) ?? { openThreads: 0, pendingFindings: 0 };
		if (thread.isAIDraft) {
			if (!thread.isOutdated && thread.status === "pending") count.pendingFindings++;
		} else if (!thread.isResolved && thread.resolutionKnown !== false) count.openThreads++;
		counts.set(thread.path, count);
	}
	return counts;
}
export function isStale(path: ReviewPath, headCommitOid: string) {
	return path.headSha !== headCommitOid;
}
export function stepForPath(path: ReviewPath | null, filePath: string) {
	return path?.entries.flatMap((entry) => entry.steps).find((step) => step.path === filePath);
}
export function stepLabel(
	path: ReviewPath | null,
	item: RailFileItem,
	mode: "path" | "files"
): string {
	if (!item.changed) return "Context";
	if (mode === "files") return `File ${item.fileIndex ?? 1} of ${item.fileTotal ?? 1}`;
	if (path && item.kind === "step") {
		const numbers = numberSteps(path);
		const number = numbers.get(item.id);
		if (number)
			return path.status === "mapping" ? `Step ${number}` : `Step ${number} of ${numbers.size}`;
	}
	return item.kind === "test" ? "Test" : "File";
}
export function resolveRailMode(
	mode: "path" | "files" | null,
	defaultMode: "path" | "files" | "auto",
	status: ReviewPath["status"]
): "path" | "files" {
	if (status === "failed") return "files";
	return (
		mode ??
		(defaultMode === "auto"
			? ["mapping", "ready", "stale"].includes(status)
				? "path"
				: "files"
			: defaultMode)
	);
}
