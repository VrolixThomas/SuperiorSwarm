import type { TerminalAPI } from "../shared/types";

export function createTerminalInputAPI(
	invoke: (channel: string, id: string, data: string) => Promise<boolean>
) {
	return {
		write: (id: string, data: string) => invoke("terminal:write", id, data),
		writeBinary: (id: string, data: string) => invoke("terminal:write-binary", id, data),
	} satisfies Pick<TerminalAPI, "write" | "writeBinary">;
}
