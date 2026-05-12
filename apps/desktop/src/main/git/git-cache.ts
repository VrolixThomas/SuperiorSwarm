interface CacheEntry<T> {
	version: number;
	value: T;
}

export interface GitCache<T> {
	get(key: string, version: number, compute: () => Promise<T>): Promise<T>;
	clear(key?: string): void;
}

export function createGitCache<T>(): GitCache<T> {
	const entries = new Map<string, CacheEntry<T>>();
	const inflight = new Map<string, Promise<T>>();

	return {
		async get(key, version, compute) {
			const hit = entries.get(key);
			if (hit && hit.version === version) return hit.value;

			const inflightKey = `${key}@${version}`;
			const pending = inflight.get(inflightKey);
			if (pending) return pending;

			const promise = compute()
				.then((value) => {
					entries.set(key, { version, value });
					return value;
				})
				.finally(() => {
					inflight.delete(inflightKey);
				});
			inflight.set(inflightKey, promise);
			return promise;
		},
		clear(key) {
			if (key) entries.delete(key);
			else entries.clear();
		},
	};
}
