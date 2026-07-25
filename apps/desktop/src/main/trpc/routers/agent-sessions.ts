import { z } from "zod";
import { getAgentSessionManager } from "../../services/agent-session-manager-handle";
import { publicProcedure, router } from "../index";

function requireManager() {
	const manager = getAgentSessionManager();
	if (!manager) throw new Error("Agent session manager is not available");
	return manager;
}

const terminalInput = z.object({ terminalId: z.string().min(1) });

export const agentSessionsRouter = router({
	list: publicProcedure.query(() => getAgentSessionManager()?.listSessions() ?? []),

	sleepNow: publicProcedure.input(terminalInput).mutation(({ input }) => {
		return requireManager().sleepNow(input.terminalId);
	}),

	wake: publicProcedure.input(terminalInput).mutation(({ input }) => {
		return requireManager().wake(input.terminalId);
	}),

	setKeepRunning: publicProcedure
		.input(terminalInput.extend({ keepRunning: z.boolean() }))
		.mutation(({ input }) => {
			return requireManager().setKeepRunning(input.terminalId, input.keepRunning);
		}),
});
