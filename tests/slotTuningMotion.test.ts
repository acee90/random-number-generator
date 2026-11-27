import { describe, expect, it } from "vitest";
import {
	changeSpinDrive,
	getSpinSlotIndex,
	sampleSpinDrive,
	startSpinDrive,
} from "@/lib/spinDrive";
import {
	changeTunedSlotDrive,
	getDefaultSlotTuning,
	retuneSlotDrive,
	sampleTunedSlotDrive,
	startTunedSlotDrive,
} from "../stories/core/draw-views/slotTuningMotion";

const mode = "slot-v1";
const winner = 17;
const count = 170;

function release(drive: ReturnType<typeof startTunedSlotDrive>, at: number) {
	return changeTunedSlotDrive(drive, false, at, winner, count);
}

function expectWinner(drive: ReturnType<typeof startTunedSlotDrive>) {
	if (drive.stopAt === undefined || drive.target === undefined)
		throw Error("Expected a planned stop");
	const final = sampleTunedSlotDrive(drive, drive.stopAt);
	expect(final).toEqual({ position: drive.target, speed: 0 });
	expect(getSpinSlotIndex(final.position, count, drive)).toBe(winner);
}

describe("slot tuning motion", () => {
	it("uses the production motion at baseline through holds, releases, and regrips", () => {
		let baseline = startSpinDrive(0, mode, 2);
		let tuned = startTunedSlotDrive(0, 2, getDefaultSlotTuning());
		for (const [at, held] of [
			[500, false],
			[1850, true],
			[12500, false],
			[15900, true],
			[16300, false],
		] as const) {
			baseline = changeSpinDrive(
				baseline,
				held,
				baseline.sequence + 1,
				at,
				mode,
				winner,
				count,
			);
			tuned = changeTunedSlotDrive(tuned, held, at, winner, count);
			expect(tuned.stopAt).toBe(baseline.stopAt);
			expect(tuned.target).toBe(baseline.target);
			for (const time of [at, at + 100, at + 500, at + 1700])
				expect(sampleTunedSlotDrive(tuned, time)).toEqual(
					sampleSpinDrive(baseline, time, mode),
				);
		}
		expectWinner(tuned);
	});

	it("reproduces the approved tap, regrip, and full-speed release trajectories", () => {
		// Samples recorded from the tuning story at a 4 s coast and 0.6 s ease-out.
		const tap = changeSpinDrive(
			startSpinDrive(0, mode, 2),
			false,
			1,
			50,
			mode,
			winner,
			count,
		);
		const regrip = changeSpinDrive(tap, true, 2, 190, mode, winner, count);
		const releaseAgain = changeSpinDrive(
			regrip,
			false,
			3,
			260,
			mode,
			winner,
			count,
		);
		const full = changeSpinDrive(
			startSpinDrive(0, mode),
			false,
			1,
			2300,
			mode,
			150,
			798,
		);
		for (const [drive, at, position, speed] of [
			[tap, 100, 2.9530926662347294, 9.428317518358977],
			[tap, 1050, 9.32161545884503, 4.779788699928435],
			[regrip, 190, 3.7698439265639667, 17.73516219417506],
			[releaseAgain, 2260, 25.015642242300864, 4.83526515940929],
			[full, 2800, 81.72741093754098, 28.060985001519718],
			[full, 6299, 116.99999993314663, 0.00016411771933973857],
		] as const) {
			const sample = sampleSpinDrive(drive, at, mode);
			expect(sample.position).toBeCloseTo(position, 10);
			expect(sample.speed).toBeCloseTo(speed, 10);
		}
		for (const [drive, stopAt, target, index, period] of [
			[tap, 4050, 15, winner, count],
			[releaseAgain, 4260, 29, winner, count],
			[full, 6300, 117, 150, 798],
		] as const) {
			expect(drive.stopAt).toBe(stopAt);
			expect(sampleSpinDrive(drive, stopAt, mode)).toEqual({
				position: target,
				speed: 0,
			});
			expect(getSpinSlotIndex(target, period, drive)).toBe(index);
		}
	});

	it("applies a live boost adjustment only on the next press", () => {
		const tuning = getDefaultSlotTuning();
		const coast = release(startTunedSlotDrive(0, 0, tuning), 60);
		const at = 100;
		const noBoost = retuneSlotDrive(
			coast,
			{ ...tuning, tapBoost: 0 },
			at,
			winner,
			count,
		);
		const moreBoost = retuneSlotDrive(
			coast,
			{ ...tuning, tapBoost: 18 },
			at,
			winner,
			count,
		);
		const before = sampleTunedSlotDrive(coast, at);
		for (const drive of [noBoost, moreBoost]) {
			expect(sampleTunedSlotDrive(drive, at)).toEqual(before);
			const grip = changeTunedSlotDrive(drive, true, at, winner, count);
			expect(sampleTunedSlotDrive(grip, at)).toEqual({
				position: before.position,
				speed: before.speed + drive.slotTuning.tapBoost,
			});
			expectWinner(release(grip, at + 50));
		}
	});

	it("adjusts the time to reach full acceleration and integrates its changing speed", () => {
		const baseline = getDefaultSlotTuning();
		const drive = startTunedSlotDrive(0, 0, {
			...baseline,
			initialSpeed: 12,
			acceleration: 20,
			easeInSeconds: 1,
		});
		expect(sampleTunedSlotDrive(drive, 0).speed).toBe(12);
		expect(sampleTunedSlotDrive(drive, 500).speed).toBeCloseTo(14.5);
		expect(sampleTunedSlotDrive(drive, 1000).speed).toBeCloseTo(22);
		expect(sampleTunedSlotDrive(drive, 1100).speed).toBeCloseTo(24);
		for (const at of [500, 999, 1000, 1001, 2000, 2001]) {
			const velocity =
				(sampleTunedSlotDrive(drive, at + 0.1).position -
					sampleTunedSlotDrive(drive, at - 0.1).position) *
				5000;
			expect(sampleTunedSlotDrive(drive, at).speed).toBeCloseTo(velocity, 2);
		}
	});

	it("decelerates to a lower live cap and continues sampling indefinitely", () => {
		const tuning = getDefaultSlotTuning();
		const drive = startTunedSlotDrive(0, 2, tuning);
		const at = 10_000;
		const before = sampleTunedSlotDrive(drive, at);
		const lower = retuneSlotDrive(
			drive,
			{ ...tuning, maxSpeed: 24, acceleration: 6 },
			at,
			winner,
			count,
		);
		expect(sampleTunedSlotDrive(lower, at)).toEqual(before);
		expect(sampleTunedSlotDrive(lower, at + 100).speed).toBeCloseTo(41.4);
		expect(sampleTunedSlotDrive(lower, at + 3000).speed).toBe(24);
		expect(sampleTunedSlotDrive(lower, at + 70_000)).toEqual({
			position: before.position + 24 * 70 + 27,
			speed: 24,
		});
		const coast = release(lower, at + 100);
		expect(sampleTunedSlotDrive(coast, at + 100)).toEqual(
			sampleTunedSlotDrive(lower, at + 100),
		);
		expectWinner(coast);
	});

	it("changes early braking strength and timing independently of the landing time", () => {
		const tuning = getDefaultSlotTuning();
		const baseline = release(startTunedSlotDrive(0, 0, tuning), 3000);
		const faster = release(
			startTunedSlotDrive(0, 0, { ...tuning, easeOutSeconds: 0.2 }),
			3000,
		);
		const stronger = release(
			startTunedSlotDrive(0, 0, { ...tuning, brakeStrength: 0.55 }),
			3000,
		);
		const baselineSpeed = sampleTunedSlotDrive(baseline, 3200).speed;
		for (const tuned of [faster, stronger]) {
			expect(sampleTunedSlotDrive(tuned, 3200).speed).toBeLessThan(
				baselineSpeed,
			);
			expect(tuned.stopAt).toBe(baseline.stopAt);
			expect(tuned.target).toBe(baseline.target);
			expectWinner(tuned);
		}
		const restored = retuneSlotDrive(faster, tuning, 3000, winner, count);
		for (const at of [3050, 3500, 5200, 8000]) {
			const actual = sampleTunedSlotDrive(restored, at);
			const production = sampleTunedSlotDrive(baseline, at);
			expect(actual.position).toBeCloseTo(production.position, 8);
			expect(actual.speed).toBeCloseTo(production.speed, 8);
		}
	});

	it("changes a running coast without replacing visible rows or the locked winner", () => {
		const tuning = getDefaultSlotTuning();
		const coast = release(startTunedSlotDrive(0, 0, tuning), 3000);
		const at = 4500;
		const before = sampleTunedSlotDrive(coast, at);
		const curve = retuneSlotDrive(
			coast,
			{ ...tuning, easeOutSeconds: 0.25, brakeStrength: 0.45 },
			at,
			winner,
			count,
		);
		expect(curve.stopAt).toBe(coast.stopAt);
		expect(curve.target).toBe(coast.target);
		expect(sampleTunedSlotDrive(curve, at)).toEqual(before);
		const shorter = retuneSlotDrive(
			curve,
			{ ...curve.slotTuning, coastSeconds: 3 },
			at,
			winner,
			count,
		);
		expect(sampleTunedSlotDrive(shorter, at)).toEqual(before);
		expect(shorter.stopAt).toBeLessThan(coast.stopAt ?? 0);
		for (
			let row = Math.floor(before.position) - 2;
			row <= Math.ceil(before.position) + 2;
			row++
		) {
			expect(getSpinSlotIndex(row, count, shorter)).toBe(
				getSpinSlotIndex(row, count, coast),
			);
		}
		for (let time = at + 1; time < (shorter.stopAt ?? at); time += 25) {
			const sample = sampleTunedSlotDrive(shorter, time);
			const prior = sampleTunedSlotDrive(shorter, time - 1);
			expect(sample.position).toBeGreaterThanOrEqual(prior.position);
			expect(sample.speed).toBeGreaterThanOrEqual(0);
			expect(sample.speed).toBeLessThanOrEqual(prior.speed);
		}
		expectWinner(shorter);
		const grip = changeTunedSlotDrive(shorter, true, at + 200, winner, count);
		expect(grip.held).toBe(true);
		const beforeGrip = sampleTunedSlotDrive(shorter, at + 200);
		expect(sampleTunedSlotDrive(grip, at + 200)).toEqual({
			position: beforeGrip.position,
			speed: Math.min(tuning.maxSpeed, beforeGrip.speed + tuning.tapBoost),
		});
		expectWinner(release(grip, at + 1400));
	});

	it("allows a late regrip until the tuned reel reaches its stop time", () => {
		const tuning = { ...getDefaultSlotTuning(), tapBoost: 0 };
		const coast = release(startTunedSlotDrive(0, 0, tuning), 3000);
		const gripAt = (coast.stopAt ?? 0) - 1;
		const grip = changeTunedSlotDrive(coast, true, gripAt, winner, count);
		expect(grip).not.toBe(coast);
		expect(grip.held).toBe(true);
		expect(
			changeTunedSlotDrive(coast, true, coast.stopAt ?? 0, winner, count),
		).toBe(coast);
	});
});
