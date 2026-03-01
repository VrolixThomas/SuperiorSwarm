import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { shell } from "electron";
import { saveAuth } from "./auth";
import {
	BITBUCKET_AUTH_URL,
	BITBUCKET_CLIENT_ID,
	BITBUCKET_CLIENT_SECRET,
	BITBUCKET_TOKEN_URL,
	JIRA_ACCESSIBLE_RESOURCES_URL,
	JIRA_AUTH_URL,
	JIRA_CLIENT_ID,
	JIRA_CLIENT_SECRET,
	JIRA_SCOPES,
	JIRA_TOKEN_URL,
	OAUTH_CALLBACK_PORT,
	OAUTH_CALLBACK_URL,
} from "./constants";

let oauthInProgress = false;

function randomState(): string {
	return randomBytes(32).toString("hex");
}

function startCallbackServer(
	expectedState: string
): Promise<{ server: ReturnType<typeof createServer>; codePromise: Promise<string> }> {
	return new Promise((resolveStart, rejectStart) => {
		let timeoutId: ReturnType<typeof setTimeout>;
		let resolveCode: (code: string) => void;
		let rejectCode: (err: Error) => void;

		const codePromise = new Promise<string>((res, rej) => {
			resolveCode = res;
			rejectCode = rej;
		});

		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url ?? "/", `http://localhost:${OAUTH_CALLBACK_PORT}`);
			console.log(`[oauth] Callback server received request: ${url.pathname}`);

			if (url.pathname !== "/callback") {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");
			const error = url.searchParams.get("error");

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<html><body><h2>Authorization complete. You can close this tab.</h2></body></html>");

			clearTimeout(timeoutId);
			server.close();

			if (error) {
				rejectCode(new Error(`OAuth error: ${error}`));
			} else if (state !== expectedState) {
				rejectCode(new Error("OAuth state mismatch"));
			} else if (!code) {
				rejectCode(new Error("No authorization code received"));
			} else {
				resolveCode(code);
			}
		});

		server.on("error", (err) => {
			rejectStart(new Error(`Failed to start OAuth callback server: ${err.message}`));
		});

		server.listen(OAUTH_CALLBACK_PORT, () => {
			console.log(`[oauth] Callback server listening on port ${OAUTH_CALLBACK_PORT}`);

			// Timeout after 5 minutes
			timeoutId = setTimeout(
				() => {
					server.close();
					rejectCode(new Error("OAuth flow timed out"));
				},
				5 * 60 * 1000
			);

			resolveStart({ server, codePromise });
		});
	});
}

async function exchangeJiraCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(JIRA_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			grant_type: "authorization_code",
			client_id: JIRA_CLIENT_ID,
			client_secret: JIRA_CLIENT_SECRET,
			code,
			redirect_uri: OAUTH_CALLBACK_URL,
		}),
	});
	if (!res.ok) {
		throw new Error(`Jira token exchange failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function exchangeBitbucketCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const credentials = Buffer.from(`${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`).toString(
		"base64"
	);
	const res = await fetch(BITBUCKET_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${credentials}`,
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: OAUTH_CALLBACK_URL,
		}),
	});
	if (!res.ok) {
		throw new Error(`Bitbucket token exchange failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function fetchJiraCloudId(accessToken: string): Promise<{
	cloudId: string;
	siteUrl: string;
}> {
	const res = await fetch(JIRA_ACCESSIBLE_RESOURCES_URL, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch Jira accessible resources: ${res.status}`);
	}
	const resources = (await res.json()) as Array<{ id: string; name: string; url: string }>;
	if (resources.length === 0) {
		throw new Error("No Jira sites found for this account");
	}
	const site = resources[0]!;
	return { cloudId: site.id, siteUrl: site.url };
}

async function fetchJiraUser(
	accessToken: string,
	cloudId: string
): Promise<{
	accountId: string;
	displayName: string;
}> {
	const res = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch Jira user: ${res.status}`);
	}
	const user = (await res.json()) as { accountId: string; displayName: string };
	return { accountId: user.accountId, displayName: user.displayName };
}

async function fetchBitbucketUser(accessToken: string): Promise<{
	accountId: string;
	displayName: string;
}> {
	const res = await fetch("https://api.bitbucket.org/2.0/user", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch Bitbucket user: ${res.status}`);
	}
	const user = (await res.json()) as { account_id: string; display_name: string };
	return { accountId: user.account_id, displayName: user.display_name };
}

export async function connectJira(): Promise<void> {
	if (oauthInProgress) throw new Error("OAuth flow already in progress");
	oauthInProgress = true;
	try {
		const state = randomState();
		const { codePromise } = await startCallbackServer(state);

		const authUrl = `${JIRA_AUTH_URL}?audience=api.atlassian.com&client_id=${JIRA_CLIENT_ID}&scope=${encodeURIComponent(JIRA_SCOPES)}&redirect_uri=${encodeURIComponent(OAUTH_CALLBACK_URL)}&state=${state}&response_type=code&prompt=consent`;
		console.log("[oauth] Opening Jira auth URL in browser");
		shell.openExternal(authUrl);

		const code = await codePromise;
		console.log("[oauth] Jira auth code received, exchanging for tokens");
		const tokens = await exchangeJiraCode(code);
		const { cloudId, siteUrl } = await fetchJiraCloudId(tokens.access_token);
		const user = await fetchJiraUser(tokens.access_token, cloudId);

		saveAuth({
			service: "jira",
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresIn: tokens.expires_in,
			cloudId,
			siteUrl,
			accountId: user.accountId,
			displayName: user.displayName,
		});
		console.log("[oauth] Jira connected successfully");
	} finally {
		oauthInProgress = false;
	}
}

export async function connectBitbucket(): Promise<void> {
	if (oauthInProgress) throw new Error("OAuth flow already in progress");
	oauthInProgress = true;
	try {
		const state = randomState();
		const { codePromise } = await startCallbackServer(state);

		const authUrl = `${BITBUCKET_AUTH_URL}?client_id=${BITBUCKET_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_CALLBACK_URL)}&response_type=code&state=${state}`;
		console.log("[oauth] Opening Bitbucket auth URL in browser");
		shell.openExternal(authUrl);

		const code = await codePromise;
		console.log("[oauth] Bitbucket auth code received, exchanging for tokens");
		const tokens = await exchangeBitbucketCode(code);
		const user = await fetchBitbucketUser(tokens.access_token);

		saveAuth({
			service: "bitbucket",
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresIn: tokens.expires_in,
			accountId: user.accountId,
			displayName: user.displayName,
		});
		console.log("[oauth] Bitbucket connected successfully");
	} finally {
		oauthInProgress = false;
	}
}

export async function connectAll(): Promise<{ jira: boolean; bitbucket: boolean }> {
	const result = { jira: false, bitbucket: false };

	try {
		await connectJira();
		result.jira = true;
	} catch (err) {
		console.error("Jira connection failed:", err);
	}

	try {
		await connectBitbucket();
		result.bitbucket = true;
	} catch (err) {
		console.error("Bitbucket connection failed:", err);
	}

	return result;
}
