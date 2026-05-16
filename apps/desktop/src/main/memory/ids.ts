import { nanoid } from "nanoid";

export function newMemoryId(prefix: string): string {
	return `${prefix}_${nanoid(12)}`;
}
