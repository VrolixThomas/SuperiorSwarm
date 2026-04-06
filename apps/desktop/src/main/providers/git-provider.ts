import type { GitProvider } from "./types";

const gitProviders = new Map<string, GitProvider>();

export function registerGitProvider(provider: GitProvider): void {
	gitProviders.set(provider.name, provider);
}

export function getGitProvider(name: string): GitProvider {
	const provider = gitProviders.get(name);
	if (!provider) throw new Error(`Unknown git provider: ${name}`);
	return provider;
}

export function getConnectedGitProviders(): GitProvider[] {
	return [...gitProviders.values()].filter((p) => p.isConnected());
}
