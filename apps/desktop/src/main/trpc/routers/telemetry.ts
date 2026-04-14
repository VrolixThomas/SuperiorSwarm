import { z } from "zod";
import { getDb } from "../../db";
import { getTelemetryState, setConsent, setOptOut } from "../../telemetry/state";
import { syncIfDue } from "../../telemetry/sync";
import { publicProcedure, router } from "../index";

export const telemetryRouter = router({
	getState: publicProcedure.query(() => {
		const state = getTelemetryState(getDb());
		if (!state) return null;
		return {
			consentAcknowledged: !!state.consentAcknowledgedAt,
			optOut: state.optOut,
		};
	}),

	setConsent: publicProcedure
		.input(z.object({ optOut: z.boolean() }))
		.mutation(async ({ input }) => {
			setConsent(getDb(), input.optOut);
			if (!input.optOut) {
				// User just granted consent — fire an immediate sync
				await syncIfDue({ force: true });
			}
			return { ok: true };
		}),

	setOptOut: publicProcedure.input(z.object({ optOut: z.boolean() })).mutation(({ input }) => {
		setOptOut(getDb(), input.optOut);
		return { ok: true };
	}),
});
