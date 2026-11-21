/** All fields participate in renderer query keys; identities must not cross scopes. */
export interface ReviewerIdentityScope {
	host: string;
	owner: string;
	repo: string;
	/** Saved connection account ID from getStatus; null means no selected account. */
	accountId: string | null;
}

export type CurrentReviewer = ReviewerIdentityScope & {
	provider: "github" | "bitbucket";
} & (
		| {
				status: "available";
				identity: {
					/** GitHub database ID or Bitbucket UUID, obtained from the authenticated user endpoint. */
					id: string;
					/** GitHub login only. Bitbucket nickname/display_name are not unique logins. */
					login: string | null;
				};
		  }
		| {
				status: "unavailable";
				reason:
					| "disconnected"
					| "account-changed"
					| "unsupported-host"
					| "lookup-failed"
					| "missing-provider-identity";
		  }
	);
