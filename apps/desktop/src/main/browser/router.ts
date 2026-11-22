import { z } from "zod";
import {
	browserCommandSchema,
	browserSyncSchema,
	browserTabSchema,
	browserTargetSchema,
} from "../../shared/browser";
import { publicProcedure, router } from "../trpc";
import type { BrowserGuestRuntime } from "./guest-runtime";
import type { BrowserService } from "./service";

export function createBrowserRouter(
	service: BrowserService,
	assertWorkspace: (id: string) => unknown,
	runtime?: BrowserGuestRuntime
) {
	const trusted = publicProcedure.use(({ ctx, next }) => {
		if (!ctx.browserCaller)
			throw new Error("Browser controls require the application's main frame.");
		return next();
	});
	return router({
		reserve: trusted
			.input(browserTabSchema.extend({ agentControl: z.boolean().optional() }))
			.mutation(({ ctx, input }) => {
				assertWorkspace(input.workspaceId);
				if (!runtime || !ctx.browserCaller) throw new Error("Browser host unavailable.");
				return runtime.reserve(input, ctx.browserCaller.senderId);
			}),
		register: trusted
			.input(
				browserTargetSchema.extend({
					generation: z.string().uuid(),
					webContentsId: z.number().int().positive(),
				})
			)
			.mutation(({ ctx, input }) => {
				if (!runtime || !ctx.browserCaller) throw new Error("Browser host unavailable.");
				return runtime.register(input, ctx.browserCaller.senderId);
			}),
		ensure: trusted.input(browserTabSchema).mutation(({ input }) => {
			assertWorkspace(input.workspaceId);
			return service.ensure(input);
		}),
		state: trusted.input(browserTargetSchema).query(({ input }) => service.state(input)),
		command: trusted
			.input(browserTargetSchema.extend({ command: browserCommandSchema }))
			.mutation(({ input }) => service.command(input, input.command)),
		sync: trusted.input(browserSyncSchema).mutation(({ input }) => {
			service.sync(input);
			return true;
		}),
		close: trusted.input(browserTargetSchema).mutation(({ input }) => {
			service.close(input);
			return true;
		}),
		list: trusted
			.input(z.object({ workspaceId: z.string() }))
			.query(({ input }) => service.list(input.workspaceId)),
	});
}
