import type { TaskRegistry } from "../control-plane/task-registry";

let registry: TaskRegistry | null = null;

export function setTaskRegistry(r: TaskRegistry): void {
	registry = r;
}

export function getTaskRegistry(): TaskRegistry {
	if (!registry) throw new Error("task registry not initialized");
	return registry;
}
