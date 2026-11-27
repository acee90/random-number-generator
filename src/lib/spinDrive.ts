import { type DrawView, readDrawView } from "./drawView";

export type SpinTuning = {
	initialSpeed: number;
	maxSpeed: number;
	acceleration: number;
	coastSeconds: number;
};

type SlotBrake = {
	easeOutSeconds: number;
	brakeStrength: number;
};

export const defaultSlotBrake: Readonly<SlotBrake> = {
	easeOutSeconds: 0.6,
	brakeStrength: 0.32,
};

export const maxSlotBrakeTravelRatio = 0.8;

export const slotBrakeLimits = {
	easeOutSeconds: { min: 0.15, max: 2.5, step: 0.05 },
	brakeStrength: { min: 0.05, max: 0.7, step: 0.01 },
};

/** Position is measured in turns on the wheel and rows on the reel. */
export interface SpinDrive {
	held: boolean;
	at: number;
	position: number;
	speed: number;
	sequence: number;
	regripSequence?: number;
	tuning?: SpinTuning;
	slotBrake?: SlotBrake;
	stopAt?: number;
	target?: number;
	slotOffset?: number;
	slotSeams?: { row: number; offset: number }[];
}

const legacyMotor = {
	wheel: { maxSpeed: 3, acceleration: 1.05 },
	"slot-v1": { maxSpeed: 26, acceleration: 10 },
};

const defaultTuning: Record<DrawView, SpinTuning> = {
	wheel: { initialSpeed: 1.725, maxSpeed: 5, acceleration: 2, coastSeconds: 7 },
	"slot-v1": {
		initialSpeed: 13.5,
		maxSpeed: 42,
		acceleration: 17,
		coastSeconds: 4,
	},
};

const tuningLimits = {
	wheel: {
		initialSpeed: { min: 0.75, max: 3, step: 0.025 },
		maxSpeed: { min: 3, max: 8, step: 0.25 },
		acceleration: { min: 0.5, max: 5, step: 0.1 },
		coastSeconds: { min: 3, max: 10, step: 0.25 },
	},
	"slot-v1": {
		initialSpeed: { min: 6, max: 24, step: 0.5 },
		maxSpeed: { min: 24, max: 64, step: 1 },
		acceleration: { min: 4, max: 36, step: 1 },
		coastSeconds: { min: 3, max: 10, step: 0.25 },
	},
} as const;

export function getDefaultSpinTuning(mode: DrawView): SpinTuning {
	return { ...defaultTuning[mode] };
}

export function getDefaultTapBoost(mode: DrawView) {
	return defaultTuning[mode].initialSpeed;
}

export function getRegripSpeed(
	speed: number,
	maxSpeed: number,
	tapBoost: number,
) {
	return Math.min(maxSpeed, speed + tapBoost);
}

export function getSpinTuningLimits(mode: DrawView) {
	return tuningLimits[mode];
}

export function isSpinTuning(
	value: unknown,
	mode?: DrawView,
): value is SpinTuning {
	if (!value || typeof value !== "object") return false;
	if (!mode)
		return isSpinTuning(value, "wheel") || isSpinTuning(value, "slot-v1");
	const tuning = value as Partial<SpinTuning>;
	const limits = tuningLimits[mode];
	return (Object.keys(limits) as (keyof SpinTuning)[]).every((key) => {
		const n = tuning[key];
		return (
			typeof n === "number" && n >= limits[key].min && n <= limits[key].max
		);
	});
}

export function startSpinDrive(
	at: number,
	mode: DrawView,
	position = 0,
	tuning?: SpinTuning,
): SpinDrive {
	const { initialSpeed, maxSpeed, acceleration, coastSeconds } = isSpinTuning(
		tuning,
		mode,
	)
		? tuning
		: getDefaultSpinTuning(mode);
	return {
		held: true,
		at,
		position,
		speed: initialSpeed,
		sequence: 0,
		tuning: { initialSpeed, maxSpeed, acceleration, coastSeconds },
		...(mode === "slot-v1" ? { slotBrake: { ...defaultSlotBrake } } : {}),
	};
}

const brakeShare = 0.32;
const brakeExponent = 14;
const preferredTravel = 0.31;
const maxBrakeTravel = (1 - brakeShare) / 2 + brakeShare / (2 + brakeExponent);

function sampleSlotCoast(
	position: number,
	speed: number,
	target: number,
	duration: number,
	t: number,
	{ easeOutSeconds, brakeStrength }: SlotBrake,
) {
	const distance = target - position;
	const capacity = speed * duration;
	const ratio = distance / capacity;
	const left = 1 - t;

	if (ratio <= maxSlotBrakeTravelRatio) {
		// Fit the tail to the chosen detent and actual deadline. Leave some
		// decay in the tail even when a short coast needs to cover more travel.
		const earlyDecay = duration / easeOutSeconds;
		const tailCapacity = 1 / 1.1;
		const earlyCapacity = 1 / (1.1 + earlyDecay);
		const earlyShare = Math.min(
			brakeStrength,
			(tailCapacity - ratio) / (tailCapacity - earlyCapacity),
		);
		const coefficient = 1 - ratio * earlyDecay;
		const tailIntegral =
			(coefficient +
				Math.sqrt(
					coefficient ** 2 + 4 * ratio * (1 - earlyShare) * earlyDecay,
				)) /
			(2 * ratio);
		const earlyIntegral = tailIntegral + earlyDecay;
		const tail = (1 - earlyShare) * left ** (tailIntegral - 1);
		const early = earlyShare * left ** (earlyIntegral - 1);
		return {
			position:
				target -
				capacity * left * (tail / tailIntegral + early / earlyIntegral),
			speed: speed * (tail + early),
		};
	}

	// A near-stopped reel can carry its remaining velocity and then creep
	// forward to the detent, including when it starts at zero speed.
	const carryIntegral = Math.max(2, (2 * capacity) / distance);
	const carryDistance = capacity / carryIntegral;
	const creepDistance = distance - carryDistance;
	return {
		position:
			position +
			carryDistance * (1 - left ** carryIntegral) +
			creepDistance * t ** 3 * (10 - 15 * t + 6 * t ** 2),
		speed:
			speed * left ** (carryIntegral - 1) +
			(30 * creepDistance * t ** 2 * left ** 2) / duration,
	};
}

export function sampleSpinDrive(drive: SpinDrive, at: number, mode: DrawView) {
	const seconds = Math.max(0, (at - drive.at) / 1000);
	if (!drive.held && drive.stopAt !== undefined && drive.target !== undefined) {
		if (at >= drive.stopAt) return { position: drive.target, speed: 0 };
		const duration = (drive.stopAt - drive.at) / 1000;
		const t = Math.min(1, seconds / duration);
		const distance = drive.target - drive.position;
		const left = 1 - t;
		if (t === 0) return { position: drive.position, speed: drive.speed };
		if (
			mode === "slot-v1" &&
			drive.slotBrake &&
			distance > 0 &&
			drive.speed >= 0
		)
			return sampleSlotCoast(
				drive.position,
				drive.speed,
				drive.target,
				duration,
				t,
				drive.slotBrake,
			);
		if (!drive.tuning && distance >= 0 && drive.speed > 0) {
			return {
				position: drive.position + distance * t * (2 - t),
				speed: drive.speed * left,
			};
		}
		const travelRatio = distance / (drive.speed * duration);
		if (drive.speed > 0 && travelRatio > 0 && travelRatio <= maxBrakeTravel) {
			// Blend quick braking and a longer tail. Solve the integrated speed
			// for the tail exponent so the curve reaches the locked detent.
			const coefficient = 1 - travelRatio * brakeExponent;
			const tailIntegral =
				(coefficient +
					Math.sqrt(
						coefficient ** 2 +
							4 * travelRatio * (1 - brakeShare) * brakeExponent,
					)) /
				(2 * travelRatio);
			const brakeIntegral = tailIntegral + brakeExponent;
			const tail = left ** (tailIntegral - 1);
			const brake = left ** (brakeIntegral - 1);
			return {
				position:
					drive.target -
					drive.speed *
						duration *
						left *
						(((1 - brakeShare) * tail) / tailIntegral +
							(brakeShare * brake) / brakeIntegral),
				speed: drive.speed * ((1 - brakeShare) * tail + brakeShare * brake),
			};
		}
		// A late tap can leave very little velocity, or carry the wheel or
		// reel just past the detent. Ease onto it with continuous velocity.
		if (drive.tuning) {
			return {
				position:
					drive.position +
					drive.speed * duration * t * left ** 3 +
					distance * t ** 3 * (10 - 15 * t + 6 * t ** 2),
				speed:
					left ** 2 *
					(drive.speed * (1 - 4 * t) + (30 * distance * t ** 2) / duration),
			};
		}
		return {
			position:
				drive.position +
				drive.speed * duration * t * left ** 2 +
				distance * t ** 2 * (3 - 2 * t),
			speed:
				drive.speed * left * (1 - 3 * t) + (6 * distance * t * left) / duration,
		};
	}
	const { maxSpeed, acceleration } = drive.tuning ?? legacyMotor[mode];
	const accelerating = Math.min(
		seconds,
		Math.max(0, (maxSpeed - drive.speed) / acceleration),
	);
	return {
		position:
			drive.position +
			drive.speed * accelerating +
			(acceleration * accelerating ** 2) / 2 +
			maxSpeed * (seconds - accelerating),
		speed: Math.min(maxSpeed, drive.speed + acceleration * seconds),
	};
}

function wrap(value: number, period: number) {
	return ((value % period) + period) % period;
}

function slotOffset(row: number, drive?: SpinDrive) {
	let offset = drive?.slotOffset ?? 0;
	for (const seam of drive?.slotSeams ?? []) {
		if (seam.row > row) break;
		offset = seam.offset;
	}
	return offset;
}

export function getSpinSlotIndex(
	row: number,
	count: number,
	drive?: SpinDrive,
) {
	return count > 0 ? wrap(row + slotOffset(row, drive), count) : 0;
}

function forwardTarget(
	position: number,
	desired: number,
	landing: number,
	period: number,
) {
	const first = position + wrap(landing - position, period);
	return first + Math.max(0, Math.round((desired - first) / period)) * period;
}

export function changeSpinDrive(
	drive: SpinDrive,
	held: boolean,
	sequence: number,
	at: number,
	mode: DrawView,
	landing: number,
	period: number,
	tapBoost = getDefaultTapBoost(mode),
): SpinDrive {
	if (
		sequence <= drive.sequence ||
		(!drive.held && at >= (drive.stopAt ?? Infinity))
	)
		return drive;
	if (drive.held === held) return { ...drive, sequence };
	at = Math.max(at, drive.at);
	const { position, speed } = sampleSpinDrive(drive, at, mode);
	const next: SpinDrive = { held, at, sequence, position, speed };
	const tuning = drive.tuning;
	if (tuning) next.tuning = tuning;
	if (drive.slotBrake) next.slotBrake = drive.slotBrake;
	if (drive.regripSequence !== undefined)
		next.regripSequence = drive.regripSequence;
	if (drive.slotOffset) next.slotOffset = drive.slotOffset;
	if (drive.slotSeams?.length) next.slotSeams = drive.slotSeams;
	if (held) {
		if (tuning && tapBoost > 0) {
			next.speed = getRegripSpeed(speed, tuning.maxSpeed, tapBoost);
			next.regripSequence = sequence;
		}
		return next;
	}

	if (tuning && speed < tuning.initialSpeed * 0.2) {
		const closestMark =
			mode === "wheel"
				? landing + Math.round((position - landing) / period) * period
				: Math.round(position);
		const nearMark =
			mode === "wheel"
				? Math.abs(closestMark - position) <= 0.15
				: getSpinSlotIndex(closestMark, period, drive) === landing;
		if (closestMark >= 0 && nearMark) {
			next.target = closestMark;
			next.stopAt = at + 1100;
			return next;
		}
	}

	const coast =
		tuning?.coastSeconds ?? 4.5 + (2.5 * speed) / legacyMotor[mode].maxSpeed;
	const travel = tuning
		? Math.max(0, speed) * coast * preferredTravel
		: (speed * coast) / 2;
	const desired = position + travel;
	let target = forwardTarget(position, desired, landing, period);
	if (mode === "slot-v1") {
		// Keep the rows in view on a regrip. Only labels entering the far
		// edge of the window may change to join the winner's neighborhood.
		const firstVisible = Math.floor(position) - 3;
		const firstHidden = Math.ceil(position) + 4;
		const retained = (drive.slotSeams ?? []).filter(
			(s) => s.row > firstVisible && s.row < firstHidden,
		);
		const base = slotOffset(firstVisible, drive);
		const lastOffset = retained.at(-1)?.offset ?? base;
		target = Math.round(
			forwardTarget(position, desired, landing - lastOffset, period),
		);
		const planned = Math.round(desired);
		if (
			(planned > firstHidden || (tuning && target > firstHidden)) &&
			Math.abs(target - desired) > Math.max(2, travel * 0.18)
		) {
			target = Math.max(firstHidden + 1, planned);
			const row = Math.max(firstHidden, Math.round((position + target) / 2));
			retained.push({ row, offset: wrap(landing - target, period) });
		}
		// If an older seam is still in view it may already carry the winner.
		for (let row = Math.ceil(position); row < firstHidden; row++) {
			if (
				getSpinSlotIndex(row, period, drive) === landing &&
				Math.abs(row - desired) < Math.abs(target - desired)
			)
				target = row;
		}
		delete next.slotSeams;
		delete next.slotOffset;
		if (base) next.slotOffset = base;
		if (retained.length) next.slotSeams = retained;
	}
	if (tuning) {
		const minimumCoast = (target - position) / (speed * maxBrakeTravel);
		// A detent may sit farther out than the normal braking distance. Allow
		// a small timing adjustment, and use the settling curve if motor speed
		// is too low to cover it within that time.
		const boundedCoast =
			speed > 0 && minimumCoast <= coast + 1.5
				? Math.max(coast, minimumCoast)
				: coast;
		next.target = target;
		next.stopAt = at + Math.ceil(boundedCoast * 1000);
		return next;
	}
	let coastMs = (2000 * (target - position)) / Math.max(speed, 1e-9);
	if (coastMs > 9500 || speed <= 0) {
		// At crawling speed an extra lap could take minutes. Capture the mark
		// just crossed if a brief regrip carried the wheel or reel past it.
		const previousMark =
			mode === "wheel"
				? landing + Math.floor((position - landing) / period) * period
				: Math.floor(position);
		const nearMark =
			mode === "wheel"
				? position - previousMark <= 0.15
				: getSpinSlotIndex(previousMark, period, next) === landing;
		if (previousMark >= 0 && nearMark) {
			target = previousMark;
			coastMs = 1100;
		}
	}
	next.target = target;
	next.stopAt = at + Math.max(1, Math.round(coastMs));
	return next;
}

export function getSpinDeadline(draw: {
	startedAt: number;
	durationMs: number;
	drive?: SpinDrive;
}) {
	return draw.drive
		? (draw.drive.stopAt ?? Infinity)
		: draw.startedAt + draw.durationMs;
}

export function getSpinLanding(draw: {
	viewMode?: DrawView;
	candidates: readonly unknown[];
	winnerIndex: number;
	toRotation: number;
}) {
	const mode = readDrawView(draw.viewMode);
	return mode === "wheel"
		? { mode, landing: wrap(draw.toRotation / 360, 1), period: 1 }
		: { mode, landing: draw.winnerIndex, period: draw.candidates.length };
}

function isSlotBrake(value: unknown): value is SlotBrake {
	if (!value || typeof value !== "object") return false;
	const brake = value as Partial<SlotBrake>;
	return (Object.keys(slotBrakeLimits) as (keyof SlotBrake)[]).every((key) => {
		const n = brake[key];
		return (
			typeof n === "number" &&
			n >= slotBrakeLimits[key].min &&
			n <= slotBrakeLimits[key].max
		);
	});
}

export function isSpinDrive(
	value: unknown,
	mode?: DrawView,
): value is SpinDrive {
	if (!value || typeof value !== "object") return false;
	const d = value as Partial<SpinDrive>;
	const integer = (n: unknown): n is number =>
		typeof n === "number" && Number.isSafeInteger(n);
	const positive = (n: unknown): n is number =>
		typeof n === "number" && Number.isFinite(n) && n >= 0;
	return (
		typeof d.held === "boolean" &&
		integer(d.at) &&
		d.at >= 0 &&
		integer(d.sequence) &&
		d.sequence >= 0 &&
		(d.regripSequence === undefined ||
			(integer(d.regripSequence) &&
				d.regripSequence > 0 &&
				d.regripSequence <= d.sequence)) &&
		positive(d.position) &&
		(d.tuning === undefined || isSpinTuning(d.tuning, mode)) &&
		(d.slotBrake === undefined ||
			(mode !== "wheel" &&
				d.tuning !== undefined &&
				isSlotBrake(d.slotBrake))) &&
		typeof d.speed === "number" &&
		Math.abs(d.speed) <=
			(d.tuning?.maxSpeed ?? legacyMotor["slot-v1"].maxSpeed) &&
		(d.slotOffset === undefined || integer(d.slotOffset)) &&
		(d.slotSeams === undefined ||
			(Array.isArray(d.slotSeams) &&
				d.slotSeams.length <= 10 &&
				d.slotSeams.every(
					(s, i, a) =>
						s &&
						integer(s.row) &&
						integer(s.offset) &&
						(!i || a[i - 1].row < s.row),
				))) &&
		(d.held
			? d.stopAt === undefined && d.target === undefined
			: integer(d.stopAt) && d.stopAt > d.at && positive(d.target))
	);
}
