const DOUBLE_TAP_MS = 400;
const NO_PENDING_TAP_AT = Number.NEGATIVE_INFINITY;

export type DetectorKeyEvent = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
};

export function createDoubleShiftDetector(onTrigger: () => void): {
	keydown(e: DetectorKeyEvent, now: number): void;
	keyup(e: DetectorKeyEvent, now: number): void;
} {
	let shiftDown = false;
	let dirty = false;
	let lastTapAt = NO_PENDING_TAP_AT;

	function hasModifier(e: DetectorKeyEvent): boolean {
		return e.metaKey || e.ctrlKey || e.altKey;
	}

	return {
		keydown(e) {
			if (e.key === "Shift") {
				if (!shiftDown) {
					shiftDown = true;
					dirty = hasModifier(e);
				} else if (hasModifier(e)) {
					dirty = true;
				}
				return;
			}

			if (shiftDown) {
				dirty = true;
			}
			lastTapAt = NO_PENDING_TAP_AT;
		},
		keyup(e, now) {
			if (e.key !== "Shift") {
				if (shiftDown) {
					dirty = true;
				}
				lastTapAt = NO_PENDING_TAP_AT;
				return;
			}

			const wasClean = shiftDown && !dirty;
			shiftDown = false;
			dirty = false;

			if (!wasClean) {
				lastTapAt = NO_PENDING_TAP_AT;
				return;
			}

			if (now - lastTapAt <= DOUBLE_TAP_MS) {
				lastTapAt = NO_PENDING_TAP_AT;
				onTrigger();
				return;
			}

			lastTapAt = now;
		},
	};
}
