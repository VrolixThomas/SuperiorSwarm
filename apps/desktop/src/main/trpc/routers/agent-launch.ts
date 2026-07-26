import { z } from "zod";
import { CLI_PRESET_NAMES, type CliPresetName } from "../../../shared/cli-preset";
import { buildAgentLaunchScript, writeAgentLaunchScript } from "../../agent-launch/launch-script";
import { listAgentSessionsForCwd } from "../../agent-launch/session-stores";
import { getWorkspaceCwdOrThrow } from "../../agent-launch/workspace-cwd-lookup";
import { probeCliInPath } from "../../services/cli-probe";
import { detectInstalledClis } from "../../services/global-mcp-install";
import { publicProcedure, router } from "../index";

// Probes shell out with a 5s timeout each; cache for the app lifetime.
let installedCache: Promise<CliPresetName[]> | null = null;

export const agentLaunchRouter = router({
	listSessions: publicProcedure
		.input(z.object({ workspaceId: z.string() }))
		.query(({ input }) => listAgentSessionsForCwd(getWorkspaceCwdOrThrow(input.workspaceId), 10)),

	installedClis: publicProcedure.query(() => {
		installedCache ??= detectInstalledClis(probeCliInPath).catch((err) => {
			installedCache = null;
			throw err;
		});
		return installedCache;
	}),

	buildLaunch: publicProcedure
		.input(
			z.object({
				workspaceId: z.string(),
				cli: z.enum(CLI_PRESET_NAMES),
				prompt: z.string().min(1),
				resumeSessionId: z.string().optional(),
			})
		)
		.mutation(({ input }) => {
			const cwd = getWorkspaceCwdOrThrow(input.workspaceId);
			const content = buildAgentLaunchScript({
				cwd,
				cli: input.cli,
				prompt: input.prompt,
				resumeSessionId: input.resumeSessionId,
			});
			return { scriptPath: writeAgentLaunchScript(content), cwd };
		}),
});
