"use client";

import { SITE } from "@/lib/constants";
import { useEffect, useState } from "react";

const REPO_API = SITE.github.replace("github.com", "api.github.com/repos");

export function GitHubStarLink() {
	const [stars, setStars] = useState<number | null>(null);

	useEffect(() => {
		fetch(REPO_API)
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				if (data?.stargazers_count != null) {
					setStars(data.stargazers_count);
				}
			})
			.catch(() => {});
	}, []);

	return (
		<a
			href={SITE.github}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-2 text-[15px] text-text-muted transition-colors hover:text-text-secondary"
		>
			<svg
				className="size-4"
				viewBox="0 0 16 16"
				fill="currentColor"
				aria-hidden="true"
			>
				<path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.64 7.64 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 8 .2Z" />
			</svg>
			Star on GitHub
			{stars !== null && (
				<span className="rounded-full bg-bg-surface px-2 py-0.5 text-[12px] tabular-nums text-text-faint">
					{stars >= 1000 ? `${(stars / 1000).toFixed(1)}k` : stars}
				</span>
			)}
		</a>
	);
}
