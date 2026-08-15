import { asc, eq } from "drizzle-orm";
import { dialog, shell } from "electron";
import { z } from "zod";
import {
	HERMES_MAX_ATTACHMENTS,
	HERMES_TAG_COLORS,
	hermesSessionIdentityKey,
} from "../../../shared/hermes";
import { getDb } from "../../db";
import {
	hermesConnections,
	hermesSessionWorkspaces,
	projects,
	workspaces,
	worktrees,
} from "../../db/schema";
import { hermesAttachmentStore } from "../../hermes/hermes-attachments";
import {
	getHermesComposerDraft,
	setHermesComposerDraft,
} from "../../hermes/hermes-composer-drafts";
import {
	deleteHermesConnection,
	ensureHermesLocalConnection,
	listHermesConnections,
	saveHermesConnectionWithDiscovery,
} from "../../hermes/hermes-connections";
import { validateHermesOriginOpenUrl } from "../../hermes/hermes-origin-resolver";
import { hermesRuntimeService } from "../../hermes/hermes-runtime-service";
import {
	HERMES_SESSION_TAG_LIMIT,
	HERMES_SESSION_TAG_MAX_LENGTH,
	HERMES_SESSION_TITLE_MAX_LENGTH,
} from "../../hermes/hermes-session-metadata";
import {
	linkHermesWorkspace,
	listHermesWorkspaceLinks,
	unlinkHermesWorkspace,
} from "../../hermes/hermes-workspace-links";
import { publicProcedure, router } from "../index";

const connectionSessionInput = z.object({
	connectionId: z.string().min(1),
	profileId: z.string().trim().min(1).max(120).optional(),
	hermesSessionId: z.string().min(1),
});

const managerConnectionSessionInput = connectionSessionInput
	.extend({ managerId: z.string().min(1).nullable() })
	.strict();

const managerConnectionInput = z
	.object({
		connectionId: z.string().min(1),
		managerId: z.string().min(1).nullable(),
	})
	.strict();

const workspaceSessionInput = connectionSessionInput.extend({
	profileId: z.string().trim().min(1).max(120),
});

const composerDraftScopeInput = z
	.object({
		connectionId: z.string().min(1),
		projectId: z.string().min(1).nullable(),
		profileId: z.string().trim().min(1).max(120),
		durableSessionId: z.string().min(1),
	})
	.strict();

function composerDraftIdentity(input: z.infer<typeof composerDraftScopeInput>) {
	const connection = getDb()
		.select({ managerId: hermesConnections.managerId })
		.from(hermesConnections)
		.where(eq(hermesConnections.id, input.connectionId))
		.get();
	if (!connection) throw new Error("Hermes connection not found");
	return {
		managerId: connection.managerId,
		projectId: input.projectId,
		connectionId: input.connectionId,
		profileId: input.profileId,
		durableSessionId: input.durableSessionId,
	};
}

const metadataSessionIdentityShape = {
	connectionId: z.string().min(1).max(200),
	profileId: z.string().trim().min(1).max(120),
	hermesSessionId: z.string().min(1).max(512),
};

export const hermesSetSessionTitleInputSchema = z
	.object({
		...metadataSessionIdentityShape,
		title: z.string().max(HERMES_SESSION_TITLE_MAX_LENGTH),
		expectedRevision: z.number().int().min(0),
	})
	.strict();

export const hermesSetSessionTagsInputSchema = z
	.object({
		...metadataSessionIdentityShape,
		tags: z.array(z.string().max(HERMES_SESSION_TAG_MAX_LENGTH)).max(HERMES_SESSION_TAG_LIMIT),
		expectedRevision: z.number().int().min(0),
	})
	.strict();

export const hermesSessionTagInputSchema = z
	.object({
		...metadataSessionIdentityShape,
		tag: z.string().max(HERMES_SESSION_TAG_MAX_LENGTH),
	})
	.strict();

const hermesTagDefinitionIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9_-]+$/);
const hermesTagNameSchema = z
	.string()
	.max(HERMES_SESSION_TAG_MAX_LENGTH)
	.refine((value) => value.trim().length > 0, "Tag cannot be empty");

export const hermesListTagDefinitionsInputSchema = z
	.object({ ...metadataSessionIdentityShape, query: z.string().max(100).default("") })
	.strict();
export const hermesUpsertTagDefinitionInputSchema = z
	.object({
		...metadataSessionIdentityShape,
		name: hermesTagNameSchema,
		color: z.enum(HERMES_TAG_COLORS),
	})
	.strict();
export const hermesUpdateTagDefinitionInputSchema = z
	.object({
		...metadataSessionIdentityShape,
		definitionId: hermesTagDefinitionIdSchema,
		name: hermesTagNameSchema.optional(),
		color: z.enum(HERMES_TAG_COLORS).optional(),
		expectedRevision: z.number().int().min(0),
	})
	.strict()
	.refine((value) => value.name !== undefined || value.color !== undefined, {
		message: "A name or color update is required",
	});
export const hermesDeleteTagDefinitionInputSchema = z
	.object({
		...metadataSessionIdentityShape,
		definitionId: hermesTagDefinitionIdSchema,
		expectedRevision: z.number().int().min(0),
	})
	.strict();
export const hermesTagAssignmentInputSchema = z
	.object({ ...metadataSessionIdentityShape, definitionId: hermesTagDefinitionIdSchema })
	.strict();

export const hermesCreateInputSchema = z
	.object({
		connectionId: z.string().min(1),
		topic: z.string().trim().min(1).max(200_000),
		profileId: z.string().trim().min(1).max(120).optional(),
	})
	.strict();

export const hermesSetSessionArchivedInputSchema = z
	.object({
		connectionId: z.string().min(1),
		profileId: z.string().trim().min(1).max(120),
		hermesSessionId: z.string().min(1),
		archived: z.boolean(),
	})
	.strict();

export const hermesDeleteSessionInputSchema = z
	.object({
		connectionId: z.string().min(1),
		profileId: z.string().trim().min(1).max(120),
		hermesSessionId: z.string().min(1),
		confirmed: z.literal(true),
	})
	.strict();

const submitInput = connectionSessionInput
	.extend({
		text: z.string().max(200_000),
		clientTurnId: z.string().trim().min(1).max(200).optional(),
		attachmentHandles: z.array(z.string().min(1).max(200)).max(HERMES_MAX_ATTACHMENTS).default([]),
	})
	.superRefine((input, context) => {
		if (input.text.trim() || input.attachmentHandles.length > 0) return;
		context.addIssue({
			code: "custom",
			message: "Enter a message or attach a file",
			path: ["text"],
		});
	});

function rendererOriginReportState(state: ReturnType<typeof hermesRuntimeService.reports>[number]) {
	return {
		connectionId: state.connectionId,
		hermesSessionId: state.hermesSessionId,
		messageId: state.messageId,
		status: state.status,
		retryable: state.retryable,
		errorCode: state.errorCode,
		attemptCount: state.attemptCount,
		updatedAt: state.updatedAt,
	};
}

export const hermesRouter = router({
	connections: publicProcedure.query(() => listHermesConnections()),

	composerDraft: publicProcedure
		.input(composerDraftScopeInput)
		.query(({ input }) => getHermesComposerDraft(composerDraftIdentity(input))),

	setComposerDraft: publicProcedure
		.input(composerDraftScopeInput.extend({ text: z.string().max(200_000) }))
		.mutation(({ input }) => {
			setHermesComposerDraft(composerDraftIdentity(input), input.text);
			return { ok: true as const };
		}),

	configureLocal: publicProcedure
		.input(
			z.object({
				id: z.string().min(1).optional(),
				profileId: z.string().trim().min(1).max(120).default("default"),
			})
		)
		.mutation(({ input }) => ensureHermesLocalConnection(input)),

	saveConnection: publicProcedure
		.input(
			z.object({
				id: z.string().optional(),
				label: z.string().trim().min(1).max(120),
				baseUrl: z.string().trim().min(1).max(2_000),
				profileId: z.string().trim().min(1).max(120).default("default"),
				token: z.string().max(8_192).optional(),
				managerId: z.string().min(1).nullable().optional(),
			})
		)
		.mutation(({ input }) => saveHermesConnectionWithDiscovery(input)),

	deleteConnection: publicProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(({ input }) => {
			hermesRuntimeService.forgetConnection(input.id);
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

	setSessionArchived: publicProcedure
		.input(hermesSetSessionArchivedInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.setSessionArchived(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.archived
			)
		),

	setSessionTitle: publicProcedure
		.input(hermesSetSessionTitleInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.setSessionTitle(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.title,
				input.expectedRevision
			)
		),

	setSessionTags: publicProcedure
		.input(hermesSetSessionTagsInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.setSessionTags(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.tags,
				input.expectedRevision
			)
		),

	addSessionTag: publicProcedure
		.input(hermesSessionTagInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.addSessionTag(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.tag
			)
		),

	removeSessionTag: publicProcedure
		.input(hermesSessionTagInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.removeSessionTag(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.tag
			)
		),

	tagDefinitions: publicProcedure
		.input(hermesListTagDefinitionsInputSchema)
		.query(({ input }) =>
			hermesRuntimeService.listTagDefinitions(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.query
			)
		),

	upsertTagDefinition: publicProcedure
		.input(hermesUpsertTagDefinitionInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.upsertTagDefinition(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.name,
				input.color
			)
		),

	updateTagDefinition: publicProcedure
		.input(hermesUpdateTagDefinitionInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.updateTagDefinition(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.definitionId,
				{
					name: input.name,
					color: input.color,
					expectedRevision: input.expectedRevision,
				}
			)
		),

	deleteTagDefinition: publicProcedure
		.input(hermesDeleteTagDefinitionInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.deleteTagDefinition(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.definitionId,
				input.expectedRevision
			)
		),

	assignTagDefinition: publicProcedure
		.input(hermesTagAssignmentInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.assignTagDefinition(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.definitionId
			)
		),

	unassignTagDefinition: publicProcedure
		.input(hermesTagAssignmentInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.unassignTagDefinition(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.definitionId
			)
		),

	deleteSession: publicProcedure
		.input(hermesDeleteSessionInputSchema)
		.mutation(({ input }) =>
			hermesRuntimeService.deleteSession(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.confirmed
			)
		),

	create: publicProcedure.input(hermesCreateInputSchema).mutation(({ input }) =>
		hermesRuntimeService.create(input.connectionId, {
			initialPrompt: input.topic,
			profileId: input.profileId,
		})
	),

	resume: publicProcedure.input(managerConnectionSessionInput).mutation(async ({ input }) => {
		const resumed = await hermesRuntimeService.resume(
			input.connectionId,
			input.hermesSessionId,
			input.profileId,
			input.managerId
		);
		return {
			durableSessionId: resumed.durableSessionId,
			runtimeSessionId: resumed.runtimeSessionId,
			persisted: resumed.persisted,
			activeTurnSnapshot: resumed.activeTurnSnapshot,
		};
	}),

	history: publicProcedure
		.input(managerConnectionSessionInput)
		.query(({ input }) =>
			hermesRuntimeService.history(
				input.connectionId,
				input.hermesSessionId,
				input.profileId,
				input.managerId
			)
		),

	historyRevision: publicProcedure
		.input(managerConnectionSessionInput)
		.query(({ input }) =>
			hermesRuntimeService.historyRevision(
				input.connectionId,
				input.hermesSessionId,
				input.profileId,
				input.managerId
			)
		),

	historyTail: publicProcedure
		.input(
			managerConnectionSessionInput.extend({
				limit: z.number().int().min(1).max(500).default(100),
			})
		)
		.query(({ input }) =>
			hermesRuntimeService.historyTail(
				input.connectionId,
				input.hermesSessionId,
				input.profileId,
				input.limit,
				input.managerId
			)
		),

	pickAttachments: publicProcedure.mutation(async () => {
		const selected = await dialog.showOpenDialog({
			properties: ["openFile", "multiSelections"],
			filters: [
				{
					name: "Images, PDFs, and files",
					extensions: [
						"png",
						"jpg",
						"jpeg",
						"gif",
						"webp",
						"bmp",
						"tif",
						"tiff",
						"heic",
						"heif",
						"avif",
						"pdf",
						"*",
					],
				},
			],
		});
		if (selected.canceled || selected.filePaths.length === 0) return [];
		return await hermesAttachmentStore.registerPaths(selected.filePaths);
	}),

	releaseAttachment: publicProcedure
		.input(z.object({ handle: z.string().min(1).max(200) }))
		.mutation(({ input }) => {
			hermesAttachmentStore.release([input.handle]);
			return { ok: true as const };
		}),

	submit: publicProcedure
		.input(submitInput)
		.mutation(({ input }) =>
			hermesRuntimeService.submitMessage(
				input.connectionId,
				input.hermesSessionId,
				input.text.trim(),
				input.attachmentHandles,
				input.profileId,
				input.clientTurnId
			)
		),

	followUps: publicProcedure
		.input(connectionSessionInput)
		.query(({ input }) =>
			hermesRuntimeService.followUps(input.connectionId, input.hermesSessionId, input.profileId)
		),

	retryFollowUp: publicProcedure
		.input(connectionSessionInput.extend({ followUpId: z.string().min(1).max(200) }))
		.mutation(({ input }) =>
			hermesRuntimeService.retryFollowUp(
				input.connectionId,
				input.hermesSessionId,
				input.followUpId,
				input.profileId
			)
		),

	cancelFollowUp: publicProcedure
		.input(connectionSessionInput.extend({ followUpId: z.string().min(1).max(200) }))
		.mutation(({ input }) =>
			hermesRuntimeService.cancelFollowUp(
				input.connectionId,
				input.hermesSessionId,
				input.followUpId,
				input.profileId
			)
		),

	interrupt: publicProcedure
		.input(connectionSessionInput)
		.mutation(({ input }) =>
			hermesRuntimeService.interrupt(input.connectionId, input.hermesSessionId, input.profileId)
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
		.input(managerConnectionInput.extend({ afterSeq: z.number().int().min(0) }))
		.query(({ input }) =>
			hermesRuntimeService.waitForEvents(input.connectionId, input.afterSeq, input.managerId)
		),

	origin: publicProcedure
		.input(connectionSessionInput)
		.query(({ input }) =>
			hermesRuntimeService.origin(input.connectionId, input.hermesSessionId, input.profileId)
		),

	openOrigin: publicProcedure.input(connectionSessionInput).mutation(async ({ input }) => {
		const openUrl = validateHermesOriginOpenUrl(
			await hermesRuntimeService.originOpenUrl(
				input.connectionId,
				input.hermesSessionId,
				input.profileId
			)
		);
		if (!openUrl) throw new Error("This Hermes origin link is not trusted");
		await shell.openExternal(openUrl);
		return { opened: true as const };
	}),

	saveOriginLink: publicProcedure
		.input(
			connectionSessionInput.extend({
				openUrl: z.string().trim().min(1).max(4_096),
			})
		)
		.mutation(({ input }) =>
			hermesRuntimeService.saveOriginLink(
				input.connectionId,
				input.hermesSessionId,
				input.openUrl,
				input.profileId
			)
		),

	reportToOrigin: publicProcedure
		.input(
			connectionSessionInput.extend({
				messageId: z.string().min(1),
				explicitRetry: z.boolean(),
			})
		)
		.mutation(async ({ input }) =>
			rendererOriginReportState(await hermesRuntimeService.reportToOrigin(input))
		),

	reports: publicProcedure
		.input(connectionSessionInput)
		.query(({ input }) =>
			hermesRuntimeService
				.reports(input.connectionId, input.hermesSessionId, input.profileId)
				.map(rendererOriginReportState)
		),

	workspaceLinks: publicProcedure
		.input(workspaceSessionInput)
		.query(({ input }) =>
			listHermesWorkspaceLinks(input.connectionId, input.profileId, input.hermesSessionId)
		),

	workspaceLinkIndex: publicProcedure
		.input(z.object({ connectionId: z.string().min(1) }))
		.query(({ input }) => {
			const rows = getDb()
				.select({
					sessionId: hermesSessionWorkspaces.hermesSessionId,
					profileId: hermesSessionWorkspaces.profileId,
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
				const identityKey = hermesSessionIdentityKey(row.profileId, row.sessionId);
				const entry = result[identityKey] ?? { count: 0, branches: [], projectNames: [] };
				entry.count++;
				if (row.branch && !entry.branches.includes(row.branch)) entry.branches.push(row.branch);
				if (row.projectName && !entry.projectNames.includes(row.projectName)) {
					entry.projectNames.push(row.projectName);
				}
				result[identityKey] = entry;
			}
			return result;
		}),

	linkWorkspace: publicProcedure
		.input(
			workspaceSessionInput.extend({
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
				profileId: input.profileId,
				hermesSessionId: input.hermesSessionId,
				hermesLineageRootId: input.lineageRootId,
				workspaceId: input.workspaceId,
				source: "manual",
			});
		}),

	unlinkWorkspace: publicProcedure
		.input(workspaceSessionInput.extend({ workspaceId: z.string().min(1) }))
		.mutation(({ input }) => {
			unlinkHermesWorkspace(
				input.connectionId,
				input.profileId,
				input.hermesSessionId,
				input.workspaceId
			);
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
