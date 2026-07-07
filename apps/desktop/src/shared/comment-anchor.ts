export interface ReanchorResult {
	startLine: number;
	endLine: number;
	outdated: boolean;
}

/**
 * Re-locate a comment's code snapshot inside (possibly changed) file content.
 * Lines are 1-based and inclusive. When the snapshot block appears multiple
 * times, the occurrence nearest the stored startLine wins. When it is gone,
 * the stored range is clamped into the file and flagged outdated.
 */
export function reanchorComment(
	content: string,
	startLine: number,
	endLine: number,
	codeSnapshot: string
): ReanchorResult {
	const contentLines = content.split("\n");
	const snapshotLines = codeSnapshot.split("\n");
	const span = snapshotLines.length;

	const matches: number[] = [];
	for (let i = 0; i + span <= contentLines.length; i++) {
		let ok = true;
		for (let j = 0; j < span; j++) {
			if (contentLines[i + j] !== snapshotLines[j]) {
				ok = false;
				break;
			}
		}
		if (ok) matches.push(i + 1); // 1-based
	}

	if (matches.length > 0) {
		let best = matches[0] as number;
		for (const m of matches) {
			if (Math.abs(m - startLine) < Math.abs(best - startLine)) best = m;
		}
		return { startLine: best, endLine: best + span - 1, outdated: false };
	}

	const clampedStart = Math.min(startLine, contentLines.length);
	const clampedEnd = Math.min(endLine, contentLines.length);
	return { startLine: clampedStart, endLine: clampedEnd, outdated: true };
}
