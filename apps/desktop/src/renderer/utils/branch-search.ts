interface BranchMatch {
	tier: number;
	start: number;
	span: number;
}

interface BranchSegment {
	name: string;
	start: number;
}

const BRANCH_SEGMENT_PATTERN = /[^\/_\-.]+/g;

function getBranchSegments(branch: string): BranchSegment[] {
	return Array.from(branch.matchAll(BRANCH_SEGMENT_PATTERN), (match) => ({
		name: match[0],
		start: match.index,
	}));
}

function findSubsequence(query: string, branch: string): { start: number; span: number } | null {
	let best: { start: number; span: number } | null = null;

	for (let start = 0; start < branch.length; start++) {
		if (branch[start] !== query[0]) continue;

		let queryIndex = 1;
		for (let branchIndex = start + 1; branchIndex < branch.length; branchIndex++) {
			if (branch[branchIndex] !== query[queryIndex]) continue;
			queryIndex++;
			if (queryIndex !== query.length) continue;

			const candidate = { start, span: branchIndex - start + 1 };
			if (
				!best ||
				candidate.span < best.span ||
				(candidate.span === best.span && candidate.start < best.start)
			) {
				best = candidate;
			}
			break;
		}
	}

	return best;
}

function matchBranch(query: string, branch: string): BranchMatch | null {
	if (branch === query) return { tier: 0, start: 0, span: query.length };

	const segments = getBranchSegments(branch);
	const lastSegment = segments.at(-1);
	if (lastSegment?.name === query) {
		return { tier: 1, start: lastSegment.start, span: query.length };
	}
	if (branch.startsWith(query)) return { tier: 2, start: 0, span: query.length };

	const exactSegment = segments.find((segment) => segment.name === query);
	if (exactSegment) {
		return { tier: 3, start: exactSegment.start, span: query.length };
	}
	if (lastSegment?.name.startsWith(query)) {
		return { tier: 4, start: lastSegment.start, span: query.length };
	}

	const segmentPrefix = segments.find((segment) => segment.name.startsWith(query));
	if (segmentPrefix) {
		return { tier: 5, start: segmentPrefix.start, span: query.length };
	}

	const substringIndex = branch.indexOf(query);
	if (substringIndex !== -1) {
		return { tier: 6, start: substringIndex, span: query.length };
	}

	const subsequence = findSubsequence(query, branch);
	return subsequence ? { tier: 7, ...subsequence } : null;
}

/**
 * Filters and ranks branches by how closely their names match the query.
 * The original ordering is retained when the query is empty.
 */
export function filterAndSortBranches<T>(
	branches: readonly T[],
	query: string,
	getName: (branch: T) => string
): T[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [...branches];

	return branches
		.map((branch, originalIndex) => {
			const name = getName(branch);
			const normalizedName = name.toLowerCase();
			return {
				branch,
				name,
				originalIndex,
				match: matchBranch(normalizedQuery, normalizedName),
			};
		})
		.filter((entry): entry is typeof entry & { match: BranchMatch } => entry.match !== null)
		.sort((a, b) => {
			if (a.match.tier !== b.match.tier) return a.match.tier - b.match.tier;
			if (a.match.span !== b.match.span) return a.match.span - b.match.span;
			if (a.match.start !== b.match.start) return a.match.start - b.match.start;
			if (a.name.length !== b.name.length) return a.name.length - b.name.length;
			const alphabetical = a.name.localeCompare(b.name);
			return alphabetical || a.originalIndex - b.originalIndex;
		})
		.map((entry) => entry.branch);
}
