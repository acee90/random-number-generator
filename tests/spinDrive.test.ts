import { describe, expect, it } from "vitest";
import {
	canRegripSpinDrive,
	changeSpinDrive,
	getDefaultSpinTuning,
	getDefaultTapBoost,
	getSpinDeadline,
	getSpinSlotIndex,
	getSpinTuningLimits,
	isSpinDrive,
	isSpinTuning,
	sampleSpinDrive,
	startSpinDrive,
} from "@/lib/spinDrive";

describe("continuous spin", () => {
	it.each([
		"wheel",
		"slot-v1",
	] as const)("moves on the first frame and keeps cruising until released in %s", (mode) => {
		const drive = startSpinDrive(100, mode);
		const sample = (time: number) => sampleSpinDrive(drive, time, mode);
		const top = mode === "wheel" ? 5 : 42;
		expect(sample(116).position).toBeGreaterThan(0);
		expect(sample(1000).speed).toBeGreaterThan(sample(116).speed);
		expect(sample(2100).speed).toBe(top);
		expect(sample(1_000_000).speed).toBe(sample(10_000).speed);
		expect(sample(1_000_000).position).toBeGreaterThan(sample(10_000).position);
		expect(getSpinDeadline({ startedAt: 100, durationMs: 4000, drive })).toBe(
			Infinity,
		);
	});

	it.each([
		"wheel",
		"slot-v1",
	] as const)("brakes immediately then settles continuously onto the winner in %s", (mode) => {
		const [landing, period] = mode === "wheel" ? [0.76, 1] : [150, 798];
		const drive = startSpinDrive(0, mode);
		const coast = changeSpinDrive(drive, false, 1, 3000, mode, landing, period);
		const sample = (ms: number) => sampleSpinDrive(coast, coast.at + ms, mode);
		expect(sample(0)).toEqual(sampleSpinDrive(drive, coast.at, mode));
		expect(sample(200).speed).toBeLessThan(coast.speed * 0.9);
		expect(sample(500).speed).toBeLessThan(coast.speed * 0.78);
		const duration = mode === "wheel" ? 7000 : 4000;
		for (const ms of [
			50,
			200,
			500,
			duration / 2,
			duration - 500,
			duration - 1,
		]) {
			const positionDerivative =
				(sample(ms + 1).position - sample(ms - 1).position) * 500;
			expect(sample(ms).speed).toBeCloseTo(positionDerivative, 4);
			expect(sample(ms + 1).speed).toBeLessThan(sample(ms - 1).speed);
		}
		expect(coast.stopAt).toBe(coast.at + duration);
		const stopped = sample(duration);
		expect(stopped.speed).toBe(0);
		if (mode === "wheel")
			expect(stopped.position % period).toBeCloseTo(landing);
		else
			expect(getSpinSlotIndex(stopped.position, period, coast)).toBe(landing);
	});

	it.each([
		"wheel",
		"slot-v1",
	] as const)("applies a round's initial speed, acceleration, cap, and coast in %s", (mode) => {
		const limits = getSpinTuningLimits(mode);
		const tuning = {
			initialSpeed: limits.initialSpeed.max,
			maxSpeed: limits.maxSpeed.max,
			acceleration: limits.acceleration.max,
			coastSeconds: limits.coastSeconds.min,
		};
		const [landing, period] = mode === "wheel" ? [0.6, 1] : [500, 798];
		const drive = startSpinDrive(0, mode, 0, tuning);
		expect(drive.speed).toBe(tuning.initialSpeed);
		expect(sampleSpinDrive(drive, 500, mode).speed).toBe(
			tuning.initialSpeed + tuning.acceleration / 2,
		);
		expect(sampleSpinDrive(drive, 5000, mode).speed).toBe(tuning.maxSpeed);
		const coast = changeSpinDrive(drive, false, 1, 5000, mode, landing, period);
		expect(coast.stopAt).toBe(coast.at + tuning.coastSeconds * 1000);
		const restored: unknown = JSON.parse(JSON.stringify(coast));
		if (!isSpinDrive(restored, mode))
			throw Error("Expected a saved spin drive");
		const regrip = changeSpinDrive(
			restored,
			true,
			2,
			5400,
			mode,
			landing,
			period,
		);
		expect(regrip.tuning).toEqual(tuning);
		const coastSample = sampleSpinDrive(coast, 5400, mode);
		expect(sampleSpinDrive(regrip, 5400, mode)).toEqual({
			position: coastSample.position,
			speed: Math.min(
				tuning.maxSpeed,
				coastSample.speed + getDefaultTapBoost(mode),
			),
		});
		expect(
			isSpinTuning({ ...tuning, acceleration: Number.POSITIVE_INFINITY }, mode),
		).toBe(false);
		expect(isSpinTuning({ ...tuning, coastSeconds: 60 }, mode)).toBe(false);
		expect(isSpinTuning(tuning, mode === "wheel" ? "slot-v1" : "wheel")).toBe(
			false,
		);
		expect(
			startSpinDrive(0, mode, 0, { ...tuning, coastSeconds: 60 }).tuning,
		).toEqual(getDefaultSpinTuning(mode));
	});

	it("preserves the motion of saved drives without tuning", () => {
		const restored: unknown = JSON.parse(
			JSON.stringify({ held: true, at: 0, position: 0, speed: 8, sequence: 0 }),
		);
		if (!isSpinDrive(restored, "slot-v1"))
			throw Error("Expected a saved spin drive");
		expect(sampleSpinDrive(restored, 1000, "slot-v1")).toEqual({
			position: 13,
			speed: 18,
		});
		expect(sampleSpinDrive(restored, 2000, "slot-v1").speed).toBe(26);
		const coast = changeSpinDrive(restored, false, 1, 1000, "slot-v1", 7, 8);
		expect(coast.tuning).toBeUndefined();
		expect(sampleSpinDrive(coast, 2000, "slot-v1").speed).toBeCloseTo(
			18 * (1 - 1000 / ((coast.stopAt ?? 0) - coast.at)),
		);
	});

	it("preserves the trajectory and deadline of a previously tuned slot coast", () => {
		const saved: unknown = JSON.parse(
			JSON.stringify({
				held: false,
				at: 3000,
				sequence: 1,
				position: 93.97058823529412,
				speed: 42,
				tuning: {
					initialSpeed: 9,
					maxSpeed: 42,
					acceleration: 17,
					coastSeconds: 7,
				},
				slotSeams: [{ row: 139, offset: 763 }],
				target: 185,
				stopAt: 10000,
			}),
		);
		if (!isSpinDrive(saved, "slot-v1"))
			throw Error("Expected a saved slot coast");
		expect(
			getSpinDeadline({ startedAt: 0, durationMs: 4000, drive: saved }),
		).toBe(10000);
		const braking = sampleSpinDrive(saved, 3500, "slot-v1");
		expect(braking.position).toBeCloseTo(111.61238820271748, 10);
		expect(braking.speed).toBeCloseTo(30.16223256961091, 10);
		expect(sampleSpinDrive(saved, 10000, "slot-v1")).toEqual({
			position: 185,
			speed: 0,
		});
		expect(getSpinSlotIndex(185, 798, saved)).toBe(150);
		const grip = changeSpinDrive(saved, true, 2, 3500, "slot-v1", 150, 798);
		const nextCoast = changeSpinDrive(
			grip,
			false,
			3,
			4000,
			"slot-v1",
			150,
			798,
		);
		expect(nextCoast.stopAt).toBe(11000);
	});

	it("keeps position across multiple releases and regrips and speed through releases", () => {
		let drive = startSpinDrive(0, "wheel");
		for (const [time, held] of [
			[1300, false],
			[1400, true],
			[1450, false],
			[1550, true],
			[1600, false],
		] as const) {
			const previous = sampleSpinDrive(drive, time, "wheel");
			drive = changeSpinDrive(
				drive,
				held,
				drive.sequence + 1,
				time,
				"wheel",
				0.72,
				1,
			);
			expect(isSpinDrive(drive)).toBe(true);
			const next = sampleSpinDrive(drive, time, "wheel");
			expect(next.position).toBe(previous.position);
			if (held) expect(next.speed).toBeGreaterThan(previous.speed);
			else expect(next.speed).toBe(previous.speed);
			const nextSpeed = sampleSpinDrive(drive, time + 100, "wheel").speed;
			if (held) expect(nextSpeed).toBeGreaterThan(previous.speed);
			else expect(nextSpeed).toBeLessThan(previous.speed);
		}
		if (drive.stopAt === undefined) throw Error("Expected a coasting wheel");
		const stopped = sampleSpinDrive(drive, drive.stopAt, "wheel");
		expect(stopped.position % 1).toBeCloseTo(0.72);
		expect(stopped.speed).toBe(0);
		expect(
			changeSpinDrive(drive, true, 100, drive.stopAt, "wheel", 0.72, 1),
		).toBe(drive);
	});

	it.each([
		"wheel",
		"slot-v1",
	] as const)("boosts successive fast taps to the cap in %s without changing the winner", (mode) => {
		const [landing, period] = mode === "wheel" ? [0.72, 1] : [84, 107];
		let drive = startSpinDrive(0, mode);
		const tuning = getDefaultSpinTuning(mode);
		for (let tap = 1; tap <= 10; tap++) {
			const releasedAt = tap * 60;
			const released = changeSpinDrive(
				drive,
				false,
				tap * 2 - 1,
				releasedAt,
				mode,
				landing,
				period,
			);
			const at = releasedAt + 25;
			const sample = sampleSpinDrive(released, at, mode);
			drive = changeSpinDrive(
				released,
				true,
				tap * 2,
				at,
				mode,
				landing,
				period,
			);
			expect(drive.position).toBe(sample.position);
			expect(drive.speed).toBe(
				Math.min(tuning.maxSpeed, sample.speed + getDefaultTapBoost(mode)),
			);
			expect(
				changeSpinDrive(drive, false, tap * 2 - 1, at, mode, landing, period),
			).toBe(drive);
			expect(
				changeSpinDrive(drive, true, tap * 2 + 1, at, mode, landing, period),
			).toEqual({ ...drive, sequence: tap * 2 + 1 });
		}
		expect(drive.speed).toBe(tuning.maxSpeed);
		const coast = changeSpinDrive(drive, false, 21, 660, mode, landing, period);
		if (coast.stopAt === undefined) throw Error("Expected a stop time");
		expect(sampleSpinDrive(coast, 685, mode).speed).toBeLessThan(
			tuning.maxSpeed,
		);
		const stopped = sampleSpinDrive(coast, coast.stopAt, mode);
		expect(stopped.speed).toBe(0);
		if (mode === "wheel") expect(stopped.position % 1).toBeCloseTo(landing);
		else
			expect(getSpinSlotIndex(stopped.position, period, coast)).toBe(landing);
	});

	it("leaves time to regrip after a tap and gives a full-speed wheel a longer coast", () => {
		for (let winner = 0; winner < 100; winner++) {
			const drive = startSpinDrive(0, "wheel");
			const tap = changeSpinDrive(
				drive,
				false,
				1,
				50,
				"wheel",
				winner / 100,
				1,
			);
			const full = changeSpinDrive(
				drive,
				false,
				1,
				20_000,
				"wheel",
				winner / 100,
				1,
			);
			if (tap.stopAt === undefined || full.stopAt === undefined)
				throw Error("Expected a coasting wheel");
			expect(tap.stopAt - tap.at).toBeGreaterThan(4000);
			expect(full.stopAt - full.at).toBeGreaterThan(6500);
		}
	});

	it("lands on every locked slot winner without a long-list wait or replacing visible labels on regrip", () => {
		for (const count of [1, 6, 107, 797]) {
			for (let winner = 0; winner < count; winner++) {
				let drive = startSpinDrive(0, "slot-v1", Math.min(count - 1, 83));
				for (const [at, held] of [
					[35, false],
					[80, true],
					[120, false],
					[180, true],
					[240, false],
				] as const) {
					const prior = drive;
					drive = changeSpinDrive(
						drive,
						held,
						drive.sequence + 1,
						at,
						"slot-v1",
						winner,
						count,
					);
					expect(drive.held).toBe(held);
					const { position } = sampleSpinDrive(prior, at, "slot-v1");
					for (
						let row = Math.floor(position) - 2;
						row <= Math.ceil(position) + 2;
						row++
					) {
						if (
							getSpinSlotIndex(row, count, prior) !==
							getSpinSlotIndex(row, count, drive)
						)
							throw Error("Visible reel row changed");
					}
					if (!held) {
						if (drive.stopAt === undefined || drive.target === undefined)
							throw Error("Expected a coasting reel");
						expect(drive.stopAt - at).toBeLessThanOrEqual(5500);
						expect(getSpinSlotIndex(drive.target, count, drive)).toBe(winner);
					}
				}
			}
		}
	});

	it("uses a hidden slot seam even when a quick release starts on the locked winner", () => {
		const winner = 83;
		const drive = startSpinDrive(0, "slot-v1", winner);
		const coast = changeSpinDrive(drive, false, 1, 0, "slot-v1", winner, 798);
		if (coast.target === undefined || coast.stopAt === undefined)
			throw Error("Expected a coasting reel");
		expect(coast.target).toBeGreaterThan(winner + 4);
		expect(coast.stopAt).toBe(4000);
		for (let row = winner - 3; row <= winner + 3; row++) {
			expect(getSpinSlotIndex(row, 798, coast)).toBe(row);
		}
		expect(getSpinSlotIndex(coast.target, 798, coast)).toBe(winner);
	});

	it.each([
		"wheel",
		"slot-v1",
	] as const)("rejects a regrip after speed falls below the gate in %s", (mode) => {
		const [landing, period] = mode === "wheel" ? [0.82, 1] : [84, 107];
		const coast = changeSpinDrive(
			startSpinDrive(0, mode),
			false,
			1,
			2000,
			mode,
			landing,
			period,
		);
		if (coast.stopAt === undefined) throw Error("Expected a stop time");
		let cutoff = coast.at;
		while (cutoff < coast.stopAt && canRegripSpinDrive(coast, cutoff, mode))
			cutoff++;
		expect(cutoff).toBeLessThan(coast.stopAt);
		expect(canRegripSpinDrive(coast, cutoff - 1, mode)).toBe(true);
		expect(canRegripSpinDrive(coast, cutoff, mode)).toBe(false);
		expect(
			changeSpinDrive(coast, true, 2, cutoff, mode, landing, period, 0),
		).toBe(coast);
		expect(isSpinDrive(coast)).toBe(true);
	});
});
