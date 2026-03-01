export interface DiffLine {
	type: "context" | "added" | "removed";
	content: string;
	oldLineNumber?: number;
	newLineNumber?: number;
}

export interface DiffHunk {
	header: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: DiffLine[];
}

export interface DiffFile {
	path: string;
	oldPath?: string;
	status: "added" | "modified" | "deleted" | "renamed" | "binary";
	additions: number;
	deletions: number;
	hunks: DiffHunk[];
}

export interface DiffStats {
	added: number;
	removed: number;
	changed: number;
}

export type DiffContext =
	| {
			type: "pr";
			prId: number;
			workspaceSlug: string;
			repoSlug: string;
			repoPath: string;
			title: string;
			sourceBranch: string;
			targetBranch: string;
	  }
	| {
			type: "branch";
			baseBranch: string;
			headBranch: string;
			repoPath: string;
	  }
	| {
			type: "working-tree";
			repoPath: string;
	  };

export function detectLanguage(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "typescript",
		js: "javascript",
		jsx: "javascript",
		mjs: "javascript",
		cjs: "javascript",
		json: "json",
		css: "css",
		scss: "scss",
		less: "less",
		html: "html",
		htm: "html",
		md: "markdown",
		mdx: "markdown",
		py: "python",
		go: "go",
		rs: "rust",
		java: "java",
		rb: "ruby",
		sh: "shell",
		bash: "shell",
		zsh: "shell",
		yml: "yaml",
		yaml: "yaml",
		toml: "toml",
		xml: "xml",
		sql: "sql",
		graphql: "graphql",
		gql: "graphql",
		dockerfile: "dockerfile",
	};
	return map[ext] ?? "plaintext";
}
