let oauthFlowInProgress = false;

export function acquireOAuthLock(): void {
	if (oauthFlowInProgress) throw new Error("An OAuth flow is already in progress");
	oauthFlowInProgress = true;
}

export function releaseOAuthLock(): void {
	oauthFlowInProgress = false;
}
