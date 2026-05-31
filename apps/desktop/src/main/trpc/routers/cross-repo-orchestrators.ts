import { z } from "zod";
import {
	addProjectToCrossRepoOrchestrator,
	attachToCrossRepoOrchestrator,
	detachFromCrossRepoOrchestrator,
	listCrossRepoMembers,
	listLinkedProjects,
	removeProjectFromCrossRepoOrchestrator,
} from "../../services/cross-repo-orchestrator-membership";
import {
	createCrossRepoOrchestrator,
	deleteCrossRepoOrchestrator,
	dispatchAcrossRepos,
	getCoordinatorLaunch,
	getCrossRepoOrchestrator,
	listCrossRepoOrchestrators,
	markAgentStarted,
	renameCrossRepoOrchestrator,
	stopCrossRepoOrchestratorAgent,
} from "../../services/cross-repo-orchestrators";
import { publicProcedure, router } from "../index";

export const crossRepoOrchestratorsRouter = router({
	list: publicProcedure.query(() => listCrossRepoOrchestrators()),

	get: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => getCrossRepoOrchestrator(input)),

	create: publicProcedure
		.input(
			z.object({
				name: z.string().min(1).max(120),
				agentKind: z.enum(["claude", "codex", "gemini", "opencode"]),
			})
		)
		.mutation(({ input }) => createCrossRepoOrchestrator(input)),

	rename: publicProcedure
		.input(z.object({ id: z.string(), name: z.string().min(1).max(120) }))
		.mutation(({ input }) => renameCrossRepoOrchestrator(input)),

	delete: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => deleteCrossRepoOrchestrator(input)),

	listLinkedProjects: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => listLinkedProjects({ orchestratorId: input.id })),

	linkProject: publicProcedure
		.input(z.object({ id: z.string(), projectId: z.string() }))
		.mutation(({ input }) =>
			addProjectToCrossRepoOrchestrator({ orchestratorId: input.id, projectId: input.projectId })
		),

	unlinkProject: publicProcedure
		.input(z.object({ id: z.string(), projectId: z.string() }))
		.mutation(({ input }) =>
			removeProjectFromCrossRepoOrchestrator({
				orchestratorId: input.id,
				projectId: input.projectId,
			})
		),

	listMembers: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => listCrossRepoMembers({ orchestratorId: input.id })),

	attachMember: publicProcedure
		.input(z.object({ id: z.string(), workspaceId: z.string() }))
		.mutation(({ input }) =>
			attachToCrossRepoOrchestrator({
				orchestratorId: input.id,
				workspaceId: input.workspaceId,
			})
		),

	detachMember: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.mutation(({ input }) => detachFromCrossRepoOrchestrator(input)),

	getCoordinatorLaunch: publicProcedure
		.input(z.object({ id: z.string() }))
		.query(({ input }) => getCoordinatorLaunch(input)),

	markAgentStarted: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => markAgentStarted(input)),

	stopAgent: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => stopCrossRepoOrchestratorAgent(input)),

	dispatch: publicProcedure
		.input(
			z.object({
				id: z.string(),
				task: z.string().min(1).max(8000),
				targets: z
					.array(z.object({ projectId: z.string(), branch: z.string().min(1).max(200) }))
					.min(1),
			})
		)
		.mutation(({ input }) =>
			dispatchAcrossRepos({
				orchestratorId: input.id,
				task: input.task,
				targets: input.targets,
			})
		),
});
