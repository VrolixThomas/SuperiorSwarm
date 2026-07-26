let boundPort: number | null = null;
let authToken: string | null = null;

export function setAgentNotifyPort(port: number | null): void {
	boundPort = port;
}

export function getAgentNotifyPort(): number | null {
	return boundPort;
}

export function setAgentNotifyToken(token: string | null): void {
	authToken = token;
}

export function getAgentNotifyToken(): string | null {
	return authToken;
}
