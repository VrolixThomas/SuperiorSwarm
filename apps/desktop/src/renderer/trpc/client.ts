import { createTRPCClient } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../main/trpc/routers";
import { ipcLink } from "./ipc-link";

export const trpc = createTRPCReact<AppRouter>();

export const trpcVanilla = createTRPCClient<AppRouter>({
	links: [ipcLink()],
});
