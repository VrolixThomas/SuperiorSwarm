import { constants, accessSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";

export const HERMES_PROFILE_ID_PATTERN = /^(?:default|custom|[a-z0-9][a-z0-9_-]{0,63})$/;

export function hermesExecutableCandidates(
	env: NodeJS.ProcessEnv = process.env,
	userHome = homedir()
): string[] {
	const candidates: string[] = [];
	const explicit = env["HERMES_EXECUTABLE"]?.trim();
	if (explicit) candidates.push(explicit);
	for (const directory of (env["PATH"] ?? "").split(delimiter)) {
		if (directory) candidates.push(join(directory, "hermes"));
	}
	candidates.push(join(userHome, ".local", "bin", "hermes"));
	candidates.push(join(userHome, ".hermes", "bin", "hermes"));
	return candidates;
}

export function resolveHermesExecutable(
	env: NodeJS.ProcessEnv = process.env,
	userHome = homedir()
): string | null {
	for (const candidate of hermesExecutableCandidates(env, userHome)) {
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Continue through approved executable candidates without invoking a shell.
		}
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
	const profileArgs =
		profileId === "default" || profileId === "custom" ? [] : ["--profile", profileId];
	return {
		argv: [...profileArgs, "serve", "--host", "127.0.0.1", "--port", "0"],
		hermesHome: normalizeHermesHomeRoot(hermesHome),
	};
}
