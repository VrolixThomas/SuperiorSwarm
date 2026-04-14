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
	  }
	| {
			type: "commit";
			repoPath: string;
			commitHash: string;
	  };

export function refsForDiffContext(ctx: DiffContext): {
	originalRef: string;
	modifiedRef: string;
} {
	if (ctx.type === "branch") {
		return { originalRef: ctx.baseBranch, modifiedRef: ctx.headBranch };
	}
	if (ctx.type === "pr") {
		return { originalRef: ctx.targetBranch, modifiedRef: ctx.sourceBranch };
	}
	if (ctx.type === "commit") {
		// "<hash>~1" is the first parent. For the initial commit this ref does
		// not exist; getFileContent falls back to empty content, which renders
		// the file as fully added — acceptable.
		return { originalRef: `${ctx.commitHash}~1`, modifiedRef: ctx.commitHash };
	}
	// working-tree: HEAD (committed) vs current file on disk (empty ref = working tree)
	return { originalRef: "HEAD", modifiedRef: "" };
}

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
