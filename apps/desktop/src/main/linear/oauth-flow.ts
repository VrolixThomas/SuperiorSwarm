import { randomBytes } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { shell } from "electron";
import { acquireOAuthLock, releaseOAuthLock } from "../oauth-lock";
import { saveAuth } from "./auth";
import {
	LINEAR_API_URL,
	LINEAR_AUTH_URL,
	LINEAR_CLIENT_ID,
	LINEAR_CLIENT_SECRET,
	LINEAR_SCOPES,
	LINEAR_TOKEN_URL,
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
			console.log(`[linear-oauth] Callback received: ${url.pathname}`);

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
			console.log(`[linear-oauth] Callback server listening on port ${OAUTH_CALLBACK_PORT}`);

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

async function exchangeCode(code: string): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> {
	const res = await fetch(LINEAR_TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: LINEAR_CLIENT_ID,
			client_secret: LINEAR_CLIENT_SECRET,
			code,
			redirect_uri: OAUTH_CALLBACK_URL,
		}),
	});
	if (!res.ok) {
		throw new Error(`Linear token exchange failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

async function fetchViewer(
	accessToken: string
): Promise<{ id: string; name: string; email: string | null }> {
	const res = await fetch(LINEAR_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query: "{ viewer { id name email } }" }),
	});
	if (!res.ok) {
		throw new Error(`Failed to fetch Linear viewer: ${res.status}`);
	}
	const data = (await res.json()) as {
		data: { viewer: { id: string; name: string; email: string | null } };
	};
	return data.data.viewer;
}

export async function connectLinear(): Promise<void> {
	acquireOAuthLock();
	try {
		const state = randomState();
		const { codePromise } = await startCallbackServer(state);

		const authUrl = `${LINEAR_AUTH_URL}?client_id=${LINEAR_CLIENT_ID}&redirect_uri=${encodeURIComponent(OAUTH_CALLBACK_URL)}&response_type=code&scope=${encodeURIComponent(LINEAR_SCOPES)}&state=${state}`;

		console.log("[linear-oauth] Opening Linear auth URL in browser");
		shell.openExternal(authUrl);

		const code = await codePromise;
		console.log("[linear-oauth] Auth code received, exchanging for tokens");
		const tokens = await exchangeCode(code);
		const viewer = await fetchViewer(tokens.access_token);

		if (!tokens.refresh_token) throw new Error("Linear did not return a refresh token");
		saveAuth({
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			expiresIn: tokens.expires_in,
			accountId: viewer.id,
			displayName: viewer.name,
			email: viewer.email,
		});
		console.log("[linear-oauth] Linear connected successfully");
	} finally {
		releaseOAuthLock();
	}
}
