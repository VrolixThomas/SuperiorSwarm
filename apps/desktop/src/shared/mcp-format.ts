/** Config formats the superiorswarm MCP entry can be written in, per target agent. */
export const MCP_FORMATS = ["json", "toml", "opencode"] as const;

export type McpFormat = (typeof MCP_FORMATS)[number];
