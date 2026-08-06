export interface HermesChatScrollMetrics {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}

const HERMES_CHAT_BOTTOM_THRESHOLD_PX = 80;

export function isHermesChatNearBottom(
	metrics: HermesChatScrollMetrics,
	threshold = HERMES_CHAT_BOTTOM_THRESHOLD_PX
): boolean {
	return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold;
}

export function shouldAnchorHermesChat(input: {
	initialHistory: boolean;
	following: boolean;
}): boolean {
	return input.initialHistory || input.following;
}
