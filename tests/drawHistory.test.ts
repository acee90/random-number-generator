import { describe, expect, it } from "vitest";
import { type Draw, isDraw, isLottoOptions } from "../src/lib/drawHistory";

const number: Draw = {
	id: "saved-number",
	kind: "number",
	timestamp: 1,
	source: "csprng",
	rows: [{ numbers: [-9_007_199_254_740_991, 0, 9_007_199_254_740_991] }],
};
const lotto: Draw = {
	id: "saved-lotto",
	kind: "lotto",
	timestamp: Date.UTC(2026, 0, 1),
	source: "quantum",
	rows: [{ numbers: [1, 7, 11, 21, 30, 45] }],
};
const pension: Draw = {
	id: "saved-pension",
	kind: "pension",
	timestamp: Date.UTC(2026, 0, 1),
	source: "atmospheric",
	rows: [{ group: 1, numbers: [0, 0, 0, 1, 2, 3] }],
};

describe("saved draw validation", () => {
	it("keeps migrated integer history at the original 100-number limit", () => {
		const numbers = Array(100).fill(42);
		expect(
			isDraw({ ...number, rows: [{ numbers }], numbers, min: 1, max: 100 }),
		).toBe(true);
		expect(isDraw(number)).toBe(true);
	});

	it("keeps old Lotto results without strategy metadata", () => {
		expect(
			isDraw({
				...lotto,
				rows: Array.from({ length: 5 }, () => ({
					numbers: [45, 1, 7, 21, 30, 2],
				})),
			}),
		).toBe(true);
	});

	it("keeps pension leading zeroes and repeated digits across all five groups", () => {
		expect(
			isDraw({
				...pension,
				rows: Array.from({ length: 5 }, (_, index) => ({
					group: index + 1,
					numbers: [0, 0, 0, 0, 0, 0],
				})),
			}),
		).toBe(true);
	});

	it.each([
		"quantum",
		"atmospheric",
		"csprng",
		"mixed",
	])("keeps the recorded %s source", (source) => {
		expect(isDraw({ ...number, source })).toBe(true);
	});

	it.each([
		-8_640_000_000_000_000, 0, 8_640_000_000_000_000,
	])("accepts valid integer Date timestamps: %i", (timestamp) => {
		expect(isDraw({ ...number, timestamp })).toBe(true);
	});

	it.each([
		{ ...number, id: "" },
		{ ...number, id: " \t " },
		{ ...number, timestamp: 1.5 },
		{ ...number, timestamp: 1e20 },
		{ ...number, timestamp: 8_640_000_000_000_001 },
		{ ...number, timestamp: -8_640_000_000_000_001 },
		{ ...number, timestamp: Number.MAX_SAFE_INTEGER },
		{ ...number, timestamp: "1" },
		{ ...number, timestamp: NaN },
		{ ...number, source: "unknown" },
		{ ...number, rows: [] },
		{ ...number, rows: [{ numbers: [] }] },
		{ ...number, rows: [{ numbers: Array(101).fill(1) }] },
		{ ...number, rows: [{ numbers: [42] }, { numbers: [99] }] },
		{ ...number, rows: [{ numbers: [1.5] }] },
		{ ...number, rows: [{ numbers: [Number.MAX_SAFE_INTEGER + 1] }] },
		{ ...number, rows: [{ numbers: Array(1) }] },
		{ ...number, rows: Array(1) },
		{ ...lotto, rows: [{ numbers: [1, 1, 1, 1, 1, 46] }] },
		{ ...lotto, rows: [{ numbers: [1, 1, 2, 3, 4, 5] }] },
		{ ...lotto, rows: [{ numbers: [0, 1, 2, 3, 4, 5] }] },
		{ ...lotto, rows: [{ numbers: [-1, 1, 2, 3, 4, 5] }] },
		{ ...lotto, rows: [{ numbers: [1, 2, 3, 4, 5] }] },
		{ ...lotto, rows: [{ numbers: [1, 2, 3, 4, 5, 6, 7] }] },
		{ ...lotto, rows: [{ numbers: Array(6) }] },
		{ ...lotto, rows: Array(6).fill(lotto.rows[0]) },
		{ ...pension, rows: [{ numbers: [0, 0, 0, 1, 2, 3] }] },
		{ ...pension, rows: [{ group: 0, numbers: [0, 0, 0, 1, 2, 3] }] },
		{ ...pension, rows: [{ group: 6, numbers: [0, 0, 0, 1, 2, 3] }] },
		{ ...pension, rows: [{ group: 2.5, numbers: [0, 0, 0, 1, 2, 3] }] },
		{ ...pension, rows: [{ group: "2", numbers: [0, 0, 0, 1, 2, 3] }] },
		{ ...pension, rows: [{ group: 2, numbers: [0, 0, 0, 1, 2, 45] }] },
		{ ...pension, rows: [{ group: 2, numbers: [0, 0, 0, 1, 2, -1] }] },
		{ ...pension, rows: [{ group: 2, numbers: [0, 0, 0, 1, 2] }] },
		{ ...pension, rows: [{ group: 2, numbers: Array(6) }] },
		{ ...pension, rows: Array(6).fill(pension.rows[0]) },
		null,
		[],
	])("rejects a malformed saved draw: %j", (value) => {
		expect(isDraw(value)).toBe(false);
	});
});

describe("saved Lotto condition validation", () => {
	const options = {
		mode: "fixed" as const,
		fixedNumbers: [7, 21],
		excludedNumbers: [4],
		spreadRemainder: true,
	};
	const fixed: Draw = {
		...lotto,
		rows: [lotto.rows[0], { numbers: [2, 7, 12, 21, 31, 44] }],
		lottoOptions: options,
	};
	it("accepts old optional exclusions and matching fixed/spread snapshots", () => {
		expect(
			isLottoOptions({
				mode: "random",
				fixedNumbers: [],
				spreadRemainder: true,
			}),
		).toBe(true);
		expect(isDraw(fixed)).toBe(true);
	});
	it.each([
		{ ...fixed, rows: [lotto.rows[0], { numbers: [2, 8, 12, 21, 31, 44] }] },
		{ ...fixed, lottoOptions: { ...options, excludedNumbers: [45] } },
		{ ...fixed, rows: [lotto.rows[0], { numbers: [1, 7, 12, 21, 31, 44] }] },
		{ ...fixed, lottoOptions: { ...options, fixedNumbers: [] } },
		{ ...fixed, lottoOptions: { ...options, fixedNumbers: Array(1) } },
		{ ...fixed, lottoOptions: { ...options, excludedNumbers: Array(1) } },
		{ ...fixed, lottoOptions: { ...options, excludedNumbers: [7] } },
	])("rejects a record whose stored conditions cannot describe its rows: %j", (value) => {
		expect(isDraw(value)).toBe(false);
	});
	it("allows shared random completions when the saved spread setting is off", () => {
		expect(
			isDraw({
				...fixed,
				rows: [lotto.rows[0], { numbers: [1, 7, 12, 21, 31, 44] }],
				lottoOptions: { ...options, spreadRemainder: false },
			}),
		).toBe(true);
	});
	it("requires disjoint rows only for the saved spread mode", () => {
		const rows = [
			{ numbers: [1, 2, 3, 4, 5, 6] },
			{ numbers: [7, 8, 9, 10, 11, 12] },
		];
		const spread = {
			mode: "spread" as const,
			fixedNumbers: [],
			spreadRemainder: false,
		};
		expect(isDraw({ ...lotto, rows, lottoOptions: spread })).toBe(true);
		expect(
			isDraw({ ...lotto, rows: [rows[0], rows[0]], lottoOptions: spread }),
		).toBe(false);
		expect(
			isDraw({
				...lotto,
				rows: [rows[0], rows[0]],
				lottoOptions: { ...spread, mode: "random", spreadRemainder: true },
			}),
		).toBe(true);
	});
});
