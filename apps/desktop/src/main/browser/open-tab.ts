import { randomUUID } from "node:crypto";
import { type BrowserOpenTab, type BrowserTarget, browserURLSchema } from "../../shared/browser";
import type { BrowserService } from "./service";

/** Publish metadata before the renderer can present the page. Both entry points use this lifecycle. */
export function requestBrowserTab(
	service: BrowserService,
	workspaceId: string,
	url: string,
	openTab: (tab: BrowserOpenTab) => void,
	opener?: { browserId: string; background: boolean }
): BrowserOpenTab {
	const source = opener ? service.state({ workspaceId, browserId: opener.browserId }) : undefined;
	if (source && !source.presented) throw new Error("The source browser tab is hidden.");
	const tab: BrowserOpenTab = {
		workspaceId,
		browserId: `browser-${randomUUID()}`,
		url: browserURLSchema.parse(url),
		viewport: source?.viewport ?? "desktop",
		...(opener ? { openerId: opener.browserId, background: opener.background } : {}),
	};
	service.ensure(tab, false, source?.agentControl ?? true);
	try {
		openTab(tab);
	} catch (error) {
		service.close(tab);
		throw error;
	}
	const timer = setTimeout(() => service.closeUnadopted(tab), 30000);
	timer.unref();
	return tab;
}

export function requestLinkedBrowserTab(
	service: BrowserService,
	source: BrowserTarget,
	url: string,
	background: boolean,
	openTab: (tab: BrowserOpenTab) => void
) {
	return requestBrowserTab(service, source.workspaceId, url, openTab, {
		browserId: source.browserId,
		background,
	});
}
