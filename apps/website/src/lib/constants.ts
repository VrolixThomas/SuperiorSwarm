export const SITE = {
	name: "SuperiorSwarm",
	tagline: "Manage your swarm. Superiorly.",
	description:
		"The desktop command center for AI coding agents. Run Claude Code, Codex, and more — with automatic PR reviews, terminal multiplexing, and Jira/Linear/GitHub integration.",
	url: "https://superiorswarm.com",
	github: "https://github.com/VrolixThomas/SuperiorSwarm",
	download: "https://github.com/VrolixThomas/SuperiorSwarm/releases/latest",
	releases: "https://github.com/VrolixThomas/SuperiorSwarm/releases",
	discord: "https://discord.gg/Qmskdt2cJH",
	socials: {
		x: "https://x.com/superiorswarm",
		linkedin: "https://linkedin.com/company/superiorswarm",
		youtube: "https://youtube.com/@superiorswarm",
		github: "https://github.com/VrolixThomas/SuperiorSwarm",
		discord: "https://discord.gg/Qmskdt2cJH",
	},
} as const;

export const SOCIAL_LIST = [
	{ key: "x", label: "X (Twitter)", href: SITE.socials.x },
	{ key: "linkedin", label: "LinkedIn", href: SITE.socials.linkedin },
	{ key: "youtube", label: "YouTube", href: SITE.socials.youtube },
	{ key: "discord", label: "Discord", href: SITE.socials.discord },
	{ key: "github", label: "GitHub", href: SITE.socials.github },
] as const;
