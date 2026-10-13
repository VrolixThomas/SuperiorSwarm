import { z } from "zod";
import {
	checkForUpdates,
	dismissUpdateVersion,
	fetchReleaseNotes,
	getUpdaterState,
	installUpdate,
	markVersionSeen,
} from "../../updater";
import { publicProcedure, router } from "../index";

export const updatesRouter = router({
	getStatus: publicProcedure.query(() => getUpdaterState()),

	getReleaseNotes: publicProcedure
		.input(z.object({ version: z.string().optional() }))
		.query(async ({ input }) => {
			const state = getUpdaterState();
			const version = input.version ?? state.currentVersion;
			const release = await fetchReleaseNotes(version);
			return {
				version,
				body: release?.body ?? null,
				publishedAt: release?.publishedAt ?? null,
			};
		}),

	checkForUpdates: publicProcedure.mutation(() => checkForUpdates()),

	installUpdate: publicProcedure.mutation(() => installUpdate()),

	markVersionSeen: publicProcedure
		.input(z.object({ version: z.string() }))
		.mutation(({ input }) => {
			markVersionSeen(input.version);
		}),

	dismissUpdate: publicProcedure.input(z.object({ version: z.string() })).mutation(({ input }) => {
		dismissUpdateVersion(input.version);
	}),
});
