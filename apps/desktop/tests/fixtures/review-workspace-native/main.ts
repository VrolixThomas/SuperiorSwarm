import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, app, ipcMain, session } from "electron";
import { z } from "zod";
import { ReviewSnapshotService } from "../../../src/main/review-explanation/snapshot";
import { publicProcedure, router } from "../../../src/main/trpc";
import { setupTRPCIPC } from "../../../src/main/trpc/ipc-link";
import { createReviewExplanationRouter } from "../../../src/main/trpc/routers/review-explanation";
import { details, mappedPath, settings } from "./data";
const root = process.env["SS_UI_ROOT"]!;
if (!root) throw Error("Dedicated fixture directory required");
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
app.setPath("crashDumps", join(root, "profile"));
app.setAppLogsPath(join(root, "profile/logs"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-background-networking");
let win: BrowserWindow;
const calls: { path: string; input: unknown }[] = [];
const forbidden: string[] = [];
const pr = details(process.env["SS_UI_HEAD"]!, process.env["SS_UI_BASE"]!);
let account = "42";
let askError = false;
const snapshot: any = {
	identity: {
		workspaceId: "registered",
		provider: "github",
		owner: "fixture",
		repo: "repo",
		prNumber: 1,
		headSha: pr.headCommitOid,
	},
	path: null,
	pathVersion: 0,
	conversationId: "conversation",
	runs: [],
	questions: [],
	messages: [],
};
let viewed: string[] = [];
const draft: any = {
	id: "draft",
	prProvider: "github",
	prIdentifier: "fixture/repo#1",
	status: "ready",
	createdAt: new Date().toISOString(),
	summary: "Validation findings",
	comments: [
		{
			id: "finding",
			filePath: "src/alpha.ts",
			lineNumber: 3,
			side: "RIGHT",
			body: "Check the validation result before returning.",
			status: "pending",
			createdAt: new Date(),
			source: "ai",
		},
	],
};
const record = (path: string, fn: (input: any) => unknown) =>
	publicProcedure.input(z.any().optional()).query(({ input }) => {
		calls.push({ path, input });
		return fn(input);
	});
const mutate = (path: string, fn: (input: any) => unknown) =>
	publicProcedure.input(z.any().optional()).mutation(({ input }) => {
		calls.push({ path, input });
		return fn(input);
	});
async function start() {
	await app.whenReady();
	session.defaultSession.webRequest.onBeforeRequest((d, cb) =>
		cb({
			cancel:
				!d.url.startsWith("file:") &&
				!d.url.startsWith("devtools:") &&
				!d.url.startsWith("data:") &&
				!d.url.startsWith("blob:"),
		})
	);
	setupTRPCIPC(
		router({
			reviewExplanation: createReviewExplanationRouter(
				new ReviewSnapshotService({
					resolveRoot: async (id) => {
						if (id !== "registered") throw Error("Unknown workspace");
						return join(root, "repo");
					},
				})
			),
			projects: router({
				getPRDetails: record("projects.getPRDetails", () => pr),
				getByRepo: record("projects.getByRepo", () => [
					{
						id: "project",
						repoPath: join(root, "repo"),
						remoteHost: "github.com",
						defaultBranch: "main",
					},
				]),
			}),
			github: router({
				getStatus: record("github.getStatus", () => ({ connected: true, accountId: account })),
				getCurrentReviewer: record("github.getCurrentReviewer", (i) => ({
					...i,
					provider: "github",
					status: "available",
					identity: { id: account, login: "verified" },
				})),
				getMyPRs: record("github.getMyPRs", () =>
					[1, 2, 3].map((number) => ({
						number,
						repoOwner: "fixture",
						repoName: "repo",
						title: `Disposable PR ${number}`,
						role: "reviewer",
						state: "open",
						branchName: "change",
					}))
				),
				getViewedFiles: record("github.getViewedFiles", () => viewed),
				markFileViewed: mutate("github.markFileViewed", (i) => {
					viewed = i.viewed ? [...viewed, i.filePath] : viewed.filter((p) => p !== i.filePath);
					return { success: true };
				}),
			}),
			atlassian: router({
				getStatus: record("atlassian.getStatus", () => ({ bitbucket: { connected: false } })),
			}),
			prPoller: router({ getCachedPRs: record("prPoller.getCachedPRs", () => []) }),
			aiReview: router({
				submitReview: mutate("aiReview.submitReview", () => ({
					success: true,
					postedCount: 1,
					failedCount: 0,
					skippedCount: 0,
					errors: [],
					verdictSubmitted: true,
				})),
				getSettings: record("aiReview.getSettings", () => ({ cliPreset: "codex" })),
				getReviewDrafts: record("aiReview.getReviewDrafts", () => [draft]),
				getReviewDraft: record("aiReview.getReviewDraft", () => draft),
				getReviewChain: record("aiReview.getReviewChain", () => []),
				updateDraftComment: mutate("aiReview.updateDraftComment", (i) => {
					Object.assign(draft.comments.find((c: any) => c.id === i.commentId) ?? {}, i);
					return { success: true };
				}),
				addUserComment: mutate("aiReview.addUserComment", (i) => ({ id: "local-comment", ...i })),
				deleteDraftComment: mutate("aiReview.deleteDraftComment", () => ({ success: true })),
			}),
			reviewPath: router({
				get: record("reviewPath.get", () => snapshot),
				getSettings: record("reviewPath.getSettings", () => settings),
				importLegacySettings: mutate("reviewPath.importLegacySettings", () => settings),
				updateSettings: mutate("reviewPath.updateSettings", (i) => Object.assign(settings, i)),
				start: mutate("reviewPath.start", () => {
					snapshot.path = mappedPath(pr.headCommitOid!, "mapping");
					snapshot.pathVersion++;
					return { snapshot };
				}),
				cancel: mutate("reviewPath.cancel", () => {
					snapshot.path.status = "cancelled";
					return snapshot;
				}),
				ask: mutate("reviewPath.ask", (i) => {
					if (askError) throw Error("Controlled provider unavailable");
					const run = {
						id: `run-${i.id}`,
						version: 1,
						kind: "question",
						questionId: i.id,
						state: "running",
						identity: snapshot.identity,
						conversationId: snapshot.conversationId,
					};
					const question = {
						id: i.id,
						runId: run.id,
						runVersion: 1,
						conversationId: snapshot.conversationId,
						state: "pending",
						message: { id: i.id, role: "user", text: i.text, anchor: i.anchor },
					};
					snapshot.runs.push(run);
					snapshot.questions.push(question);
					snapshot.messages.push(question.message);
					return { run, question, snapshot };
				}),
				cancelQuestion: mutate("reviewPath.cancelQuestion", (i) => {
					snapshot.questions.find((q: any) => q.runId === i.id).state = "cancelled";
					return snapshot;
				}),
				addContext: mutate("reviewPath.addContext", () => snapshot),
				removeContext: mutate("reviewPath.removeContext", () => snapshot),
			}),
			workspaces: router({
				getOrCreateReview: mutate("workspaces.getOrCreateReview", () => ({
					id: "registered",
					worktreePath: join(root, "repo"),
				})),
				attachTerminal: mutate("workspaces.attachTerminal", () => ({ success: true })),
			}),
		})
	);
	ipcMain.handle("fixture:forbidden", (_, s) => {
		forbidden.push(s);
		throw Error("Forbidden fixture operation");
	});
	ipcMain.handle("fixture:control", (_, command, value) => {
		if (command === "resetFinding") {
			draft.comments[0].status = "pending";
		}
		if (command === "mapped") snapshot.path = mappedPath(pr.headCommitOid!);
		if (command === "mapping") snapshot.path = mappedPath(pr.headCommitOid!, "mapping");
		if (command === "account") account = value;
		if (command === "askError") askError = value;
		if (command === "head") pr.headCommitOid = value;
		if (command === "answer") {
			const q = snapshot.questions.at(-1);
			q.state = "answered";
			q.answer = {
				id: `answer-${q.id}`,
				role: "agent",
				text: "The check rejects invalid input.",
				anchor: q.message.anchor,
				refs: [{ path: "src/beta.ts", line: 3, description: "Validation consumer" }],
			};
			snapshot.messages.push(q.answer);
			snapshot.runs.at(-1).state = "completed";
		}
		if (command === "failed") {
			const q = snapshot.questions.at(-1);
			q.state = "failed";
			q.error = "Controlled agent failure";
			snapshot.runs.at(-1).state = "failed";
		}
		return { calls, forbidden, snapshot };
	});
	ipcMain.handle("fixture:input", (_, event) => win.webContents.sendInputEvent(event));
	ipcMain.handle("fixture:capture", async (_, name) => {
		mkdirSync(join(root, "screenshots"), { recursive: true });
		writeFileSync(
			join(root, "screenshots", `${name}.png`),
			(await win.webContents.capturePage()).toPNG()
		);
		return true;
	});
	ipcMain.handle("fixture:complete", (_, result) => {
		writeFileSync(join(root, "result.json"), JSON.stringify({ result, calls, forbidden }, null, 2));
		app.exit(0);
	});
	win = new BrowserWindow({
		show: false,
		width: 1512,
		height: 945,
		useContentSize: true,
		webPreferences: { contextIsolation: true, sandbox: true, preload: join(root, "preload.cjs") },
	});
	win.webContents.on("console-message", (_, level, message) => {
		if (level >= 2) console.error(message);
	});
	await win.loadFile(join(root, "index.html"));
	setTimeout(async () => {
		console.error("Stalled", await win.webContents.executeJavaScript("document.body.innerText"));
		app.exit(1);
	}, 90000).unref();
}
void start().catch((e) => {
	console.error(e);
	app.exit(1);
});
