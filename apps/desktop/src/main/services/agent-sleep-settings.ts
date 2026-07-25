import { eq } from "drizzle-orm";
import { type AgentSleepSettings, DEFAULT_AGENT_SLEEP_SETTINGS } from "../../shared/agent-session";
import { getDb } from "../db";
import { appSettings } from "../db/schema";

const KEY = "agentSleep";
const VALID_IDLE_MINUTES = new Set([5, 15, 30, 60]);

function normalize(value: unknown): AgentSleepSettings {
	if (!value || typeof value !== "object") return DEFAULT_AGENT_SLEEP_SETTINGS;
	const candidate = value as Partial<AgentSleepSettings>;
	const idleMinutes = VALID_IDLE_MINUTES.has(Number(candidate.idleMinutes))
		? (Number(candidate.idleMinutes) as AgentSleepSettings["idleMinutes"])
		: DEFAULT_AGENT_SLEEP_SETTINGS.idleMinutes;
	return {
		enabled:
			typeof candidate.enabled === "boolean"
				? candidate.enabled
				: DEFAULT_AGENT_SLEEP_SETTINGS.enabled,
		idleMinutes,
		keepOrchestratorsAwake:
			typeof candidate.keepOrchestratorsAwake === "boolean"
				? candidate.keepOrchestratorsAwake
				: DEFAULT_AGENT_SLEEP_SETTINGS.keepOrchestratorsAwake,
	};
}

export function getAgentSleepSettings(): AgentSleepSettings {
	const row = getDb().select().from(appSettings).where(eq(appSettings.key, KEY)).get();
	if (!row) return DEFAULT_AGENT_SLEEP_SETTINGS;
	try {
		return normalize(JSON.parse(row.value));
	} catch {
		return DEFAULT_AGENT_SLEEP_SETTINGS;
	}
}

export function setAgentSleepSettings(settings: AgentSleepSettings): AgentSleepSettings {
	const normalized = normalize(settings);
	getDb()
		.insert(appSettings)
		.values({ key: KEY, value: JSON.stringify(normalized) })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: JSON.stringify(normalized) },
		})
		.run();
	return normalized;
}
