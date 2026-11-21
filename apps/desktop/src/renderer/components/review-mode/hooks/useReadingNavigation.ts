import { useCallback, useEffect, useMemo, useState } from "react";
import type { GitHubPRFile } from "../../../../shared/github-types";
import type {
	AskMessage,
	CodeReference,
	ContextFileStep,
} from "../../../../shared/review-path-types";
import { type ReviewKeyAction, escapeTarget } from "../../../lib/review-keymap";
import {
	type RailFileItem,
	railItems,
	resolveRailMode,
	selectableRailItems,
} from "../../../lib/review-path-model";
import type { ReviewPathSource } from "../../../lib/review-path-source";
import { usePRReviewSessionStore } from "../../../stores/pr-review-session-store";
import { useReviewModeStore } from "../../../stores/review-mode-store";
import { useReviewPathSettingsStore } from "../../../stores/review-path-settings-store";

export function useReadingNavigation({
	source,
	files,
	filesReady = true,
	sessionKey,
	onClose,
	onViewed,
	onNextPR,
	onPreviousPR,
}: {
	source: ReviewPathSource;
	files: GitHubPRFile[];
	filesReady?: boolean;
	sessionKey: string;
	onClose: () => void;
	onViewed: (file: string) => void;
	onNextPR: () => void;
	onPreviousPR: () => void;
}) {
	const railMode = useReviewModeStore((s) => s.railMode);
	const overviewOpen = useReviewModeStore((s) => s.overviewOpen);
	const defaultMode = useReviewPathSettingsStore((s) => s.defaultRailMode);
	const selectedPath = usePRReviewSessionStore(
		(s) => s.sessions.get(sessionKey)?.activeFilePath ?? null
	);
	const [transient, setTransient] = useState<ContextFileStep | null>(null);
	const [selection, setSelection] = useState<AskMessage["anchor"] | null>(null);
	const [question, setQuestion] = useState("");
	const [composerOpen, setComposerOpen] = useState(false);
	const [cancelCommentNonce, setCancelCommentNonce] = useState(0);
	const [commentRequest, setCommentRequest] = useState<{
		id: string;
		anchor: NonNullable<AskMessage["anchor"]>;
		body?: string;
	}>();
	const mode = resolveRailMode(railMode, defaultMode, source.status);
	const items = useMemo(
		() => selectableRailItems(railItems(source.path, files, mode)),
		[source.path, files, mode]
	);
	const fileOrder = useMemo(() => items.map((item) => item.path), [items]);
	useEffect(() => {
		if (!filesReady) return;
		const order =
			transient && !fileOrder.includes(transient.path) ? [...fileOrder, transient.path] : fileOrder;
		usePRReviewSessionStore.getState().setFileOrder(sessionKey, order);
	}, [fileOrder, transient, sessionKey, filesReady]);
	const selected: RailFileItem | null =
		items.find((item) => item.path === selectedPath) ??
		(transient?.path === selectedPath
			? { kind: "context", id: transient.id, path: transient.path, changed: false, step: transient }
			: null);
	const select = useCallback(
		(item: RailFileItem) => {
			usePRReviewSessionStore.getState().selectFile(sessionKey, item.path);
			useReviewModeStore.getState().setOverviewOpen(false);
			useReviewModeStore.getState().setView("changes");
			setSelection(null);
		},
		[sessionKey]
	);
	const openReference = useCallback(
		(ref: CodeReference) => {
			const item = items.find((item) => item.path === ref.path);
			if (item) select(item);
			else {
				const step: ContextFileStep = {
					id: `transient:${ref.path}`,
					kind: "context",
					path: ref.path,
					note: ref.description,
					focus: [{ side: "RIGHT", startLine: ref.line, endLine: ref.line }],
					addedBy: "user",
				};
				setTransient(step);
				select({ kind: "context", id: step.id, path: ref.path, changed: false, step });
			}
		},
		[items, select]
	);
	const advance = useCallback(
		(direction: 1 | -1) => {
			const index = overviewOpen ? -1 : items.findIndex((item) => item.path === selectedPath);
			const next =
				items[index < 0 ? 0 : Math.max(0, Math.min(items.length - 1, index + direction))];
			if (next) select(next);
		},
		[items, overviewOpen, selectedPath, select]
	);
	const changeMode = useCallback((mode: "path" | "files") => {
		useReviewModeStore.getState().setRailMode(mode);
		useReviewPathSettingsStore.getState().setDefaultRailMode(mode);
	}, []);
	const ask = useCallback((anchor?: AskMessage["anchor"], text = "") => {
		useReviewModeStore.getState().setAskAnchor(anchor ?? null);
		useReviewModeStore.getState().setPanel("ask");
		setQuestion(text);
	}, []);
	const onAction = useCallback(
		(action: ReviewKeyAction) => {
			const store = useReviewModeStore.getState();
			switch (action) {
				case "next":
					advance(1);
					return true;
				case "prev":
					advance(-1);
					return true;
				case "toggle-rail-mode":
					changeMode(mode === "path" ? "files" : "path");
					return true;
				case "toggle-viewed":
					if (selected?.changed && !overviewOpen) onViewed(selected.path);
					return true;
				case "open-threads":
				case "open-in-comments":
					store.setPanel("threads");
					return true;
				case "ask-agent":
					ask(
						selection ??
							(selected
								? { path: selected.path, side: "RIGHT", startLine: 1, endLine: 1 }
								: undefined)
					);
					return true;
				case "next-pr":
					onNextPR();
					return true;
				case "prev-pr":
					onPreviousPR();
					return true;
				case "escape": {
					const target = escapeTarget({
						composerOpen,
						panel: store.panel,
						queueOpen: store.queueOpen,
						overviewOpen,
					});
					if (target === "composer") {
						setCancelCommentNonce((nonce) => nonce + 1);
						setComposerOpen(false);
					} else if (target === "panel") store.setPanel(null);
					else if (target === "queue") store.setQueueOpen(false);
					else if (target === "overview") store.setOverviewOpen(false);
					else if (store.drawerOpen) store.setDrawerOpen(false);
					else if (store.view === "terminal") store.setView("changes");
					else onClose();
					return true;
				}
				default:
					return false;
			}
		},
		[
			advance,
			changeMode,
			mode,
			selected,
			overviewOpen,
			onViewed,
			ask,
			selection,
			onNextPR,
			onPreviousPR,
			composerOpen,
			onClose,
		]
	);
	const resetAnchors = useCallback(() => {
		setSelection(null);
		setCommentRequest(undefined);
		setCancelCommentNonce((nonce) => nonce + 1);
		useReviewModeStore.getState().setAskAnchor(null);
	}, []);
	return {
		resetAnchors,
		mode,
		items,
		fileOrder,
		selectedPath,
		selected,
		overviewOpen,
		select,
		advance,
		changeMode,
		openReference,
		ask,
		question,
		setSelection,
		setComposerOpen,
		cancelCommentNonce,
		commentRequest,
		setCommentRequest,
		onAction,
		transient,
	};
}
