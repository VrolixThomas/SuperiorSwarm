export const BUILT_IN_SERVER_IDS: readonly string[] = [
	"typescript",
	"python",
	"go",
	"rust",
	"java",
	"cpp",
	"php",
	"ruby",
];

export const BUILT_IN_SERVER_DISPLAY: Record<string, string> = {
	typescript: "TypeScript / JavaScript",
	python: "Python",
	go: "Go",
	rust: "Rust",
	java: "Java",
	cpp: "C / C++",
	php: "PHP",
	ruby: "Ruby",
};

export function isBuiltInServerId(id: string): boolean {
	return BUILT_IN_SERVER_IDS.includes(id);
}
