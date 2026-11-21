import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GitHubPRDetails, PRContext } from "../../../../shared/github-types";
import type {
	ReviewPathIdentity,
	ReviewPathLaunchResult,
} from "../../../../shared/review-path-runtime";
import { attachReadingPathTerminal } from "../../../lib/review-connected-terminal";
import {
	reviewPathIdentityKey,
	useLiveReviewPath,
	useReviewPath,
} from "../../../lib/review-path-source";
import { rememberReviewPath } from "../../../lib/review-path-status-cache";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { trpcVanilla } from "../../../trpc/client";
import { trpc } from "../../../trpc/client";
import { useAskAgent } from "../panel/useAskAgent";
import { useCurrentReviewer } from "./useCurrentReviewer";

export function useReviewConnections(
	workspaceId: string,
	prCtx: PRContext,
	details: GitHubPRDetails | undefined,
	fixture: boolean
) {
	const [attachmentError, setAttachmentError] = useState<string>();
	const { mutateAsync: attach } = trpc.workspaces.attachTerminal.useMutation();
	const scopeKey = JSON.stringify([
		workspaceId,
		prCtx.provider,
		prCtx.owner,
		prCtx.repo,
		prCtx.number,
		details?.headCommitOid,
	]);
	const currentScope = useRef<string | null>(scopeKey);
	currentScope.current = scopeKey;
	useEffect(() => {
		currentScope.current = scopeKey;
		setAttachmentError(undefined);
		return () => {
			currentScope.current = null;
		};
	}, [scopeKey]);
	const onLaunch = useCallback(
		(launch: ReviewPathLaunchResult) => {
			const isCurrent = () => currentScope.current === scopeKey;
			if (!isCurrent()) return;
			setAttachmentError(undefined);
			void attachReadingPathTerminal(workspaceId, launch, attach, isCurrent, scopeKey)
				.then((ok) => {
					if (!ok && isCurrent())
						setAttachmentError("The agent terminal did not match this review workspace.");
				})
				.catch(
					(error) =>
						isCurrent() &&
						setAttachmentError(
							error instanceof Error ? error.message : "Could not attach the agent terminal."
						)
				);
		},
		[workspaceId, attach, scopeKey]
	);
	const identity = useMemo<ReviewPathIdentity | undefined>(
		() =>
			details?.headCommitOid && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(details.headCommitOid)
				? {
						workspaceId,
						provider: prCtx.provider,
						owner: prCtx.owner,
						repo: prCtx.repo,
						prNumber: prCtx.number,
						headSha: details.headCommitOid,
					}
				: undefined,
		[workspaceId, prCtx.provider, prCtx.owner, prCtx.repo, prCtx.number, details?.headCommitOid]
	);
	const live = useLiveReviewPath(fixture ? undefined : identity);
	useEffect(() => {
		if (live.state.snapshot) rememberReviewPath(live.state.snapshot);
	}, [live.state.snapshot]);
	const ownedRun = live.state.snapshot?.runs
		.filter(
			(run) =>
				identity &&
				reviewPathIdentityKey(run.identity) === reviewPathIdentityKey(identity) &&
				run.terminalId === `review-path:${run.id}:${run.version}`
		)
		.sort((a, b) => b.version - a.version)[0];
	const recordedTerminal = useReviewModeStore((state) => state.terminals[workspaceId]);
	const terminal =
		recordedTerminal?.reviewScopeKey && recordedTerminal.reviewScopeKey !== scopeKey
			? undefined
			: recordedTerminal;
	const recover = useCallback(async () => {
		if (!identity || !ownedRun?.terminalId) return;
		const isCurrent = () => currentScope.current === scopeKey;
		try {
			const status = await trpcVanilla.reviewPath.status.query(identity);
			if (!isCurrent()) return;
			if (
				!status?.terminal ||
				reviewPathIdentityKey(status.identity) !== reviewPathIdentityKey(identity)
			)
				throw new Error("The recorded agent terminal is unavailable. Its session may have ended.");
			const descriptor = status.terminal;
			if (
				!descriptor.terminalId ||
				descriptor.reviewWorkspaceId !== workspaceId ||
				!descriptor.worktreePath ||
				!live.state.snapshot?.runs.some(
					(run) =>
						run.terminalId === descriptor.terminalId &&
						reviewPathIdentityKey(run.identity) === reviewPathIdentityKey(identity)
				)
			)
				throw new Error("The agent terminal did not match this review workspace.");
			// Recovery is read-only: the durable run/session already owns this descriptor.
			useReviewModeStore.getState().setTerminal({
				workspaceId,
				tabId: descriptor.terminalId,
				cwd: descriptor.worktreePath,
				reviewScopeKey: scopeKey,
			});
			setAttachmentError(undefined);
		} catch (error) {
			if (isCurrent())
				setAttachmentError(
					error instanceof Error ? error.message : "Could not recover the agent terminal."
				);
		}
	}, [identity, ownedRun?.terminalId, scopeKey, workspaceId, live.state.snapshot]);
	const recoveryAttempt = useRef("");
	useEffect(() => {
		const attempt = `${scopeKey}:${ownedRun?.terminalId ?? ""}`;
		if (
			!ownedRun?.terminalId ||
			terminal?.tabId === ownedRun.terminalId ||
			recoveryAttempt.current === attempt
		)
			return;
		recoveryAttempt.current = attempt;
		void recover();
	}, [scopeKey, ownedRun?.terminalId, terminal?.tabId, recover]);
	const openTerminal =
		terminal || ownedRun?.terminalId
			? () => {
					useReviewModeStore.getState().setDrawerOpen(true);
					if (!terminal) void recover();
				}
			: undefined;
	const source = useReviewPath(prCtx, details, { fixture, identity, onLaunch });
	const askAgent = useAskAgent(prCtx, { fixture, identity, onLaunch });
	const reviewer = useCurrentReviewer(prCtx, !fixture);
	return { source, askAgent, reviewer, attachmentError, openTerminal, terminal };
}
