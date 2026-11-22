import { readGit, requireLocalCommit } from "../review-explanation/git-reader";

/** A target tip is not the PR diff base: destination-only commits must stay out. */
export async function resolveReviewMergeBase(
	root: string,
	headOid: string,
	targetTipOid: string,
	signal: AbortSignal
) {
	await requireLocalCommit(root, headOid, signal);
	await requireLocalCommit(root, targetTipOid, signal);
	if (
		(await readGit(root, ["rev-parse", "--is-shallow-repository"], signal)).toString().trim() !==
		"false"
	)
		throw new Error("Review merge base requires complete local history. Fetch history and retry.");
	const bases = (await readGit(root, ["merge-base", "--all", targetTipOid, headOid], signal))
		.toString()
		.trim()
		.split("\n");
	const mergeBaseOid = bases[0];
	if (bases.length !== 1 || !mergeBaseOid || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(mergeBaseOid))
		throw new Error("Review merge base is ambiguous or unavailable. Refresh and retry.");
	await requireLocalCommit(root, mergeBaseOid, signal);
	return mergeBaseOid;
}
