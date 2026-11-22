export function createTerminalLinkHandler(
	openExternal: (url: string) => Promise<void>,
	openInApp?: (url: string) => void
): (_event: MouseEvent, uri: string) => void {
	return (event, uri) => {
		if (event.shiftKey && openInApp) {
			openInApp(uri);
			return;
		}
		void openExternal(uri);
	};
}
