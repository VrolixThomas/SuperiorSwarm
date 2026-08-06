import { asc, eq } from "drizzle-orm";
import { shell } from "electron";
import { z } from "zod";
import { getDb } from "../../db";
import { hermesSessionWorkspaces, projects, workspaces, worktrees } from "../../db/schema";
import {
	deleteHermesConnection,
	listHermesConnections,
	saveHermesConnection,
} from "../../hermes/hermes-connections";
import { hermesRuntimeService } from "../../hermes/hermes-runtime-service";
import {
	linkHermesWorkspace,
	listHermesWorkspaceLinks,
	unlinkHermesWorkspace,
} from "../../hermes/hermes-workspace-links";
import { publicProcedure, router } from "../index";

const connectionSessionInput = z.object({
	connectionId: z.string().min(1),
	hermesSessionId: z.string().min(1),
});

function rendererOriginReportState(state: ReturnType<typeof hermesRuntimeService.reports>[number]) {
	return {
		turnId: state.turnId,
		status: state.status,
		retryable: state.retryable,
		updatedAt: state.updatedAt,
	};
}

export const hermesRouter = router({
	connections: publicProcedure.query(() => listHermesConnections()),

	saveConnection: publicProcedure
		.input(
			z.object({
				id: z.string().optional(),
				label: z.string().trim().min(1).max(120),
				baseUrl: z.string().trim().min(1).max(2_000),
				profileId: z.string().trim().min(1).max(120).default("default"),
				token: z.string().max(8_192).optional(),
			})
		)
		.mutation(({ input }) => saveHermesConnection(input)),

	deleteConnection: publicProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ input }) => {
			hermesRuntimeService.disconnect(input.id);
			deleteHermesConnection(input.id);
			return { ok: true as const };
		}),

	connect: publicProcedure
		.input(z.object({ connectionId: z.string().min(1) }))
		.mutation(({ input }) => hermesRuntimeService.connect(input.connectionId)),

	disconnect: publicProcedure
		.input(z.object({ connectionId: z.string().min(1) }))
		.mutation(({ input }) => {
			hermesRuntimeService.disconnect(input.connectionId);
			return { ok: true as const };
		}),

	status: publicProcedure
		.input(z.object({ connectionId: z.string().min(1) }))
		.query(({ input }) => hermesRuntimeService.getState(input.connectionId)),

	catalog: publicProcedure
		.input(z.object({ connectionId: z.string().min(1) }))
		.query(({ input }) => hermesRuntimeService.catalog(input.connectionId)),

	resume: publicProcedure.input(connectionSessionInput).mutation(async ({ input }) => {
		const resumed = await hermesRuntimeService.resume(input.connectionId, input.hermesSessionId);
		return {
			canonicalSessionId: resumed.canonicalSessionId,
			runtimeSessionId: resumed.runtimeSessionId,
			claimId: resumed.claimId,
		};
	}),

	history: publicProcedure
		.input(connectionSessionInput)
		.query(({ input }) => hermesRuntimeService.history(input.connectionId, input.hermesSessionId)),

	submit: publicProcedure
		.input(connectionSessionInput.extend({ text: z.string().trim().min(1).max(200_000) }))
		.mutation(({ input }) =>
			hermesRuntimeService.submit(input.connectionId, input.hermesSessionId, input.text)
		),

	interrupt: publicProcedure
		.input(connectionSessionInput)
		.mutation(({ input }) =>
			hermesRuntimeService.interrupt(input.connectionId, input.hermesSessionId)
		),

	release: publicProcedure
		.input(connectionSessionInput)
		.mutation(({ input }) =>
			hermesRuntimeService.release(input.connectionId, input.hermesSessionId)
		),

	unbind: publicProcedure
		.input(connectionSessionInput.extend({ expectedClaimId: z.string().min(1) }))
		.mutation(({ input }) =>
			hermesRuntimeService.unbind(input.connectionId, input.hermesSessionId, input.expectedClaimId)
		),

	respondApproval: publicProcedure
		.input(
			connectionSessionInput.extend({
				requestId: z.string().min(1),
				choice: z.string().min(1).max(120),
			})
		)
		.mutation(({ input }) => hermesRuntimeService.respondToApproval(input)),

	respondClarification: publicProcedure
		.input(
			connectionSessionInput.extend({
				requestId: z.string().min(1),
				answer: z.string().max(200_000),
			})
		)
		.mutation(({ input }) => hermesRuntimeService.respondToClarification(input)),

	events: publicProcedure
		.input(z.object({ connectionId: z.string().min(1), afterSeq: z.number().int().min(0) }))
		.query(({ input }) => hermesRuntimeService.events(input.connectionId, input.afterSeq)),

	origin: publicProcedure.input(connectionSessionInput).query(async ({ input }) => {
		const origin = await hermesRuntimeService.origin(input.connectionId, input.hermesSessionId);
		return {
			displayLabel: origin.displayLabel,
			canOpen: origin.canOpen,
			canReport: origin.canReport,
		};
	}),

	openOrigin: publicProcedure.input(connectionSessionInput).mutation(async ({ input }) => {
		const origin = await hermesRuntimeService.origin(input.connectionId, input.hermesSessionId);
		if (!origin.canOpen || !origin.permalink)
			throw new Error("This Hermes origin cannot be opened");
		const url = new URL(origin.permalink);
		if (url.protocol !== "https:" && url.protocol !== "http:") {
			throw new Error("Hermes returned an unsupported origin link");
		}
		await shell.openExternal(url.toString());
		return { opened: true as const };
	}),

	reportToOrigin: publicProcedure
		.input(
			connectionSessionInput.extend({
				turnId: z.string().min(1),
			})
		)
		.mutation(async ({ input }) =>
			rendererOriginReportState(await hermesRuntimeService.reportToOrigin(input))
		),

	reports: publicProcedure
		.input(connectionSessionInput)
		.query(({ input }) =>
			hermesRuntimeService
				.reports(input.connectionId, input.hermesSessionId)
				.map(rendererOriginReportState)
		),

	workspaceLinks: publicProcedure
		.input(connectionSessionInput)
		.query(({ input }) => listHermesWorkspaceLinks(input.connectionId, input.hermesSessionId)),

	workspaceLinkIndex: publicProcedure
		.input(z.object({ connectionId: z.string().min(1) }))
		.query(({ input }) => {
			const rows = getDb()
				.select({
					sessionId: hermesSessionWorkspaces.hermesSessionId,
					branch: worktrees.branch,
					projectName: projects.name,
				})
				.from(hermesSessionWorkspaces)
				.leftJoin(workspaces, eq(hermesSessionWorkspaces.workspaceId, workspaces.id))
				.leftJoin(projects, eq(workspaces.projectId, projects.id))
				.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
				.where(eq(hermesSessionWorkspaces.connectionId, input.connectionId))
				.all();
			const result: Record<string, { count: number; branches: string[]; projectNames: string[] }> =
				{};
			for (const row of rows) {
				const entry = result[row.sessionId] ?? { count: 0, branches: [], projectNames: [] };
				entry.count++;
				if (row.branch && !entry.branches.includes(row.branch)) entry.branches.push(row.branch);
				if (row.projectName && !entry.projectNames.includes(row.projectName)) {
					entry.projectNames.push(row.projectName);
				}
				result[row.sessionId] = entry;
			}
			return result;
		}),

	linkWorkspace: publicProcedure
		.input(
			connectionSessionInput.extend({
				workspaceId: z.string().min(1),
				lineageRootId: z.string().nullable().optional(),
			})
		)
		.mutation(({ input }) => {
			const workspace = getDb()
				.select({ id: workspaces.id })
				.from(workspaces)
				.where(eq(workspaces.id, input.workspaceId))
				.get();
			if (!workspace) throw new Error("Workspace not found");
			return linkHermesWorkspace({
				connectionId: input.connectionId,
				hermesSessionId: input.hermesSessionId,
				hermesLineageRootId: input.lineageRootId,
				workspaceId: input.workspaceId,
				source: "manual",
			});
		}),

	unlinkWorkspace: publicProcedure
		.input(connectionSessionInput.extend({ workspaceId: z.string().min(1) }))
		.mutation(({ input }) => {
			unlinkHermesWorkspace(input.connectionId, input.hermesSessionId, input.workspaceId);
			return { ok: true as const };
		}),

	availableWorkspaces: publicProcedure.query(() =>
		getDb()
			.select({
				id: workspaces.id,
				name: workspaces.name,
				type: workspaces.type,
				projectId: projects.id,
				projectName: projects.name,
				repoPath: projects.repoPath,
				folderPath: workspaces.folderPath,
				worktreePath: worktrees.path,
				branch: worktrees.branch,
			})
			.from(workspaces)
			.innerJoin(projects, eq(workspaces.projectId, projects.id))
			.leftJoin(worktrees, eq(workspaces.worktreeId, worktrees.id))
			.orderBy(asc(projects.name), asc(workspaces.name))
			.all()
			.filter((workspace) => workspace.type !== "review")
			.map((workspace) => ({
				...workspace,
				cwd: workspace.worktreePath ?? workspace.folderPath ?? workspace.repoPath,
			}))
	),
});
