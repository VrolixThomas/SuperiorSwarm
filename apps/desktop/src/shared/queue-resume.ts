import type { ActivityQueueTarget } from "./activity-queue";
export type QueueLaunchOwner = Extract<ActivityQueueTarget, { type: "terminal" }>;
export function queueOwnerKey(t: QueueLaunchOwner): string {
	return JSON.stringify([
		t.entity?.kind,
		t.entity?.id,
		t.workspaceId,
		t.terminalId,
		t.provider,
		t.providerSessionId,
	]);
}
export interface QueueLaunchDescriptor {
	provider: "claude" | "codex";
	/** Policy/configuration arguments from a trusted app launch, excluding prompt and selectors. */
	args: string[];
	initialPrompt?: boolean;
}
const valueFlags: Record<QueueLaunchDescriptor["provider"], Set<string>> = {
	claude: new Set([
		"--tools",
		"--setting-sources",
		"--permission-mode",
		"--model",
		"--settings",
		"--mcp-config",
		"--allowedTools",
		"--disallowedTools",
		"--add-dir",
	]),
	codex: new Set([
		"-c",
		"--config",
		"-m",
		"--model",
		"-p",
		"--profile",
		"-s",
		"--sandbox",
		"-a",
		"--ask-for-approval",
		"--enable",
		"--disable",
		"--add-dir",
	]),
};
const switches: Record<QueueLaunchDescriptor["provider"], Set<string>> = {
	claude: new Set([
		"--strict-mcp-config",
		"--disable-slash-commands",
		"--dangerously-skip-permissions",
	]),
	codex: new Set(["--no-daemon", "--no-alt-screen", "--dangerously-bypass-approvals-and-sandbox"]),
};
export function validQueueLaunch(value: unknown): value is QueueLaunchDescriptor {
	if (!value || typeof value !== "object") return false;
	const d = value as QueueLaunchDescriptor;
	if (
		(d.initialPrompt !== undefined && typeof d.initialPrompt !== "boolean") ||
		!["claude", "codex"].includes(d.provider) ||
		!Array.isArray(d.args) ||
		d.args.length > 128 ||
		d.args.some((a) => typeof a !== "string" || a.includes("\0")) ||
		JSON.stringify(d).length > 48_000
	)
		return false;
	let dedicated = false;
	for (let i = 0; i < d.args.length; i++) {
		const flag = d.args[i];
		if (!flag) return false;
		if (switches[d.provider].has(flag)) {
			if (flag === "--no-daemon") dedicated = true;
			continue;
		}
		if (!valueFlags[d.provider].has(flag) || typeof d.args[++i] !== "string") return false;
	}
	return d.provider !== "codex" || dedicated;
}
export function queueResumeArgs(
	descriptor: QueueLaunchDescriptor,
	conversationId: string,
	prompt?: string
): string[] {
	if (
		!validQueueLaunch(descriptor) ||
		!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(conversationId)
	)
		throw Error("Exact resumable conversation unavailable");
	return descriptor.provider === "claude"
		? [
				...descriptor.args,
				"--resume",
				conversationId,
				...(prompt === undefined ? [] : ["--", prompt]),
			]
		: [
				...descriptor.args,
				"resume",
				conversationId,
				...(prompt === undefined ? [] : ["--", prompt]),
			];
}
export function defaultQueueLaunch(
	provider: string,
	skipPermissions: boolean,
	initialPrompt?: boolean
): QueueLaunchDescriptor | undefined {
	if (provider === "claude")
		return {
			provider,
			...(initialPrompt === undefined ? {} : { initialPrompt }),
			args: skipPermissions ? ["--dangerously-skip-permissions"] : [],
		};
	if (provider === "codex")
		return {
			provider,
			...(initialPrompt === undefined ? {} : { initialPrompt }),
			args: [
				"--no-daemon",
				...(skipPermissions
					? ["-c", "approval_policy=never", "-c", "sandbox_mode=danger-full-access"]
					: []),
			],
		};
	return undefined;
}
