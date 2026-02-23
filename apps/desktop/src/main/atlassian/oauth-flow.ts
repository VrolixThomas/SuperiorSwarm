import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { shell } from "electron";
import { saveAuth } from "./auth";
import {
	BITBUCKET_AUTH_URL,
	BITBUCKET_CLIENT_ID,
	BITBUCKET_CLIENT_SECRET,
	BITBUCKET_TOKEN_URL,
	JIRA_AUTH_URL,
	JIRA_ACCESSIBLE_RESOURCES_URL,
	JIRA_CLIENT_ID,
	JIRA_CLIENT_SECRET,
	JIRA_SCOPES,
	JIRA_TOKEN_URL,
	OAUTH_CALLBACK_PORT,
	OAUTH_CALLBACK_URL,
} from "./constants";

function randomState(): string {
	return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function waitForCallback(expectedState: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			const url = new URL(req.url ?? "/", `http://localhost:${OAUTH_CALLBACK_PORT}`);

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

			server.close();

			if (error) {
				reject(new Error(`OAuth error: ${error}`));
			} else if (state !== expectedState) {
				reject(new Error("OAuth state mismatch"));
			} else if (!code) {
				reject(new Error("No authorization code received"));
			} else {
				resolve(code);
			}
		});

		server.listen(OAUTH_CALLBACK_PORT);

		// Timeout after 5 minutes
		setTimeout(() => {
			server.close();
			reject(new Error("OAuth flow timed out"));
		}, 5 * 60 * 1000);
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
	const credentials = Buffer.from(`${BITBUCKET_CLIENT_ID}:${BITBUCKET_CLIENT_SECRET}`).toString("base64");
	const res = await fetch(BITBUCKET_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Basic ${credentials}`,
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
		}),
	});
	if (!res.ok) {
		throw new Error(`Bitbucket token exchange failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function fetchJiraCloudId(accessToken: string): Promise<{
	cloudId: string;
	siteName: string;
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
	return { cloudId: site.id, siteName: site.name };
}

async function fetchJiraUser(accessToken: string, cloudId: string): Promise<{
	accountId: string;
	displayName: string;
}> {
	const res = await fetch(
		`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/json",
			},
		}
	);
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
	const state = randomState();
	const authUrl = `${JIRA_AUTH_URL}?audience=api.atlassian.com&client_id=${JIRA_CLIENT_ID}&scope=${encodeURIComponent(JIRA_SCOPES)}&redirect_uri=${encodeURIComponent(OAUTH_CALLBACK_URL)}&state=${state}&response_type=code&prompt=consent`;

	shell.openExternal(authUrl);
	const code = await waitForCallback(state);
	const tokens = await exchangeJiraCode(code);
	const { cloudId } = await fetchJiraCloudId(tokens.access_token);
	const user = await fetchJiraUser(tokens.access_token, cloudId);

	saveAuth({
		service: "jira",
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresIn: tokens.expires_in,
		cloudId,
		accountId: user.accountId,
		displayName: user.displayName,
	});
}

export async function connectBitbucket(): Promise<void> {
	const state = randomState();
	const authUrl = `${BITBUCKET_AUTH_URL}?client_id=${BITBUCKET_CLIENT_ID}&response_type=code&state=${state}`;

	shell.openExternal(authUrl);
	const code = await waitForCallback(state);
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
