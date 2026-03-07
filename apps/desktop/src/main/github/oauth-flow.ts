import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { shell } from "electron";
import { acquireOAuthLock, releaseOAuthLock } from "../oauth-lock";
import { saveAuth } from "./auth";
import {
	GITHUB_API_BASE,
	GITHUB_AUTH_URL,
	GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET,
	GITHUB_SCOPES,
	GITHUB_TOKEN_URL,
	OAUTH_CALLBACK_PORT,
	OAUTH_CALLBACK_URL,
} from "./constants";

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
			console.log(`[github-oauth] Callback received: ${url.pathname}`);

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
			console.log(`[github-oauth] Callback server listening on port ${OAUTH_CALLBACK_PORT}`);

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

async function exchangeCode(code: string): Promise<{ access_token: string }> {
	const res = await fetch(GITHUB_TOKEN_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			client_id: GITHUB_CLIENT_ID,
			client_secret: GITHUB_CLIENT_SECRET,
			code,
			redirect_uri: OAUTH_CALLBACK_URL,
		}),
	});
	if (!res.ok) {
		throw new Error(`GitHub token exchange failed: ${res.status} ${await res.text()}`);
	}
	const data = (await res.json()) as { access_token?: string; error?: string };
	if (data.error || !data.access_token) {
		throw new Error(`GitHub token exchange error: ${data.error ?? "no access_token returned"}`);
	}
	return { access_token: data.access_token };
}

async function fetchViewer(
	accessToken: string
): Promise<{ id: number; login: string; name: string | null }> {
	const res = await fetch(`${GITHUB_API_BASE}/user`, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
		},
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch GitHub user: ${res.status}`);
	}
	return res.json();
}

export async function connectGitHub(): Promise<void> {
	acquireOAuthLock();
	try {
		const state = randomState();
		const { codePromise } = await startCallbackServer(state);

		const authUrl = `${GITHUB_AUTH_URL}?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_CALLBACK_URL)}&scope=${encodeURIComponent(GITHUB_SCOPES)}&state=${state}`;

		console.log("[github-oauth] Opening GitHub auth URL in browser");
		shell.openExternal(authUrl);

		const code = await codePromise;
		console.log("[github-oauth] Auth code received, exchanging for token");
		const { access_token } = await exchangeCode(code);
		const viewer = await fetchViewer(access_token);

		saveAuth({
			accessToken: access_token,
			accountId: String(viewer.id),
			displayName: viewer.name ?? viewer.login,
		});
		console.log("[github-oauth] GitHub connected successfully");
	} finally {
		releaseOAuthLock();
	}
}
