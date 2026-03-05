// OAuth credentials injected at build time via environment variables.
// Set these in .env (gitignored). See .env.example for required variables.
export const LINEAR_CLIENT_ID = process.env.LINEAR_CLIENT_ID ?? "";
export const LINEAR_CLIENT_SECRET = process.env.LINEAR_CLIENT_SECRET ?? "";

// Reuse the shared OAuth callback port/URL from the Atlassian integration
export { OAUTH_CALLBACK_PORT, OAUTH_CALLBACK_URL } from "../atlassian/constants";

export const LINEAR_AUTH_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
export const LINEAR_API_URL = "https://api.linear.app/graphql";

// Scopes: read + write for issue management.
// Linear automatically includes a refresh token in the Authorization Code response.
export const LINEAR_SCOPES = "read,write";
