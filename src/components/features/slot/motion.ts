const wrap = (index: number, count: number) =>
	((index % count) + count) % count;

const windowRows = 3;
export const defaultSlotMaxBlurPx = 1.6;
const lapRows = 18;
const extraLaps = (power: number) => 4 + Math.round(6 * power);

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
export function slotStripOffset(travel: number, power = 0) {
	const laps = Math.floor(Math.max(0, travel - windowRows) / lapRows);
	return travel - Math.min(laps, extraLaps(power)) * lapRows;
}

/** Integrate the drum's velocity so acceleration, cruising and braking meet continuously. */
export function slotMotion(
	elapsed: number,
	duration: number,
	landingRow: number,
	power = 0,
) {
	if (landingRow === 0) return { travel: 0, speed: 0 };
	const steps = landingRow + extraLaps(power) * lapRows;
	const t = Math.min(1, Math.max(0, elapsed / duration));
	const ramp = 0.12 - power * 0.04;
	const brake = 0.56 + power * 0.04;
	const stop = 0.94;
	const distance = brake - ramp / 2 + (stop - brake) / 3;
	const peak = (steps + 0.1) / distance;
	const topSpeed = 1 + power * 0.32;
	if (t < ramp)
		return {
			travel: (peak * t * t) / (2 * ramp),
			speed: (topSpeed * t) / ramp,
		};
	if (t < brake) return { travel: peak * (t - ramp / 2), speed: topSpeed };
	if (t < stop) {
		const remaining = (stop - t) / (stop - brake);
		return {
			travel: peak * (distance - ((stop - brake) * remaining ** 3) / 3),
			speed: topSpeed * remaining ** 2,
		};
	}
	const settle = (t - stop) / (1 - stop);
	return {
		travel: steps + 0.1 * (1 - settle) ** 2 * (1 + 2 * settle),
		speed: 0,
	};
}

/** The spring catches over the last half row, while the reel still has momentum. */
export function slotDetentPosition(position: number, target: number) {
	const gap = target - position;
	const engagement = Math.max(0, 1 - 2 * Math.abs(gap));
	return position + 2.6 * gap * engagement ** 2;
}
