/** Shared promise prevents timer/manual refresh races and duplicate observations. */
export function coalescePoll(poll: () => Promise<void>): () => Promise<void> {
	let running: Promise<void> | undefined;
	return () => {
		if (!running)
			running = Promise.resolve()
				.then(poll)
				.finally(() => {
					running = undefined;
				});
		return running;
	};
}

/** At most eight checks per cycle, four in flight; failures back off up to 30 minutes. */
export class PRConfirmationBudget {
	private checks = new Map<string, { nextAt: number; failures: number }>();
	async run<T extends { key: string }>(
		candidates: T[],
		check: (candidate: T) => Promise<void>,
		now = Date.now()
	): Promise<void> {
		const keys = new Set(candidates.map((c) => c.key));
		for (const key of this.checks.keys()) if (!keys.has(key)) this.checks.delete(key);
		const due = candidates
			.filter((c) => (this.checks.get(c.key)?.nextAt ?? 0) <= now)
			.sort((a, b) => (this.checks.get(a.key)?.nextAt ?? 0) - (this.checks.get(b.key)?.nextAt ?? 0))
			.slice(0, 8);
		let index = 0;
		await Promise.all(
			Array.from({ length: Math.min(4, due.length) }, async () => {
				for (;;) {
					const candidate = due[index++];
					if (!candidate) break;
					const prior = this.checks.get(candidate.key);
					try {
						await check(candidate);
						this.checks.set(candidate.key, { nextAt: now + 300_000, failures: 0 });
					} catch {
						const failures = (prior?.failures ?? 0) + 1;
						this.checks.set(candidate.key, {
							nextAt: now + Math.min(1_800_000, 60_000 * 2 ** Math.min(failures - 1, 5)),
							failures,
						});
					}
				}
			})
		);
	}
}
