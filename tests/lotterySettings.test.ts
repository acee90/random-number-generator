import { describe, expect, it } from "vitest";
import {
	type LotterySettings,
	parseLotterySettings,
} from "../src/lib/lotterySettings";

const saved: LotterySettings = {
	lottoGameCount: 3,
	pensionGameCount: 2,
	group: "4",
	lottoMode: "fixed",
	fixedNumbers: [21, 7],
	excludedNumbers: [45, 3],
	spreadRemainder: false,
};

describe("saved lottery settings", () => {
	it("restores sorted independent arrays without changing the stored value", () => {
		const restored = parseLotterySettings(saved);
		expect(restored).toEqual({
			...saved,
			fixedNumbers: [7, 21],
			excludedNumbers: [3, 45],
		});
		expect(restored.fixedNumbers).not.toBe(saved.fixedNumbers);
		expect(restored.excludedNumbers).not.toBe(saved.excludedNumbers);
		expect(saved.fixedNumbers).toEqual([21, 7]);
	});

	it("normalizes all-group pension settings to five games", () => {
		expect(parseLotterySettings({ ...saved, group: "all" })).toMatchObject({
			lottoGameCount: 3,
			pensionGameCount: 5,
			group: "all",
		});
	});

	it("keeps temporarily insufficient spread choices for the user to adjust", () => {
		const insufficient = {
			...saved,
			lottoMode: "spread",
			fixedNumbers: [],
			excludedNumbers: Array.from({ length: 39 }, (_, index) => index + 1),
		};
		expect(parseLotterySettings(insufficient)).toEqual(insufficient);
	});

	it.each([
		null,
		[],
		{},
		{ ...saved, lottoGameCount: 0 },
		{ ...saved, pensionGameCount: 6 },
		{ ...saved, lottoGameCount: 1.5 },
		{ ...saved, group: "6" },
		{ ...saved, lottoMode: "unknown" },
		{ ...saved, fixedNumbers: [1, 2, 3, 4, 5, 6] },
		{
			...saved,
			excludedNumbers: Array.from({ length: 40 }, (_, index) => index + 1),
		},
		{ ...saved, fixedNumbers: [1.5] },
		{ ...saved, excludedNumbers: [46] },
		{ ...saved, excludedNumbers: ["3"] },
		{ ...saved, fixedNumbers: [7, 7] },
		{ ...saved, excludedNumbers: [3, 3] },
		{ ...saved, fixedNumbers: new Array(1) },
		{ ...saved, excludedNumbers: [7] },
		{ ...saved, spreadRemainder: "false" },
	])("rejects invalid stored settings: %j", (value) => {
		expect(() => parseLotterySettings(value)).toThrow(
			"Invalid saved lottery settings",
		);
	});
});
