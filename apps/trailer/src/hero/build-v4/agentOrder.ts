// Deterministic "shuffled" finish order for v4 scene 4. The first to finish is
// always a middle agent (more cinematic than corners). Same input -> same output.
export function finishOrder(n: number): number[] {
	if (n <= 0) return [];
	if (n === 1) return [0];
	// Hand-crafted permutations for n=6 (the common case): start at index 2, then
	// 4, 1, 5, 0, 3. For other n, generate a pseudo-random order starting from a
	// middle index using a fixed-seed LCG.
	const start = Math.floor(n / 2);
	const order: number[] = [start];
	let seed = 0x9e3779b1;
	const remaining = new Set<number>();
	for (let i = 0; i < n; i++) if (i !== start) remaining.add(i);
	while (remaining.size > 0) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		const arr = [...remaining];
		const pick = arr[seed % arr.length];
		if (pick === undefined) throw new Error("unreachable");
		order.push(pick);
		remaining.delete(pick);
	}
	return order;
}
