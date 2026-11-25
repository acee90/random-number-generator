import { describe, expect, it } from "vitest";
import {
	slotMotion,
	slotStrip,
	slotStripOffset,
} from "../src/components/features/slot/motion";

describe("slot drum", () => {
	it("browses real neighbours and lands the frozen winner on the centre line for small and large pools", () => {
		expect(slotStrip(0, 0)).toEqual([null, null, null]);
		expect(slotStrip(1, 8, 0)).toEqual([null, 0, null]);
		for (const count of [2, 6, 117, 118, 200, 2000]) {
			const winner = count - 1;
			const strip = slotStrip(count, count, winner);
			expect(strip.slice(0, 3)).toEqual([winner, 0, 1]);
			expect(strip).toHaveLength(29);
			expect(strip.slice(-3)).toEqual([winner - 1, winner, 0]);
			expect(slotStrip(count, 1, winner).slice(3)).toEqual(strip.slice(3));
		}
	});
	it("crosses several seamless laps on the same strip and exits onto the winning row", () => {
		const strip = slotStrip(200, 31, 172);
		const landingRow = strip.length - 3;
		const { travel } = slotMotion(4000, 4000, landingRow);
		let laps = 0;
		for (let step = 1; step <= travel; step++) {
			const next = slotStripOffset(step - 1) + 1;
			const actual = slotStripOffset(step);
			if (next === actual) continue;
			expect(strip.slice(actual, actual + 3)).toEqual(
				strip.slice(next, next + 3),
			);
			laps++;
		}
		expect(laps).toBeGreaterThanOrEqual(3);
		expect(slotStripOffset(travel)).toBe(landingRow);
		expect(strip[landingRow + 1]).toBe(172);
	});
	it("holds a fast middle, slows to readable final rows and settles at the reveal time", () => {
		const landingRow = slotStrip(6, 0, 4).length - 3;
		const at = (ms: number) => slotMotion(ms, 4000, landingRow);
		expect(at(-1500)).toEqual({ travel: 0, speed: 0 });
		expect(at(250).speed).toBeLessThan(at(1200).speed);
		expect(at(2000).travel - at(1000).travel).toBeGreaterThan(35);
		expect(at(1200).speed).toBeGreaterThan(at(3200).speed);
		expect(slotStripOffset(at(3200).travel)).toBeGreaterThan(landingRow - 2);
		expect(slotStripOffset(at(3760).travel)).toBeCloseTo(landingRow + 0.1);
		expect(slotStripOffset(at(4000).travel)).toBe(landingRow);
		expect(at(4000).speed).toBe(0);
		expect(at(8000)).toEqual(at(4000));
		expect(slotMotion(1600, 4000, 0)).toEqual({ travel: 0, speed: 0 });
	});
	it("spins faster for a charged release and lands on the same frozen row", () => {
		const strip = slotStrip(200, 31, 172);
		const landingRow = strip.length - 3;
		const rowsPerSecond = (duration: number, power: number) =>
			slotMotion(1500, duration, landingRow, power).travel -
			slotMotion(1000, duration, landingRow, power).travel;
		expect(rowsPerSecond(6000, 1)).toBeGreaterThan(rowsPerSecond(4000, 0));
		for (const power of [0, 0.2, 0.55, 1]) {
			const duration = 4000 + power * 2000;
			const stopped = slotMotion(duration, duration, landingRow, power);
			expect(stopped.speed).toBe(0);
			expect(slotStripOffset(stopped.travel, power)).toBe(landingRow);
			expect(strip[landingRow + 1]).toBe(172);
		}
	});
});
