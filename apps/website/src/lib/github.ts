export type GitHubRelease = {
	tagName: string;
	publishedAt: string;
	dmgUrl: string | null;
	dmgSize: number | null;
};

const GITHUB_API_URL = "https://api.github.com/repos/VrolixThomas/SuperiorSwarm/releases/latest";

export async function getLatestRelease(): Promise<GitHubRelease | null> {
	try {
		const res = await fetch(GITHUB_API_URL, {
			headers: { Accept: "application/vnd.github+json" },
			next: { revalidate: 300 },
		});

		if (!res.ok) return null;

		const data = await res.json();

		const dmgAsset = data.assets?.find((a: { name: string }) => a.name.endsWith(".dmg"));

		return {
			tagName: data.tag_name,
			publishedAt: data.published_at,
			dmgUrl: dmgAsset?.browser_download_url ?? null,
			dmgSize: dmgAsset?.size ?? null,
		};
	} catch {
		return null;
	}
}
