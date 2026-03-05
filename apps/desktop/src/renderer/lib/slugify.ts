export function slugifyBranchName(identifier: string, title: string): string {
	const id = identifier.toLowerCase();
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-")
		.slice(0, 50)
		.replace(/-+$/, "");
	return `${id}/${slug}`;
}
