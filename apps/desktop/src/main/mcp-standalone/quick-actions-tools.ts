export interface QuickActionMcpTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export const quickActionTools: QuickActionMcpTool[] = [
	{
		name: "add_quick_action",
		description:
			"Add a quick action button to the top bar. Provide a short label, the shell command to run, and optionally a subdirectory and scope.",
		inputSchema: {
			type: "object",
			properties: {
				label: { type: "string", description: "Short button label (e.g. 'Build', 'Test')" },
				command: { type: "string", description: "Shell command to execute" },
				cwd: { type: "string", description: "Relative subdirectory to run in (optional)" },
				shortcut: {
					type: "string",
					description: "Keyboard shortcut in Electron accelerator format (optional)",
				},
				scope: {
					type: "string",
					enum: ["global", "repo"],
					description: "Whether this action applies globally or only to this repo",
				},
			},
			required: ["label", "command"],
		},
	},
	{
		name: "list_quick_actions",
		description: "List all currently configured quick action buttons",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "remove_quick_action",
		description: "Remove a quick action by its ID",
		inputSchema: {
			type: "object",
			properties: {
				id: { type: "string", description: "The ID of the quick action to remove" },
			},
			required: ["id"],
		},
	},
];
