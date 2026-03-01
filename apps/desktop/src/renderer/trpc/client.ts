import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../main/trpc/routers";

export const trpc = createTRPCReact<AppRouter>();
