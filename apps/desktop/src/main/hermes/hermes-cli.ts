import { constants, accessSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";

export const HERMES_PROFILE_ID_PATTERN = /^(?:default|custom|[a-z0-9][a-z0-9_-]{0,63})$/;

const PACKAGED_POSIX_BIN_DIRECTORIES = [
	"/opt/homebrew/bin",
	"/opt/homebrew/sbin",
	"/usr/local/bin",
	"/usr/local/sbin",
] as const;

export function normalizeManagedHermesProfileId(profileId: string): string {
	return profileId === "custom" ? "default" : profileId;
}

export function hermesExecutableCandidates(
	env: NodeJS.ProcessEnv = process.env,
	userHome = homedir()
): string[] {
	const candidates: string[] = [];
	const seen = new Set<string>();
	const add = (candidate: string) => {
		if (!candidate || seen.has(candidate)) return;
		seen.add(candidate);
		candidates.push(candidate);
	};
	const explicit = env["HERMES_EXECUTABLE"]?.trim();
	if (explicit) add(explicit);
	for (const directory of (env["PATH"] ?? "").split(delimiter)) {
		if (directory) add(join(directory, "hermes"));
	}
	for (const directory of PACKAGED_POSIX_BIN_DIRECTORIES) add(join(directory, "hermes"));
	add(join(userHome, ".local", "bin", "hermes"));
	add(join(userHome, ".hermes", "bin", "hermes"));
	return candidates;
}

export function resolveHermesExecutable(
	env: NodeJS.ProcessEnv = process.env,
	userHome = homedir(),
	isExecutable: (candidate: string) => boolean = (candidate) => {
		try {
			accessSync(candidate, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}
): string | null {
	for (const candidate of hermesExecutableCandidates(env, userHome)) {
		if (isExecutable(candidate)) return candidate;
	}
	return null;
}

export function normalizeHermesHomeRoot(value: string): string {
	const resolved = resolve(value);
	const parent = dirname(resolved);
	return basename(parent).toLowerCase() === "profiles" ? dirname(parent) : resolved;
}

export function resolveHermesHomeRoot(
	env: NodeJS.ProcessEnv = process.env,
	userHome = homedir()
): string {
	return normalizeHermesHomeRoot(env["HERMES_HOME"]?.trim() || join(userHome, ".hermes"));
}

export function buildHermesBackendLaunch(
	profileId: string,
	hermesHome: string
): { argv: string[]; hermesHome: string } {
	if (!HERMES_PROFILE_ID_PATTERN.test(profileId)) {
		throw new Error("Hermes profile is invalid");
	}
	const managedProfileId = normalizeManagedHermesProfileId(profileId);
	return {
		argv: ["--profile", managedProfileId, "serve", "--host", "127.0.0.1", "--port", "0"],
		hermesHome: normalizeHermesHomeRoot(hermesHome),
	};
}
