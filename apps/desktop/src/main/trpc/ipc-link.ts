import {
	type AnyRouter,
	type TRPCError,
	callTRPCProcedure,
	getTRPCErrorFromUnknown,
} from "@trpc/server";
import { ipcMain } from "electron";

export function setupTRPCIPC(appRouter: AnyRouter): void {
	ipcMain.handle(
		"trpc:request",
		async (_event, { type, path, input }: { type: string; path: string; input?: unknown }) => {
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
				return { result: { data: result } };
			} catch (cause) {
				const error: TRPCError = getTRPCErrorFromUnknown(cause);
				return {
					error: {
						message: error.message,
						code: error.code,
						data: { code: error.code, httpStatus: 500 },
					},
				};
			}
		}
	);
}
