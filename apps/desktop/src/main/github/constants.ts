// OAuth credentials injected at build time via environment variables.
// Set these in .env (gitignored). See .env.example for required variables.
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";

// Reuse the shared OAuth callback port/URL from the Atlassian integration
export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_URL } from "../atlassian/constants";

export const GITHUB_AUTH_URL = "https://github.com/login/oauth/authorize";
export const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
export const GITHUB_API_BASE = "https://api.github.com";

// repo scope covers read access to both public and private repositories
export const GITHUB_SCOPES = "repo";
