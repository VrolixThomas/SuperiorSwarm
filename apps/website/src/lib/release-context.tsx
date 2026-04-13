"use client";

import type { GitHubRelease } from "@/lib/github";
import { type ReactNode, createContext, use } from "react";

const ReleaseContext = createContext<GitHubRelease | null>(null);

export function ReleaseProvider({
	release,
	children,
}: {
	release: GitHubRelease | null;
	children: ReactNode;
}) {
	return <ReleaseContext value={release}>{children}</ReleaseContext>;
}

export function useRelease(): GitHubRelease | null {
	return use(ReleaseContext);
}
