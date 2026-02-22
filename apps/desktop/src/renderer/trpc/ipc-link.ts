import { TRPCClientError, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../main/trpc/routers";

export function ipcLink(): TRPCLink<AppRouter> {
	return () =>
		({ op }) =>
			observable((observer) => {
				const { type, path, input } = op;

				window.electron.trpc
					.request({ type, path, input })
					.then((response) => {
						const data = response as
							| { result: { data: unknown } }
							| { error: { message: string; code: string } };

						if ("error" in data) {
							observer.error(TRPCClientError.from(data.error));
						} else {
							observer.next({
								result: {
									type: "data",
									data: data.result.data,
								},
							});
							observer.complete();
						}
					})
					.catch((err: unknown) => {
						observer.error(TRPCClientError.from(err as Error));
					});
			});
}
