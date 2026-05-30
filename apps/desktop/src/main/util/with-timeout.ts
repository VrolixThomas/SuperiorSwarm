/**
 * Resolves with the inner promise's value, or with `fallback` if it does not
 * settle within `ms`. Never rejects - a rejected inner promise yields `fallback`.
 * Used at quit so a wedged fsevents/chokidar `close()` cannot stall shutdown.
 */
export function withTimeout<T>(inner: Promise<T>, ms: number, fallback: T): Promise<T> {
	return new Promise<T>((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			resolve(fallback);
		}, ms);
		inner.then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(value);
			},
			() => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(fallback);
			}
		);
	});
}
