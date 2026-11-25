import type { DrawView } from "@/lib/drawView";
import {
	maxSlotBrakeTravelRatio,
	type SpinDrive,
	sampleSpinDrive,
} from "@/lib/spinDrive";

type SpinSample = { position: number; speed: number };

type CoastCurve = {
	tailIntegral: number;
	brakeIntegral: number;
	brakeShare: number;
};

type CoastAdjustment = {
	kind: "coast";
	at: number;
	until: number;
	target: number;
	curve?: CoastCurve;
} & SpinSample;

export type SpinAdjustment =
	| ({ kind: "motor"; at: number } & SpinSample)
	| CoastAdjustment
	| {
			kind: "offset";
			at: number;
			until: number;
			offset: number;
			speedOffset: number;
	  };

function fitCoast(
	coast: CoastAdjustment,
	period: number,
	cycles: number,
	maxSpeed: number,
	hasSlotBrake: boolean,
): CoastAdjustment | undefined {
	const { position, speed, at, until } = coast;
	let { target } = coast;
	const seconds = (until - at) / 1000;
	const capacity = speed * seconds;
	if (period > 0) {
		const firstForward = Math.floor((position - target) / period) + 1;
		const lastForward = Math.ceil((position + capacity - target) / period) - 1;
		const nearest = Math.round((position - target) / period);
		target +=
			period *
			(firstForward <= lastForward
				? Math.min(lastForward, Math.max(firstForward, cycles))
				: nearest);
	}
	const distance = target - position;
	const ratio = distance / capacity;
	if (
		hasSlotBrake &&
		distance > 0 &&
		ratio > 0 &&
		ratio <= maxSlotBrakeTravelRatio
	)
		return { ...coast, target };
	if (!hasSlotBrake && distance > 0 && ratio > 0 && ratio < 1) {
		// Combine two decaying speeds whose average travel brackets the required
		// distance. This gives an immediate brake and honors the server deadline.
		const exponent = 1 / ratio - 1;
		const tailIntegral = 1 + exponent * 0.55;
		const brakeIntegral = 1 + Math.max(14, exponent * 2);
		const brakeShare =
			(1 / tailIntegral - ratio) / (1 / tailIntegral - 1 / brakeIntegral);
		return {
			...coast,
			target,
			curve: { tailIntegral, brakeIntegral, brakeShare },
		};
	}
	// A nearly stopped reel can need a small correction in either direction.
	// Keep that settle within the round's speed limit even on a late snapshot.
	const settlingLimit =
		Math.abs(speed) + (1.875 * Math.abs(distance)) / seconds;
	if (settlingLimit <= maxSpeed) return { ...coast, target };
}

export function getSpinAdjustment(
	drive: SpinDrive,
	at: number,
	mode: DrawView,
	before: SpinSample,
	period: number,
): SpinAdjustment | undefined {
	const after = sampleSpinDrive(drive, at, mode);
	const difference = before.position - after.position;
	const cycles = period > 0 ? Math.round(difference / period) : 0;
	const offset = difference - cycles * period;
	const speedOffset = before.speed - after.speed;
	if (Math.abs(offset) < 0.0001 && Math.abs(speedOffset) < 0.001) return;

	if (drive.tuning) {
		if (drive.held) return { kind: "motor", at, ...before };
		if (
			drive.stopAt !== undefined &&
			drive.stopAt > at &&
			drive.target !== undefined
		)
			return fitCoast(
				{
					kind: "coast",
					at,
					until: drive.stopAt,
					target: drive.target,
					...before,
				},
				period,
				cycles,
				drive.tuning.maxSpeed,
				mode === "slot-v1" && drive.slotBrake !== undefined,
			);
		return;
	}
	const until = Math.min(at + 550, drive.stopAt ?? Infinity);
	if (until > at) return { kind: "offset", at, until, offset, speedOffset };
}

export function sampleDisplaySpin(
	drive: SpinDrive,
	at: number,
	mode: DrawView,
	adjustment?: SpinAdjustment,
) {
	if (adjustment?.kind === "motor" && drive.held) {
		const { at: origin, position, speed } = adjustment;
		return sampleSpinDrive({ ...drive, at: origin, position, speed }, at, mode);
	}
	if (
		adjustment?.kind === "coast" &&
		!drive.held &&
		drive.stopAt === adjustment.until
	) {
		const { at: origin, until, position, speed, target, curve } = adjustment;
		if (at <= origin) return { position, speed };
		if (at >= until) return { position: target, speed: 0 };
		if (!curve)
			return sampleSpinDrive(
				{ ...drive, at: origin, position, speed, target },
				at,
				mode,
			);
		const { tailIntegral, brakeIntegral, brakeShare } = curve;
		const left = (until - at) / (until - origin);
		const tail = (1 - brakeShare) * left ** (tailIntegral - 1);
		const brake = brakeShare * left ** (brakeIntegral - 1);
		return {
			position:
				target -
				speed *
					((until - at) / 1000) *
					(tail / tailIntegral + brake / brakeIntegral),
			speed: speed * (tail + brake),
		};
	}
	const sample = sampleSpinDrive(drive, at, mode);
	if (adjustment?.kind !== "offset") return sample;
	const until = drive.held
		? adjustment.until
		: Math.min(adjustment.until, drive.stopAt ?? Infinity);
	if (at >= until || until <= adjustment.at) return sample;
	if (at < adjustment.at)
		return {
			position: sample.position + adjustment.offset,
			speed: sample.speed,
		};
	const duration = (until - adjustment.at) / 1000;
	const t = (at - adjustment.at) / (until - adjustment.at);
	const left = 1 - t;
	return {
		position:
			sample.position +
			left ** 2 *
				(adjustment.offset * (1 + 2 * t) +
					adjustment.speedOffset * duration * t),
		speed:
			sample.speed +
			left *
				((-6 * adjustment.offset * t) / duration +
					adjustment.speedOffset * (1 - 3 * t)),
	};
}
