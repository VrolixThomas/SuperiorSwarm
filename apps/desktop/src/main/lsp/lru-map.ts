export class LruMap<K, V> {
	private readonly map = new Map<K, V>();

	constructor(private readonly maxSize: number) {
		if (maxSize <= 0) throw new Error("LruMap maxSize must be > 0");
	}

	get size(): number {
		return this.map.size;
	}

	get(key: K): V | undefined {
		if (!this.map.has(key)) return undefined;
		const value = this.map.get(key) as V;
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}

	has(key: K): boolean {
		return this.map.has(key);
	}

	set(key: K, value: V): void {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		if (this.map.size > this.maxSize) {
			const oldest = this.map.keys().next().value as K | undefined;
			if (oldest !== undefined) this.map.delete(oldest);
		}
	}

	delete(key: K): boolean {
		return this.map.delete(key);
	}

	clear(): void {
		this.map.clear();
	}

	keys(): IterableIterator<K> {
		return this.map.keys();
	}
}
