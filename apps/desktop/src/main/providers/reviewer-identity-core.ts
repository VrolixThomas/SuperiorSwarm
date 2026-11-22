import type { CurrentReviewer, ReviewerIdentityScope } from "../../shared/reviewer-identity";

interface IdentityAuth {
	accountId: string;
	accessToken: string;
}

/** No identity cache: old saved auth is hydrated from the provider on every lookup. */
export async function lookupCurrentReviewer(
	provider: CurrentReviewer["provider"],
	scope: ReviewerIdentityScope,
	deps: { getAuth: () => IdentityAuth | null; fetchUser: () => Promise<Response> }
): Promise<CurrentReviewer> {
	const unavailable = (
		reason: Extract<CurrentReviewer, { status: "unavailable" }>["reason"]
	): CurrentReviewer => ({ ...scope, provider, status: "unavailable", reason });
	if (scope.host !== (provider === "github" ? "github.com" : "bitbucket.org")) {
		return unavailable("unsupported-host");
	}
	const auth = deps.getAuth();
	if (!auth?.accessToken) return unavailable("disconnected");
	if (!scope.accountId || scope.accountId !== auth.accountId) return unavailable("account-changed");
	try {
		const response = await deps.fetchUser();
		if (!response.ok) return unavailable("lookup-failed");
		const raw: unknown = await response.json();
		const current = deps.getAuth();
		if (!current?.accessToken) return unavailable("disconnected");
		if (current.accountId !== auth.accountId || current.accessToken !== auth.accessToken) {
			return unavailable("account-changed");
		}
		if (!raw || typeof raw !== "object") return unavailable("missing-provider-identity");
		const user = raw as { id?: unknown; login?: unknown; uuid?: unknown; account_id?: unknown };
		if (provider === "github") {
			if (
				!Number.isSafeInteger(user.id) ||
				Number(user.id) <= 0 ||
				typeof user.login !== "string" ||
				!user.login.trim()
			) {
				return unavailable("missing-provider-identity");
			}
			if (String(user.id) !== auth.accountId) return unavailable("account-changed");
			return {
				...scope,
				provider,
				status: "available",
				identity: { id: String(user.id), login: user.login },
			};
		}
		if (
			typeof user.uuid !== "string" ||
			!user.uuid ||
			typeof user.account_id !== "string" ||
			!user.account_id
		) {
			return unavailable("missing-provider-identity");
		}
		if (user.account_id !== auth.accountId) return unavailable("account-changed");
		return { ...scope, provider, status: "available", identity: { id: user.uuid, login: null } };
	} catch {
		// Provider errors can contain sensitive response text; expose only a stable reason.
		return unavailable(deps.getAuth() ? "lookup-failed" : "disconnected");
	}
}
