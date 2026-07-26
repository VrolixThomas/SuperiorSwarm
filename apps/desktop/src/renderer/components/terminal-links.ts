export function createTerminalLinkHandler(
	openExternal: (url: string) => Promise<void>
): (_event: MouseEvent, uri: string) => void {
	return (_event, uri) => {
		void openExternal(uri);
	};
}
