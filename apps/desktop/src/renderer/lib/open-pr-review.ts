import type { PRContext } from "../../shared/github-types";
import { formatPrIdentifier } from "../../shared/pr-identifier";
import type { TerminalCreateIntent } from "../../shared/terminal-create";
import { useTabStore } from "../stores/tab-store";

export interface OpenPRReviewInput {
	projectId: string;
	prCtx: PRContext;
}
interface ReviewWorkspaceRequest {
	projectId: string;
	prProvider: PRContext["provider"];
	prIdentifier: string;
	prTitle: string;
	sourceBranch: string;
	targetBranch: string;
}

/** Bound UI waiting even if an IPC response is lost; expired requests cannot navigate later. */
export async function withReviewOpeningDeadline<T>(
	operation: (isCurrent: () => boolean) => Promise<T>,
	options: { timeoutMs?: number; isCurrent?: () => boolean } = {}
): Promise<T> {
	let active = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const isCurrent = () => active && (options.isCurrent?.() ?? true);
	try {
		return await Promise.race([
			Promise.resolve().then(() => operation(isCurrent)),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					active = false;
					reject(
						new Error(
							"Preparing this PR took too long. Check the connection and try opening it again."
						)
					);
				}, options.timeoutMs ?? 75_000);
			}),
		]);
	} finally {
		active = false;
		clearTimeout(timer);
	}
}

/** Shared sidebar/queue flow: activate a logical review without preparing Git. */
export async function openPRReview(
	{ projectId, prCtx }: OpenPRReviewInput,
	getOrCreateReview: (
		input: ReviewWorkspaceRequest
	) => Promise<{ id: string; worktreePath: string | null }>,
	options: {
		timeoutMs?: number;
		isCurrent?: () => boolean;
		terminalIntent?: TerminalCreateIntent;
	} = {}
) {
	return withReviewOpeningDeadline(async (isCurrent) => {
		if (!isCurrent()) throw new Error("PR opening request is no longer active");
		const workspace = await getOrCreateReview({
			projectId,
			prProvider: prCtx.provider,
			prIdentifier: formatPrIdentifier(prCtx),
			prTitle: prCtx.title,
			sourceBranch: prCtx.sourceBranch,
			targetBranch: prCtx.targetBranch,
		});
		if (!isCurrent()) throw new Error("PR opening request is no longer active");
		const cwd = workspace.worktreePath ?? prCtx.repoPath;
		useTabStore
			.getState()
			.activateReviewWorkspace(
				workspace.id,
				cwd,
				{ ...prCtx, repoPath: cwd },
				options.terminalIntent
			);
		const store = useTabStore.getState();
		const meta = store.workspaceMetadata[workspace.id];
		if (meta)
			store.setWorkspaceMetadata(workspace.id, {
				...meta,
				reviewWorktreePath: workspace.worktreePath,
			});
		return workspace;
	}, options);
}
