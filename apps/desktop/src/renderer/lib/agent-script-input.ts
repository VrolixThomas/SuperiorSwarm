/** Enter for a known app-created launch script; LF remains ordinary pasted text elsewhere. */
export function agentScriptInput(scriptPath: string): string {
	return `bash '${scriptPath.replace(/'/g, "'\\''")}'\r`;
}
