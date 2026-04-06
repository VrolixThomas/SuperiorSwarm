import type { IssueTracker } from "./types";

const issueTrackers = new Map<string, IssueTracker>();

export function registerIssueTracker(tracker: IssueTracker): void {
	issueTrackers.set(tracker.name, tracker);
}

export function getIssueTracker(name: string): IssueTracker {
	const tracker = issueTrackers.get(name);
	if (!tracker) throw new Error(`Unknown issue tracker: ${name}`);
	return tracker;
}

export function getConnectedIssueTrackers(): IssueTracker[] {
	return [...issueTrackers.values()].filter((t) => t.isConnected());
}
