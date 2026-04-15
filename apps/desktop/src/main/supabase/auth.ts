import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { shell } from "electron";
import log from "electron-log/main.js";
import { getDb } from "../db";
import { OAUTH_CALLBACK_PORT } from "../oauth-constants";
import { acquireOAuthLock, releaseOAuthLock } from "../oauth-lock";
import { markFirstSignedIn } from "../telemetry/state";
import { syncIfDue } from "../telemetry/sync";
import { supabase } from "./client";

type OAuthProvider = "github" | "google" | "apple";

function startCallbackServer(): Promise<{
	server: ReturnType<typeof createServer>;
	timeoutId: ReturnType<typeof setTimeout>;
	codePromise: Promise<string>;
}> {
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
			if (url.pathname !== "/callback") {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const code = url.searchParams.get("code");
			const error = url.searchParams.get("error");

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end("<html><body><h2>Authorization complete. You can close this tab.</h2></body></html>");

			clearTimeout(timeoutId);
			server.close();

			if (error) {
				rejectCode(new Error(`OAuth error: ${error}`));
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
			timeoutId = setTimeout(
				() => {
					server.close();
					rejectCode(new Error("OAuth flow timed out"));
				},
				5 * 60 * 1000
			);
			resolveStart({ server, timeoutId, codePromise });
		});
	});
}

export async function signIn(
	provider: OAuthProvider
): Promise<{ success: boolean; error?: string }> {
	acquireOAuthLock();
	try {
		const { server, timeoutId, codePromise } = await startCallbackServer();

		const { data, error } = await supabase.auth.signInWithOAuth({
			provider,
			options: {
				redirectTo: `http://localhost:${OAUTH_CALLBACK_PORT}/callback`,
				skipBrowserRedirect: true,
			},
		});

		if (error || !data.url) {
			clearTimeout(timeoutId);
			server.close();
			return { success: false, error: error?.message ?? "Failed to generate auth URL" };
		}

		shell.openExternal(data.url);

		const code = await codePromise;
		const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

		if (exchangeError) {
			return { success: false, error: exchangeError.message };
		}

		try {
			markFirstSignedIn(getDb());
			void syncIfDue().catch((err) => log.debug("[telemetry] signIn sync failed:", err));
		} catch (err) {
			log.debug("[telemetry] signIn hook failed:", err);
		}

		return { success: true };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
	} finally {
		releaseOAuthLock();
	}
}

export async function getSession() {
	const { data, error } = await supabase.auth.getSession();
	if (error || !data.session) return null;

	const user = data.session.user;
	return {
		id: user.id,
		email: user.email ?? null,
		provider: user.app_metadata["provider"] ?? null,
		avatar: user.user_metadata["avatar_url"] ?? null,
	};
}

export async function signOut(): Promise<void> {
	await supabase.auth.signOut();
}
