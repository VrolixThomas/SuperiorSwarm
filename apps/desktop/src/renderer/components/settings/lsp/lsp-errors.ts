export class ConfigFieldErrors extends Error {
	constructor(public fieldErrors: Record<string, string>) {
		super("Save failed with field-level errors");
	}
}
