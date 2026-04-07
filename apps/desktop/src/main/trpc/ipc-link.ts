import {
	type AnyRouter,
	type TRPCError,
	callTRPCProcedure,
	getTRPCErrorFromUnknown,
} from "@trpc/server";
import { ipcMain } from "electron";
import { isCloneable } from "../ipc-safety";
import { log } from "../logger";

const errorResponse = (message: string, code: string) => ({
	error: { message, code, data: { code, httpStatus: 500 } },
});

export function setupTRPCIPC(appRouter: AnyRouter): void {
	ipcMain.handle(
		"trpc:request",
		async (_event, { type, path, input }: { type: string; path: string; input?: unknown }) => {
			const label = `trpc:${path}`;
			try {
				const result = await callTRPCProcedure({
					router: appRouter,
					path,
					getRawInput: async () => input,
					ctx: {},
					type: type as "query" | "mutation",
					signal: undefined,
					batchIndex: 0,
				});
				if (!isCloneable(result, label)) {
					return errorResponse(
						`Response from ${path} cannot be serialized over IPC`,
						"INTERNAL_SERVER_ERROR"
					);
				}
				// Breadcrumb is the LAST log entry before the IPC return. If V8
				// crashes during the actual send, this is the marker that tells
				// us which procedure was the trigger.
				log.info(`[ipc] sending ${label}`);
				return { result: { data: result } };
			} catch (cause) {
				const error: TRPCError = getTRPCErrorFromUnknown(cause);
				return errorResponse(error.message, error.code);
			}
		}
	);
}
