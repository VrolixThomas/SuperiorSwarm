import type { BrowserService } from "./service";
let service: BrowserService | undefined;
export function setBrowserService(value: BrowserService) {
	service = value;
}
export function closeWorkspaceBrowsers(workspaceId: string) {
	service?.closeWorkspace(workspaceId);
}
