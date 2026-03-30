import { BRANCH_FILES } from "./mock-data";

export const EXT_COLORS: Record<string, string> = {
	ts: "#3178c6",
	tsx: "#3178c6",
	js: "#f7df1e",
	json: "#69db7c",
	css: "#a855f6",
	md: "#e1e1e3",
};

export function extColor(filename: string): string {
	const ext = filename.split(".").pop() ?? "";
	return EXT_COLORS[ext] ?? "#a1a1a6";
}

export const TOTAL_ADDITIONS = BRANCH_FILES.reduce((s, f) => s + f.additions, 0);
