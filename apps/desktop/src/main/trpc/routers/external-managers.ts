import { app } from "electron";
import { z } from "zod";
import { probeCliInPath } from "../../services/cli-probe";
import {
	MANAGER_TOKEN_PLACEHOLDER,
	createExternalManager,
	deleteExternalManager,
	hermesConfigPath,
	hermesSnippetTemplate,
	installIntoHermesConfig,
	listExternalManagers,
	regenerateExternalManagerToken,
	renameExternalManager,
	setExternalManagerDispatchPolicy,
	uninstallFromHermesConfig,
} from "../../services/external-managers";
import { launcherPath } from "../../services/global-mcp-launcher";
import { publicProcedure, router } from "../index";

const dispatchPolicySchema = z.enum(["confirm", "auto"]);

export const externalManagersRouter = router({
	list: publicProcedure.query(() => listExternalManagers()),

	/** Static info the settings UI needs to render config snippets. */
	installInfo: publicProcedure.query(async () => ({
		launcherPath: launcherPath(app.getPath("userData")),
		hermesConfigPath: hermesConfigPath(),
		hermesDetected: await probeCliInPath("hermes"),
		hermesSnippetTemplate: hermesSnippetTemplate(),
		managerTokenPlaceholder: MANAGER_TOKEN_PLACEHOLDER,
	})),

	create: publicProcedure
		.input(
			z.object({
				name: z.string().min(1).max(120),
				projectIds: z.array(z.string()).default([]),
				dispatchPolicy: dispatchPolicySchema.default("confirm"),
			})
		)
		.mutation(({ input }) => createExternalManager(input)),

	rename: publicProcedure
		.input(z.object({ id: z.string(), name: z.string().min(1).max(120) }))
		.mutation(({ input }) => renameExternalManager(input)),

	setDispatchPolicy: publicProcedure
		.input(z.object({ id: z.string(), dispatchPolicy: dispatchPolicySchema }))
		.mutation(({ input }) => setExternalManagerDispatchPolicy(input)),

	regenerateToken: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => regenerateExternalManagerToken(input)),

	delete: publicProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ input }) => deleteExternalManager(input)),

	installIntoHermes: publicProcedure
		.input(z.object({ managerToken: z.string().min(1) }))
		.mutation(({ input }) => installIntoHermesConfig({ managerToken: input.managerToken })),

	uninstallFromHermes: publicProcedure.mutation(() => uninstallFromHermesConfig({})),
});
