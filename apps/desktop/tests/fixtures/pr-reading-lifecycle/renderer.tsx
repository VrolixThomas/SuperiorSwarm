import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { selectAskConversation } from "../../../src/renderer/components/review-mode/panel/useAskAgent";
import {
	type ReviewPathTransport,
	createLiveReviewPathController,
} from "../../../src/renderer/lib/review-path-source";
import { trpcVanilla } from "../../../src/renderer/trpc/client";
import type { ReviewPathIdentity } from "../../../src/shared/review-path-runtime";
const fixture = (window as any).lifecycleFixture;
const rpc = trpcVanilla.reviewPath;
const identity: ReviewPathIdentity = {
	workspaceId: "w",
	provider: "github",
	owner: "o",
	repo: "r",
	prNumber: 1,
	headSha: new URLSearchParams(location.search).get("head")!,
};
const agent = { id: "codex", label: "Codex" };
const transport: ReviewPathTransport = {
	get: (i) => rpc.get.query(i),
	start: (i) => rpc.start.mutate(i),
	cancel: (i) => rpc.cancel.mutate(i),
	ask: (i) => rpc.ask.mutate(i),
	cancelQuestion: (i) => rpc.cancelQuestion.mutate(i),
	addContext: (i) => rpc.addContext.mutate(i),
	removeContext: (i) => rpc.removeContext.mutate(i),
};
const controller = createLiveReviewPathController(identity, transport);
function View() {
	const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
	return <pre>{JSON.stringify(state)}</pre>;
}
createRoot(document.getElementById("root")!).render(<View />);
const results: { name: string; passed: boolean; actual?: unknown }[] = [];
function check(name: string, passed: boolean, actual?: unknown) {
	results.push({ name, passed, actual });
}
async function until(predicate: () => Promise<boolean>, label: string) {
	for (let i = 0; i < 400; i++) {
		if (await predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw Error(`Timeout: ${label}`);
}
const scope = (run: any) => ({ run_id: run.id, run_version: run.version });
async function tool(started: any, name: string, args: object = {}) {
	return fixture.command("tool", {
		launch: started.launch,
		name,
		args: { ...scope(started.run), ...args },
	});
}
async function run() {
	await controller.refresh();
	check("native registered appRouter reachable", controller.getSnapshot().available);
	const recovered = await fixture.command("restart");
	check(
		"disk reopen fences surviving mapping and missing question and revokes capability",
		recovered.revoked && recovered.mapState === "failed" && recovered.questionState === "failed"
	);
	await until(
		async () => !(await fixture.command("restart")).surviving,
		"surviving terminal cleanup"
	);
	const claimed = await rpc.start.mutate({
		identity: recovered.identity,
		agent,
		alsoReview: false,
		auto: true,
	});
	check(
		"durable auto claim survives disk reopen",
		claimed.run.state === "failed" && !claimed.launch
	);
	const retried = await rpc.start.mutate({
		identity: recovered.identity,
		agent,
		alsoReview: false,
	});
	check(
		"manual retry after restart creates new owned run",
		retried.run.id !== claimed.run.id && !!retried.launch
	);
	await rpc.cancel.mutate({
		identity: recovered.identity,
		id: retried.run.id,
		version: retried.run.version,
	});
	const settings = {
		autoMapOnReviewRequest: true,
		alsoReview: false,
		defaultRailMode: "files" as const,
	};
	await rpc.updateSettings.mutate(settings);
	await rpc.importLegacySettings.mutate({ ...settings, alsoReview: true });
	check(
		"explicit settings survive legacy import",
		(await rpc.getSettings.query()).alsoReview === false
	);
	const first = await rpc.start.mutate({ identity, agent, alsoReview: false, auto: true });
	await until(
		async () => (await fixture.command("inspect")).readySessions.includes(first.launch!.terminalId),
		"fake CLI startup"
	);
	check("real PTY executed disposable CLI", true);
	const duplicate = await rpc.start.mutate({ identity, agent, alsoReview: true, auto: true });
	check(
		"duplicate durable auto claim does not relaunch",
		first.run.id === duplicate.run.id && !duplicate.launch
	);
	check(
		"Map without review creates no draft",
		(await fixture.command("inspect")).drafts.length === 0
	);
	const part = await tool(first, "add_path_step", {
		entry_id: "e",
		entry_title: "Entry",
		step: { id: "a", kind: "changed", path: "a.ts", note: "Entry", focus: [], tests: [] },
	});
	await controller.refresh();
	check(
		"streaming partial placement visible through IPC",
		!part.isError &&
			controller.getSnapshot().snapshot?.path?.progress?.placed === 1 &&
			controller.getSnapshot().snapshot?.path?.otherFiles.includes("b.test.ts") === true
	);
	const malformed = await tool(first, "set_review_path", { entries: [], otherFiles: [] });
	check("complete coverage rejects missing changed file", malformed.isError === true);
	await tool(first, "add_path_step", {
		entry_id: "e",
		entry_title: "Entry",
		step: { id: "test", kind: "changed", path: "b.test.ts", note: "Test", focus: [], tests: [] },
	});
	await tool(first, "finish_review_path");
	await controller.refresh();
	await until(
		async () => document.body.innerText.includes('"status":"ready"'),
		"rendered ready snapshot"
	);
	check(
		"complete coverage ready and rendered",
		controller.getSnapshot().snapshot?.path?.status === "ready"
	);
	const reviewed = await rpc.start.mutate({ identity, agent, alsoReview: true });
	await tool(reviewed, "add_review_finding", {
		file_path: "a.ts",
		line_number: 1,
		side: "RIGHT",
		body: "Local finding",
		category: "Correctness",
	});
	await tool(reviewed, "set_review_summary", { summary: "Local summary" });
	await tool(reviewed, "finish_review_path");
	const local = await fixture.command("inspect");
	check(
		"findings and summary local draft ready",
		local.comments.length === 1 &&
			local.drafts[0]?.summaryMarkdown === "Local summary" &&
			local.drafts[0]?.status === "ready"
	);
	const q1 = await rpc.ask.mutate({
		identity,
		id: "q1",
		text: "First?",
		anchor: { path: "a.ts", side: "RIGHT", startLine: 1, endLine: 1 },
	});
	const q2 = await rpc.ask.mutate({ identity, id: "q2", text: "Second?" });
	await tool(q2, "answer_question", { question_id: "q2", text: "Second answer" });
	await tool(q1, "answer_question", { question_id: "q1", text: "First answer" });
	const conversation = await rpc.get.query({ identity });
	check(
		"out-of-order answers retain question identity",
		conversation.questions.find((q) => q.id === "q1")?.answer?.text === "First answer" &&
			conversation.questions.find((q) => q.id === "q2")?.answer?.text === "Second answer"
	);
	const selected = selectAskConversation(conversation);
	check(
		"current conversation inherits each answer's anchor",
		selected.messages.find((m) => m.text === "First answer")?.anchor?.path === "a.ts"
	);
	const active = await rpc.start.mutate({ identity, agent, alsoReview: false });
	check(
		"remap hides historical answers from current conversation",
		selectAskConversation(active.snapshot).messages.length === 0 &&
			active.snapshot.messages.length > 0
	);
	const beforeAttach = (await fixture.command("inspect")).writes.length;
	const attached = await fixture.attach(active.launch!.terminalId);
	check(
		"native terminal attachment reuses owned PTY without second launch",
		attached.wasAttached === true &&
			(await fixture.command("inspect")).writes.length === beforeAttach,
		attached
	);
	await fixture.command("exit", active.launch!.terminalId);
	await until(async () => {
		await controller.refresh();
		return (
			controller.getSnapshot().snapshot?.runs.find((r) => r.id === active.run.id)?.state ===
			"failed"
		);
	}, "attached terminal exit reconciliation");
	check(
		"terminal attachment cannot hide agent exit",
		controller.getSnapshot().snapshot?.path?.error?.includes("interrupted") === true ||
			controller.getSnapshot().snapshot?.path?.error?.includes("exited") === true
	);
	const reconnectRun = await rpc.start.mutate({ identity, agent, alsoReview: false });
	await fixture.attach(reconnectRun.launch!.terminalId);
	const beforeReconnect = (await fixture.command("inspect")).writes.length;
	await fixture.command("disconnect");
	const offlineSnapshot = await rpc.get.query({ identity });
	check(
		"daemon disconnect alone does not invent agent failure",
		offlineSnapshot.runs.find((r) => r.id === reconnectRun.run.id)?.state === "running"
	);
	await fixture.command("reconnect");
	const reattached = await fixture.attach(reconnectRun.launch!.terminalId);
	check(
		"native daemon reconnect reattaches without relaunch",
		reattached.wasAttached === true &&
			(await fixture.command("inspect")).writes.length === beforeReconnect,
		reattached
	);
	await rpc.cancel.mutate({ identity, id: reconnectRun.run.id, version: reconnectRun.run.version });
	// Hold the actual daemon inventory boundary; cancel via registered RPC while launch is suspended.
	await fixture.command("hold-inventory");
	const preparing = rpc.start.mutate({ identity, agent, alsoReview: true }).then(
		(value) => ({ value }),
		(error) => ({ error: String(error) })
	);
	await until(async () => (await fixture.command("inspect")).inventoryEntered, "inventory hold");
	const during = await fixture.command("inspect");
	const pending = during.runs.find((r: any) => r.kind === "mapping");
	await rpc.cancel.mutate({ identity, id: pending.id, version: pending.version });
	await fixture.command("release-inventory");
	const cancelled = await preparing;
	const afterCancel = await fixture.command("inspect");
	check(
		"cancel during native inventory rejects late launch and leaves no active draft",
		!!("error" in cancelled) &&
			afterCancel.writes.length === during.writes.length &&
			!afterCancel.drafts.some((d: any) => d.status === "in_progress")
	);
	for (const stage of ["provider", "create"]) {
		await fixture.command(`hold-${stage}`);
		const writesBefore = (await fixture.command("inspect")).writes.length;
		const launching = rpc.start.mutate({ identity, agent, alsoReview: true }).then(
			(value) => ({ value }),
			(error) => ({ error: String(error) })
		);
		await until(async () => (await fixture.command("inspect"))[`${stage}Entered`], `${stage} hold`);
		const run = (await fixture.command("inspect")).runs.find((r: any) => r.kind === "mapping");
		await rpc.cancel.mutate({ identity, id: run.id, version: run.version });
		await fixture.command(`release-${stage}`);
		const outcome = await launching;
		const inspected = await fixture.command("inspect");
		check(
			`cancel during ${stage} rejects launch without late prompt or active draft`,
			"error" in outcome &&
				inspected.writes.length === writesBefore &&
				!inspected.drafts.some((d: any) => d.status === "in_progress") &&
				!inspected.sessionRows.some((row: any) => row.id === `review-path:${run.id}:${run.version}`)
		);
		await until(
			async () =>
				!(await fixture.command("inspect")).sessions.some(
					(s: any) => s.id === `review-path:${run.id}:${run.version}`
				),
			`${stage} terminal cleanup`
		);
	}
	// Simultaneous operations share the actual renderer controller; both native launches must be delivered.
	await fixture.command("hold-inventory");
	const mapping = controller.start(agent, false);
	await until(
		async () => (await fixture.command("inspect")).inventoryEntered,
		"concurrent map inventory"
	);
	const asking = controller.ask("concurrent", "Can I ask while mapping?");
	await until(
		async () =>
			(await fixture.command("inspect")).runs.some((r: any) => r.questionId === "concurrent"),
		"concurrent question"
	);
	await fixture.command("release-inventory");
	const [mapResult, askResult] = await Promise.all([mapping, asking]);
	check(
		"simultaneous Map and Ask both deliver terminal attachment descriptors",
		!!mapResult?.launch && !!askResult?.launch,
		{ mapDelivered: !!mapResult?.launch, askDelivered: !!askResult?.launch }
	);
	const concurrent = await rpc.get.query({ identity });
	check(
		"simultaneous mapping and question both survive durably",
		concurrent.runs.filter((r) => r.state === "running").length === 2
	);
	for (const run of concurrent.runs.filter((r) => r.state === "running"))
		await rpc.cancel.mutate({ identity, id: run.id, version: run.version });
	await fixture.command("provider-failure", true);
	await controller.start(agent, false);
	check(
		"provider failure is truthful and produces no run",
		controller.getSnapshot().error?.includes("temporarily unavailable") === true &&
			(await fixture.command("inspect")).runs.length === 0
	);
	await fixture.command("provider-failure", false);
	await controller.refresh();
	check("provider reconnect restores availability", controller.getSnapshot().available);
	for (const i of [
		{ ...identity, workspaceId: "w2" },
		{ ...identity, workspaceId: "bb", provider: "bitbucket" as const },
	]) {
		const snapshot = await rpc.get.query({ identity: i });
		check(
			`scope isolation ${i.workspaceId}`,
			snapshot.path === null && snapshot.messages.length === 0
		);
	}
	let unlinked = false;
	try {
		await rpc.start.mutate({
			identity: { ...identity, workspaceId: "unlinked" },
			agent,
			alsoReview: false,
		});
	} catch {
		unlinked = true;
	}
	check("unlinked review workspace rejected", unlinked);
	check(
		"closed provider PR allows local Map and Ask",
		first.run.state === "running" && q1.run.kind === "question"
	);
	const { second, third } = await fixture.command("revisions");
	const secondIdentity = { ...identity, headSha: second };
	const thirdIdentity = { ...identity, headSha: third };
	await fixture.command("hold-inventory");
	const beforeHead = (await fixture.command("inspect")).writes.length;
	const headLaunch = rpc.start.mutate({ identity, agent, alsoReview: true }).then(
		(value) => ({ value }),
		(error) => ({ error: String(error) })
	);
	await until(
		async () => (await fixture.command("inspect")).inventoryEntered,
		"head-change inventory"
	);
	await fixture.command("head", second);
	await rpc.get.query({ identity: secondIdentity });
	await fixture.command("release-inventory");
	const headOutcome = await headLaunch;
	const headState = await fixture.command("inspect");
	check(
		"observed head change during inventory prevents late prompt and active draft",
		"error" in headOutcome &&
			headState.writes.length === beforeHead &&
			!headState.drafts.some((d: any) => d.status === "in_progress")
	);
	const secondMap = await rpc.start.mutate({ identity: secondIdentity, agent, alsoReview: false });
	await tool(secondMap, "get_review_path");
	await fixture.command("head", third);
	await rpc.get.query({ identity: thirdIdentity });
	check(
		"observed head change fences authenticated old MCP callback",
		(await tool(secondMap, "finish_review_path")).isError === true
	);
	// Native adversarial provider read: old response is already captured before the newer read settles.
	await fixture.command("head", second);
	await fixture.command("hold-provider", 1);
	const lateRead = rpc.get.query({ identity: secondIdentity });
	await until(async () => (await fixture.command("inspect")).providerEntered, "old read capture");
	await fixture.command("head", identity.headSha);
	await rpc.get.query({ identity });
	const latest = await rpc.start.mutate({ identity, agent, alsoReview: false });
	await fixture.command("release-provider");
	await lateRead;
	// Inspect through a same-head local get would hide rollback by correcting it; inspect the durable run directly.
	const currentState = await fixture.command("inspect");
	check(
		"late provider read preserves newer native mapping",
		currentState.runs.some((r: any) => r.id === latest.run.id),
		{ newerStillActive: currentState.runs.some((r: any) => r.id === latest.run.id) }
	);
	await fixture.complete({ checks: results });
}
void run().catch((error) =>
	fixture.complete({ checks: results, error: String(error), stack: error.stack })
);
