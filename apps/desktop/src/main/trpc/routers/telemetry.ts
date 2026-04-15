import { z } from "zod";
import { getDb } from "../../db";
import { getTelemetryState, setAnalyticsEnabled } from "../../telemetry/state";
import { publicProcedure, router } from "../index";

export const telemetryRouter = router({
	getState: publicProcedure.query(() => {
		const state = getTelemetryState(getDb());
		return { analyticsEnabled: !state?.optOut };
	}),

	setAnalyticsEnabled: publicProcedure
		.input(z.object({ enabled: z.boolean() }))
		.mutation(({ input }) => {
			setAnalyticsEnabled(getDb(), input.enabled);
			return { ok: true };
		}),
});
