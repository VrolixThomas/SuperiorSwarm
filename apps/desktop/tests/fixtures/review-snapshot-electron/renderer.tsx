import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useContextContent } from "../../../src/renderer/components/review-mode/step/useContextContent";
import { useStepContent } from "../../../src/renderer/components/review-mode/step/useStepContent";
import { trpc } from "../../../src/renderer/trpc/client";
import { ipcLink } from "../../../src/renderer/trpc/ipc-link";
import type { GitHubPRDetails, PRContext } from "../../../src/shared/github-types";

const params = new URLSearchParams(location.search);
const prCtx: PRContext = {
	provider: "github",
	owner: "fixture",
	repo: "repo",
	number: 1,
	title: "Fixture",
	sourceBranch: "change",
	targetBranch: "main",
	repoPath: "/not-used",
};
const details = {
	baseCommitOid: params.get("base") ?? "",
	headCommitOid: params.get("head") ?? "",
} as GitHubPRDetails;
const client = trpc.createClient({ links: [ipcLink()] });
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Changed({ phase, next }: { phase: number; next: (value: number) => void }) {
	const changed = useStepContent(
		"registered",
		prCtx,
		phase === 3 ? { ...details, baseCommitOid: undefined } : details,
		"new.txt"
	);
	useEffect(() => {
		if (phase === 0 && changed.modifiedContent === "head only\n" && changed.originalContent === "")
			next(1);
		if (
			phase === 3 &&
			changed.unavailable &&
			changed.modifiedContent === "" &&
			changed.contentMessage?.includes("Refresh")
		) {
			const bridge = window as unknown as {
				snapshotFixture: { complete: (result: unknown) => Promise<void> };
			};
			void bridge.snapshotFixture.complete({
				immutableChanged: true,
				emptyContext: true,
				missingContext: true,
				unknownRevision: true,
			});
		}
	}, [
		phase,
		next,
		changed.modifiedContent,
		changed.originalContent,
		changed.unavailable,
		changed.contentMessage,
	]);
	return (
		<output>
			{phase}: {changed.contentMessage} {changed.modifiedContent}
		</output>
	);
}
function Context({ phase, next }: { phase: number; next: (value: number) => void }) {
	const context = useContextContent(
		"registered",
		prCtx,
		phase === 2 ? "missing.txt" : "empty.txt",
		details.baseCommitOid,
		details.headCommitOid
	);
	useEffect(() => {
		if (phase === 1 && context.message === "File is empty at this revision.") next(2);
		if (phase === 2 && context.message === "File does not exist at this revision.") next(3);
	}, [phase, next, context.message]);
	return (
		<output>
			{phase}: {context.message}
		</output>
	);
}
function Subject() {
	const [phase, setPhase] = useState(0);
	return phase === 0 || phase === 3 ? (
		<Changed phase={phase} next={setPhase} />
	) : (
		<Context phase={phase} next={setPhase} />
	);
}
const container = document.getElementById("root");
if (!container) throw new Error("Missing fixture root");
createRoot(container).render(
	<trpc.Provider client={client} queryClient={queryClient}>
		<QueryClientProvider client={queryClient}>
			<Subject />
		</QueryClientProvider>
	</trpc.Provider>
);
