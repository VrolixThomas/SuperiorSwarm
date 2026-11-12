import type { PRActivityFacts } from "../providers/pr-activity";

export interface PRSnapshot extends PRActivityFacts {
	version: 1;
	change: number;
	readyDraftIds: string[];
	updates: ("head" | "request" | "review" | "comment" | "readiness")[];
	occurredAt: number;
}

/** Stored JSON is untrusted across upgrades; unsupported/corrupt baselines reset safely. */
export function readPRSnapshot(value: unknown): PRSnapshot | undefined {
	if (!value || typeof value !== "object") return undefined;
	const v = value as Record<string, unknown>;
	if (
		v["version"] !== 1 ||
		!Number.isSafeInteger(v["change"]) ||
		(v["change"] as number) < 0 ||
		typeof v["occurredAt"] !== "number" ||
		!Number.isFinite(v["occurredAt"])
	)
		return undefined;
	if (!Array.isArray(v["readyDraftIds"]) || !v["readyDraftIds"].every((x) => typeof x === "string"))
		return undefined;
	if (
		!Array.isArray(v["updates"]) ||
		!v["updates"].every((x) => ["head", "request", "review", "comment", "readiness"].includes(x))
	)
		return undefined;
	for (const key of ["headSha", "reviewToken", "commentToken"])
		if (v[key] !== undefined && typeof v[key] !== "string") return undefined;
	for (const key of ["isDraft", "reviewRequested"])
		if (v[key] !== undefined && typeof v[key] !== "boolean") return undefined;
	if (
		v["state"] !== undefined &&
		!["open", "closed", "merged", "declined"].includes(v["state"] as string)
	)
		return undefined;
	return v as unknown as PRSnapshot;
}

export function classifyPR(
	previous: PRSnapshot | undefined,
	facts: PRActivityFacts,
	readyDraftIds: string[],
	now: number,
	previouslyHandled = false
) {
	const known = Object.fromEntries(
		Object.entries(facts).filter(
			([key, value]) => value !== undefined && (key !== "headSha" || value !== "")
		)
	);
	const snapshot: PRSnapshot = {
		...previous,
		...known,
		version: 1,
		change: previous?.change ?? 0,
		readyDraftIds: [...readyDraftIds].sort(),
		updates: previous?.updates ?? [],
		occurredAt: previous?.occurredAt ?? now,
	};
	const changes: PRSnapshot["updates"] = [];
	for (const [key, reason] of [
		["headSha", "head"],
		["reviewRequested", "request"],
		["reviewToken", "review"],
		["commentToken", "comment"],
		["isDraft", "readiness"],
	] as const) {
		if (previous?.[key] !== undefined && known[key] !== undefined && previous[key] !== known[key])
			changes.push(reason);
	}
	if (changes.length) snapshot.change++;
	if (changes.length)
		snapshot.updates = [
			...new Set([...(previouslyHandled ? [] : snapshot.updates), ...changes]),
		].sort();
	const requested = (value: PRActivityFacts | undefined) =>
		value?.state === "open" && value.isDraft === false && value.reviewRequested === true;
	if (
		requested(previous) !== requested(snapshot) ||
		changes.length ||
		JSON.stringify(previous?.readyDraftIds) !== JSON.stringify(snapshot.readyDraftIds) ||
		previous?.state !== snapshot.state
	)
		snapshot.occurredAt = now;
	if (snapshot.state && snapshot.state !== "open") snapshot.updates = [];
	const reasons: string[] = [];
	if (snapshot.state === "open") {
		if (snapshot.isDraft === false && snapshot.reviewRequested === true)
			reasons.push("Review requested");
		if (snapshot.readyDraftIds.length) reasons.push("Review draft ready");
		for (const update of snapshot.updates)
			reasons.push(
				{
					head: "New commits",
					request: "Review request changed",
					review: "Review activity changed",
					comment: "Comment activity changed",
					readiness: "Draft status changed",
				}[update]
			);
	}
	const kind: "pr-review" | "pr-update" | undefined = reasons.length
		? reasons.includes("Review requested") || reasons.includes("Review draft ready")
			? "pr-review"
			: "pr-update"
		: undefined;
	// Fetch time is excluded. Known facts remain stable through partial failures.
	const fingerprint = JSON.stringify([
		snapshot.change,
		snapshot.state === "open" && snapshot.isDraft === false && snapshot.reviewRequested === true,
		snapshot.readyDraftIds,
		snapshot.updates,
	]);
	return { snapshot, reasons, kind, fingerprint };
}
