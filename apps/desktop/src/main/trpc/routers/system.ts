import { getAgentNotifyPort } from "../../agent-hooks/port";
import { publicProcedure, router } from "../index";

export const systemRouter = router({
	getAgentNotifyPort: publicProcedure.query(() => {
		return { port: getAgentNotifyPort() };
	}),
});
