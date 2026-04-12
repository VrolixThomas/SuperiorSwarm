let boundPort: number | null = null;

export function setAgentNotifyPort(port: number): void {
	boundPort = port;
}

export function getAgentNotifyPort(): number | null {
	return boundPort;
}
