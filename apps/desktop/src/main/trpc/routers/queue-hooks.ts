import { z } from "zod";
import {
	exactProjectHook,
	fixProjectHook,
	projectHookFixTargets,
} from "../../activity-queue/hook-actions";
import {
	listProjectHookStatus,
	projectHooksEnabled,
	refreshProjectHookQueue,
	revokeProjectHookTrust,
	setProjectHooksEnabled,
	trustProjectHooks,
} from "../../activity-queue/hook-source";
import { publicProcedure, router } from "../index";

const receipt = z.object({ id: z.string().min(1), revision: z.number().int().positive() });
export const queueHooksRouter = router({
	status: publicProcedure.query(() => ({
		enabled: projectHooksEnabled(),
		projects: listProjectHookStatus(),
	})),
	setEnabled: publicProcedure.input(z.boolean()).mutation(({ input }) => {
		setProjectHooksEnabled(input);
		return { enabled: input };
	}),
	trust: publicProcedure
		.input(z.object({ projectId: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }))
		.mutation(({ input }) => trustProjectHooks(input.projectId, input.hash)),
	revoke: publicProcedure
		.input(z.object({ projectId: z.string() }))
		.mutation(({ input }) => revokeProjectHookTrust(input.projectId)),
	run: publicProcedure.input(z.object({ projectId: z.string() })).mutation(async ({ input }) => {
		await refreshProjectHookQueue(input.projectId, true);
		return { refreshed: true };
	}),
	open: publicProcedure.input(receipt).mutation(({ input }) => {
		const { target } = exactProjectHook(input);
		return { projectId: target.projectId, url: target.url };
	}),
	fixTargets: publicProcedure.input(receipt).query(({ input }) => projectHookFixTargets(input)),
	fix: publicProcedure
		.input(receipt.extend({ workspaceId: z.string().min(1) }))
		.mutation(({ input }) => fixProjectHook(input)),
});
