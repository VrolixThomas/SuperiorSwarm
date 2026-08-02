export const TICKET_BRANCH_TYPES = [
	{ value: "feature", label: "Feature" },
	{ value: "bugfix", label: "Bugfix" },
	{ value: "hotfix", label: "Hotfix" },
	{ value: "chore", label: "Chore" },
] as const;

export type TicketBranchType = (typeof TICKET_BRANCH_TYPES)[number]["value"];

export function slugifyTicketBranchSuffix(identifier: string, title: string): string {
	const id = identifier
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 50)
		.replace(/-+$/, "");
	return slug ? `${id}-${slug}` : id;
}

export function slugifyBranchName(
	identifier: string,
	title: string,
	type: TicketBranchType = "feature"
): string {
	return `${type}/${slugifyTicketBranchSuffix(identifier, title)}`;
}
