import {
	canRegripSpinDrive,
	changeSpinDrive,
	defaultSlotBrake,
	getDefaultSpinTuning,
	getDefaultTapBoost,
	getSpinTuningLimits,
	maxSlotBrakeTravelRatio,
	type SpinDrive,
	type SpinTuning,
	sampleSpinDrive,
	slotBrakeLimits,
	startSpinDrive,
} from "@/lib/spinDrive";

const mode = "slot-v1";
const maxCreepSpeed = 2;

export type SlotTuning = SpinTuning & {
	tapBoost: number;
	easeInSeconds: number;
	easeOutSeconds: number;
	brakeStrength: number;
};

export const slotTuningLimits = {
	...getSpinTuningLimits(mode),
	tapBoost: { min: 0, max: 24, step: 0.5 },
	easeInSeconds: { min: 0, max: 3, step: 0.05 },
	...slotBrakeLimits,
};

export function getDefaultSlotTuning(): SlotTuning {
	return {
		...getDefaultSpinTuning(mode),
		tapBoost: getDefaultTapBoost(mode),
		easeInSeconds: 0,
		...defaultSlotBrake,
	};
}

export type TunedSlotDrive = SpinDrive & {
	slotTuning: SlotTuning;
	easeInAt: number;
	releasedAt?: number;
};

function motorTuning({
	initialSpeed,
	maxSpeed,
	acceleration,
	coastSeconds,
}: SlotTuning): SpinTuning {
	return { initialSpeed, maxSpeed, acceleration, coastSeconds };
}

export function startTunedSlotDrive(
	at: number,
	position: number,
	tuning: SlotTuning,
): TunedSlotDrive {
	return {
		...startSpinDrive(at, mode, position, motorTuning(tuning)),
		slotTuning: tuning,
		easeInAt: at,
	};
}

function sampleMotor(drive: TunedSlotDrive, at: number) {
	const { position, speed, slotTuning } = drive;
	const { maxSpeed, acceleration, easeInSeconds } = slotTuning;
	const seconds = Math.max(0, (at - drive.at) / 1000);
	if (speed > maxSpeed) {
		const slowing = Math.min(seconds, (speed - maxSpeed) / acceleration);
		return {
			position:
				position +
				speed * slowing -
				(acceleration * slowing ** 2) / 2 +
				maxSpeed * (seconds - slowing),
			speed: Math.max(maxSpeed, speed - acceleration * seconds),
		};
	}
	const rampAge = (drive.at - drive.easeInAt) / 1000;
	const rampLeft = easeInSeconds - rampAge;
	if (rampLeft <= 0 || speed < 0) return sampleSpinDrive(drive, at, mode);
	const gap = maxSpeed - speed;
	if (gap === 0) return { position: position + maxSpeed * seconds, speed };

	// Integrate a linear ramp in acceleration up to the speed cap.
	const jerk = acceleration / easeInSeconds;
	const currentAcceleration = jerk * rampAge;
	const rampGain = currentAcceleration * rampLeft + (jerk * rampLeft ** 2) / 2;
	const toCap =
		gap <= rampGain
			? (2 * gap) /
				(currentAcceleration +
					Math.sqrt(currentAcceleration ** 2 + 2 * jerk * gap))
			: rampLeft + (gap - rampGain) / acceleration;
	const accelerating = Math.min(seconds, toCap);
	const ramp = Math.min(accelerating, rampLeft);
	const steadyAcceleration = accelerating - ramp;
	const rampSpeed = speed + currentAcceleration * ramp + (jerk * ramp ** 2) / 2;
	return {
		position:
			position +
			speed * ramp +
			(currentAcceleration * ramp ** 2) / 2 +
			(jerk * ramp ** 3) / 6 +
			rampSpeed * steadyAcceleration +
			(acceleration * steadyAcceleration ** 2) / 2 +
			maxSpeed * (seconds - accelerating),
		speed: Math.min(maxSpeed, rampSpeed + acceleration * steadyAcceleration),
	};
}

export function sampleTunedSlotDrive(drive: SpinDrive, at: number) {
	if ("slotTuning" in drive && drive.held)
		return sampleMotor(drive as TunedSlotDrive, at);
	return sampleSpinDrive(drive, at, mode);
}

function planRelease(
	drive: TunedSlotDrive,
	winnerIndex: number,
	count: number,
	coastSeconds = drive.slotTuning.coastSeconds,
) {
	const tuning = motorTuning(drive.slotTuning);
	return changeSpinDrive(
		{
			...drive,
			held: true,
			tuning: {
				...tuning,
				coastSeconds,
				// A cap edit can leave the live reel temporarily above the cap.
				maxSpeed: Math.max(tuning.maxSpeed, drive.speed),
			},
		},
		false,
		drive.sequence + 1,
		drive.at,
		mode,
		winnerIndex,
		count,
	);
}

function applySlotBrake(
	drive: TunedSlotDrive,
	releasedAt: number,
): TunedSlotDrive {
	const { easeOutSeconds, brakeStrength } = drive.slotTuning;
	return { ...drive, releasedAt, slotBrake: { easeOutSeconds, brakeStrength } };
}

export function changeTunedSlotDrive(
	drive: TunedSlotDrive,
	held: boolean,
	at: number,
	winnerIndex: number,
	count: number,
): TunedSlotDrive {
	if (held === drive.held || at >= (drive.stopAt ?? Infinity)) return drive;
	at = Math.max(drive.at, at);
	if (held && !canRegripSpinDrive(drive, at, mode)) return drive;
	const anchored = { ...drive, ...sampleTunedSlotDrive(drive, at), at };
	if (held) {
		const grip = changeSpinDrive(
			anchored,
			true,
			drive.sequence + 1,
			at,
			mode,
			winnerIndex,
			count,
			drive.slotTuning.tapBoost,
		);
		return { ...grip, slotTuning: drive.slotTuning, easeInAt: at };
	}
	const plan = planRelease(anchored, winnerIndex, count);
	const { slotTuning, easeInAt } = drive;
	const coast = {
		...plan,
		tuning: motorTuning(slotTuning),
		slotTuning,
		easeInAt,
	};
	return applySlotBrake(coast, at);
}

export function retuneSlotDrive(
	drive: TunedSlotDrive,
	tuning: SlotTuning,
	at: number,
	winnerIndex: number,
	count: number,
): TunedSlotDrive {
	if (at >= (drive.stopAt ?? Infinity)) return drive;
	const previous = drive.slotTuning;
	const updated = { ...drive, tuning: motorTuning(tuning), slotTuning: tuning };
	at = Math.max(drive.at, at);
	const speedSettingsChanged =
		previous.maxSpeed !== tuning.maxSpeed ||
		previous.acceleration !== tuning.acceleration ||
		previous.easeInSeconds !== tuning.easeInSeconds;
	if (drive.held) {
		if (!speedSettingsChanged) return updated;
		const sample = sampleTunedSlotDrive(drive, at);
		const restartRamp =
			previous.easeInSeconds !== tuning.easeInSeconds ||
			(sample.speed >= previous.maxSpeed && tuning.maxSpeed > sample.speed);
		return {
			...updated,
			...sample,
			at,
			easeInAt: restartRamp ? at : drive.easeInAt,
		};
	}
	const coastChanged = previous.coastSeconds !== tuning.coastSeconds;
	if (
		!coastChanged &&
		previous.easeOutSeconds === tuning.easeOutSeconds &&
		previous.brakeStrength === tuning.brakeStrength
	)
		return updated;
	const { stopAt, target } = drive;
	if (stopAt === undefined || target === undefined) return updated;
	const sample = sampleTunedSlotDrive(drive, at);
	// Finish a near-detent correction on its existing path. Refitting a
	// reverse settle against a newly shortened deadline can cause a spike.
	if (target <= sample.position || sample.speed < 0) return updated;
	const releasedAt = drive.releasedAt ?? drive.at;
	if (!coastChanged)
		return applySlotBrake({ ...updated, ...sample, at }, releasedAt);

	const remaining = Math.max(250, releasedAt + tuning.coastSeconds * 1000 - at);
	let coast = { ...updated, ...sample, at, stopAt: at + Math.round(remaining) };
	const availableTravel =
		(sample.speed * remaining * maxSlotBrakeTravelRatio) / 1000;
	if (target - sample.position > Math.max(2, availableTravel)) {
		// A shorter deadline can use a nearer winner row. The shared planner
		// keeps the labels now in the reel window intact.
		const plan = planRelease(coast, winnerIndex, count, remaining / 1000);
		if (
			plan.target !== undefined &&
			plan.target > sample.position &&
			plan.target < target
		)
			coast = {
				...coast,
				...plan,
				tuning: updated.tuning,
				stopAt: coast.stopAt,
			};
	}
	const distance = (coast.target ?? target) - sample.position;
	// Keep a physical settle when a time cut leaves too little travel time.
	const minimum =
		sample.speed > 1
			? (distance * 1000) / (sample.speed * maxSlotBrakeTravelRatio)
			: (1.875 * distance * 1000) / maxCreepSpeed;
	coast.stopAt = Math.max(coast.stopAt, at + Math.ceil(minimum));
	return applySlotBrake(coast, releasedAt);
}
