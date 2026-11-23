const wrap = (index: number, count: number) =>
	((index % count) + count) % count;

const windowRows = 3;
const lapRows = 18;
const extraLaps = 4;

/** A bounded strip of labels from the frozen pool. The row under the pointer is row 1. */
export function slotStrip(
	count: number,
	preview: number,
	winner?: number,
): (number | null)[] {
	if (count < 2) return [null, count ? 0 : null, null];
	const start = wrap(preview, count);
	const rows = [wrap(start - 1, count), start, wrap(start + 1, count)];
	if (winner === undefined) return rows;
	// All viewers see the same travelling strip, even if they browsed different idle rows.
	const poolSpan = Math.ceil(lapRows / count) * count;
	const lap = Array.from({ length: lapRows }, (_, step) =>
		wrap(winner - 4 + Math.round(((step - 2) * poolSpan) / lapRows), count),
	);
	// The duplicate window hides the seam. Its last label leads into the final approach.
	const landing = [-3, -2, -1, 0, 1].map((offset) =>
		wrap(winner + offset, count),
	);
	return [...rows, ...lap, ...lap.slice(0, windowRows), ...landing];
}

/** Project total travel onto the printed strip, then run through its landing rows. */
export function slotStripOffset(travel: number) {
	const laps = Math.floor(Math.max(0, travel - windowRows) / lapRows);
	return travel - Math.min(laps, extraLaps) * lapRows;
}

/** Integrate the drum's velocity so acceleration, cruising and braking meet continuously. */
export function slotMotion(
	elapsed: number,
	duration: number,
	landingRow: number,
) {
	if (landingRow === 0) return { travel: 0, speed: 0 };
	const steps = landingRow + extraLaps * lapRows;
	const t = Math.min(1, Math.max(0, elapsed / duration));
	const ramp = 0.12;
	const brake = 0.56;
	const stop = 0.94;
	const distance = brake - ramp / 2 + (stop - brake) / 3;
	const peak = (steps + 0.1) / distance;
	if (t < ramp) return { travel: (peak * t * t) / (2 * ramp), speed: t / ramp };
	if (t < brake) return { travel: peak * (t - ramp / 2), speed: 1 };
	if (t < stop) {
		const remaining = (stop - t) / (stop - brake);
		return {
			travel: peak * (distance - ((stop - brake) * remaining ** 3) / 3),
			speed: remaining ** 2,
		};
	}
	const settle = (t - stop) / (1 - stop);
	return {
		travel: steps + 0.1 * (1 - settle) ** 2 * (1 + 2 * settle),
		speed: 0,
	};
}
