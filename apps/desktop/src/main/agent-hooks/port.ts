let boundPort: number | null = null;

export function setAgentNotifyPort(port: number | null): void {
	boundPort = port;
}

export function getAgentNotifyPort(): number | null {
	return boundPort;
}
