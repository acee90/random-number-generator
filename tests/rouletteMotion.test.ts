import { expect, it } from "vitest";
import { rouletteSpinKeyframes } from "../src/components/features/picnic/motion";

it("accelerates into a faster charged spin and stops at the supplied angle", () => {
	const frames = (rotation: number, power: number) =>
		rouletteSpinKeyframes(rotation, power).map(({ transform }) =>
			Number.parseFloat(transform.slice("rotate(".length)),
		);
	const speeds = (angles: number[], duration: number) =>
		angles
			.slice(1)
			.map(
				(angle, i) => ((angle - angles[i]) * (angles.length - 1)) / duration,
			);
	const tap = frames(1790, 0);
	const held = frames(2870, 1);
	const tapSpeeds = speeds(tap, 4000);
	const heldSpeeds = speeds(held, 6000);
	expect(held[0]).toBe(0);
	expect(held.at(-1)).toBe(2870);
	expect(held[held.length - 1] % 360).toBe(tap[tap.length - 1] % 360);
	expect(heldSpeeds.every((speed) => speed >= 0)).toBe(true);
	expect(Math.max(...heldSpeeds)).toBeGreaterThan(Math.max(...tapSpeeds));
	expect(heldSpeeds[0]).toBeLessThan(heldSpeeds[3]);
	expect(heldSpeeds.at(-1)).toBeLessThan(heldSpeeds[40]);
});
