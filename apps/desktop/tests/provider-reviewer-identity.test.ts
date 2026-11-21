import { describe, expect, test } from "bun:test";
import { lookupCurrentReviewer } from "../src/main/providers/reviewer-identity-core";

const scope = { host: "github.com", owner: "acme", repo: "app", accountId: "42" };
const auth = { accountId: "42", accessToken: "test-token" };
const user = {
	id: 42,
	login: "real-login",
	name: "Display Name",
	email: "not-a-login@example.com",
};

function setup(provider: "github" | "bitbucket" = "github") {
	let saved: typeof auth | null = auth;
	let body: unknown = user;
	let calls = 0;
	let beforeReply = () => {};
	const deps = {
		getAuth: () => saved,
		fetchUser: async () => {
			calls++;
			beforeReply();
			return new Response(JSON.stringify(body));
		},
	};
	return {
		lookup: (input = scope) => lookupCurrentReviewer(provider, input, deps),
		setAuth: (value: typeof saved) => {
			saved = value;
		},
		setBody: (value: unknown) => {
			body = value;
		},
		beforeReply: (fn: () => void) => {
			beforeReply = fn;
		},
		calls: () => calls,
	};
}

describe("current reviewer from provider data", () => {
	test("old saved auth without login resolves the real login, never name/email", async () => {
		const s = setup();
		expect(await s.lookup()).toMatchObject({
			status: "available",
			provider: "github",
			...scope,
			identity: { id: "42", login: "real-login" },
		});
		s.setBody({ id: 42, name: "Display Name", email: "alice@example.com" });
		expect(await s.lookup()).toMatchObject({
			status: "unavailable",
			reason: "missing-provider-identity",
		});
	});
	test("missing credentials and stale account scope do not fetch", async () => {
		const s = setup();
		s.setAuth(null);
		expect(await s.lookup()).toMatchObject({ status: "unavailable", reason: "disconnected" });
		s.setAuth({ ...auth, accountId: "99" });
		expect(await s.lookup()).toMatchObject({ status: "unavailable", reason: "account-changed" });
		expect(s.calls()).toBe(0);
	});
	test("does not reuse identity across reconnect/account/repository/host", async () => {
		const s = setup();
		await s.lookup();
		s.setAuth({ accountId: "99", accessToken: "new-token" });
		s.setBody({ id: 99, login: "second" });
		expect(await s.lookup({ ...scope, accountId: "99", repo: "other" })).toMatchObject({
			repo: "other",
			identity: { id: "99", login: "second" },
		});
		expect(await s.lookup({ ...scope, host: "github.example.com" })).toMatchObject({
			status: "unavailable",
			reason: "unsupported-host",
		});
		expect(s.calls()).toBe(2);
	});
	test.each(["disconnect", "switch", "reconnect"])(
		"discards in-flight identity after %s",
		async (action) => {
			const s = setup();
			s.beforeReply(() =>
				s.setAuth(
					action === "disconnect"
						? null
						: { accountId: action === "switch" ? "99" : "42", accessToken: "new-token" }
				)
			);
			expect(await s.lookup()).toMatchObject({ status: "unavailable" });
		}
	);
	test("rejects identity not belonging to selected saved account", async () => {
		const s = setup();
		s.setBody({ id: 99, login: "other" });
		expect(await s.lookup()).toMatchObject({ status: "unavailable", reason: "account-changed" });
	});
	test("Bitbucket returns UUID, never treats nickname or display name as login", async () => {
		const s = setup("bitbucket");
		s.setBody({
			uuid: "{stable-user}",
			account_id: "42",
			nickname: "Not Unique",
			display_name: "Name",
		});
		expect(await s.lookup({ ...scope, host: "bitbucket.org" })).toMatchObject({
			status: "available",
			provider: "bitbucket",
			identity: { id: "{stable-user}", login: null },
		});
		s.setBody({ display_name: "Name", nickname: "Not Unique" });
		expect(await s.lookup({ ...scope, host: "bitbucket.org" })).toMatchObject({
			status: "unavailable",
			reason: "missing-provider-identity",
		});
	});
	test("lookup failures remain explicit and do not leak error bodies", async () => {
		const result = await lookupCurrentReviewer("github", scope, {
			getAuth: () => auth,
			fetchUser: async () => {
				throw new Error("secret");
			},
		});
		expect(result).toMatchObject({ status: "unavailable", reason: "lookup-failed" });
		expect(JSON.stringify(result)).not.toContain("secret");
	});
});
