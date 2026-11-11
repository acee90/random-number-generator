import { describe, expect, it } from "vitest";
import {
	drawLottery,
	drawNumbers,
	type EntropySource,
	RandomSampler,
	validateLotteryRequest,
	validateRandomRequest,
} from "../src/services/randomCore";

function sampler(words: number[], source: EntropySource = "quantum") {
	return new RandomSampler(async () => ({ seeds: [...words], source }));
}

describe("random request validation", () => {
	const valid = { min: 1, max: 3, count: 3, unique: true };
	it("accepts a fixed one-number range", () => {
		expect(validateRandomRequest({ min: 7, max: 7, count: 1 })).toEqual({
			min: 7,
			max: 7,
			count: 1,
			unique: undefined,
		});
	});
	it.each([
		{ ...valid, min: 1.5 },
		{ ...valid, max: NaN },
		{ ...valid, min: "1" },
		{ ...valid, max: Infinity },
		{ ...valid, max: Number.MAX_SAFE_INTEGER + 1 },
		{ ...valid, min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
		{ ...valid, count: 1.5 },
		{ ...valid, count: 0 },
		{ ...valid, count: 101 },
		{ ...valid, count: 4 },
		{ ...valid, unique: "true" },
		{ ...valid, min: 4 },
		null,
	])("rejects invalid input %j", (data) => {
		expect(() => validateRandomRequest(data)).toThrow();
	});
});

describe("unbiased sampling", () => {
	it("rejects the incomplete modulo tail", async () => {
		expect(await sampler([60000, 65535, 123]).below(10000)).toBe(123);
	});
	it("maps the whole accepted domain evenly", async () => {
		const stream = sampler(Array.from({ length: 60000 }, (_, i) => i));
		const frequencies = new Uint8Array(10000);
		for (let i = 0; i < 60000; i++) frequencies[await stream.below(10000)]++;
		expect(frequencies.every((frequency) => frequency === 6)).toBe(true);
	});
	it("can reach values above 65535", async () => {
		expect(await sampler([1, 0]).below(1_000_001)).toBe(65536);
	});
	it("handles the 48-bit boundary without float bit-count rounding", async () => {
		expect(await sampler([1, 0, 0, 0]).below(2 ** 48 + 1)).toBe(2 ** 48);
	});
	it("handles a full safe-integer range", async () => {
		expect(await sampler([0, 0, 0, 9]).below(Number.MAX_SAFE_INTEGER)).toBe(9);
	});
	it.each([
		{ min: -Number.MAX_SAFE_INTEGER, max: -1 },
		{ min: 1, max: Number.MAX_SAFE_INTEGER },
		{ min: -4_503_599_627_370_495, max: 4_503_599_627_370_495 },
		{ min: Number.MAX_SAFE_INTEGER - 2, max: Number.MAX_SAFE_INTEGER },
		{ min: -Number.MAX_SAFE_INTEGER, max: -Number.MAX_SAFE_INTEGER + 2 },
	])("preserves exact endpoints across extreme ranges %j", async (range) => {
		const data = validateRandomRequest({ ...range, count: 1 });
		const width = BigInt(data.max) - BigInt(data.min) + 1n;
		expect(BigInt(data.max - data.min + 1)).toBe(width);
		const lastOffset = width - 1n;
		const words = [];
		const wordCount = Math.max(
			1,
			Math.ceil((width - 1n).toString(2).length / 16),
		);
		for (let i = wordCount - 1; i >= 0; i--) {
			words.push(Number((lastOffset >> BigInt(i * 16)) & 65535n));
		}
		expect((await drawNumbers(data, sampler([0]))).numbers).toEqual([data.min]);
		expect((await drawNumbers(data, sampler(words))).numbers).toEqual([
			data.max,
		]);
	});
	it("returns the exact unique count even with repeated raw values", async () => {
		const result = await drawNumbers(
			{ min: 1, max: 3, count: 3, unique: true },
			sampler([0]),
		);
		expect(result.numbers.sort()).toEqual([1, 2, 3]);
	});
	it("reports every accepted source rather than hiding mixed provenance", async () => {
		let batch = 0;
		const stream = new RandomSampler(
			async () => ({
				seeds: [0],
				source: batch++ === 0 ? "quantum" : "csprng",
			}),
			1,
		);
		await stream.below(10);
		await stream.below(10);
		expect(stream.source).toBe("mixed");
	});
	it("bounds repeated rejection instead of looping indefinitely", async () => {
		await expect(sampler([65535]).below(10000)).rejects.toThrow();
	});
	it("records mixed sources within a single multiword sample", async () => {
		let batch = 0;
		const stream = new RandomSampler(
			async () =>
				batch++ === 0
					? { seeds: [0], source: "quantum" }
					: { seeds: [7], source: "csprng" },
			1,
		);
		expect(await stream.below(1_000_000)).toBe(7);
		expect(stream.source).toBe("mixed");
	});
	it("does not attribute rejected words to the accepted result", async () => {
		let batch = 0;
		const stream = new RandomSampler(
			async () =>
				batch++ === 0
					? { seeds: [65535], source: "quantum" }
					: { seeds: [7], source: "csprng" },
			1,
		);
		expect(await stream.below(10000)).toBe(7);
		expect(stream.source).toBe("csprng");
	});
});

describe("lottery draws", () => {
	it("unranks the first and final Lotto combinations", async () => {
		const first = await drawLottery(
			{ kind: "lotto", count: 1 },
			sampler([0, 0]),
		);
		expect(first.tickets[0].numbers).toEqual([1, 2, 3, 4, 5, 6]);
		const lastRank = 8_145_059;
		const last = await drawLottery(
			{ kind: "lotto", count: 1 },
			sampler([lastRank >> 16, lastRank & 65535]),
		);
		expect(last.tickets[0].numbers).toEqual([40, 41, 42, 43, 44, 45]);
	});
	it("returns five different, valid sorted Lotto games", async () => {
		const { tickets } = await drawLottery(
			{ kind: "lotto", count: 5 },
			sampler([0]),
		);
		expect(
			new Set(tickets.map((ticket) => ticket.numbers.join(","))).size,
		).toBe(5);
		for (const { numbers } of tickets) {
			expect(numbers).toHaveLength(6);
			expect(new Set(numbers).size).toBe(6);
			expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
			expect(numbers.every((n) => n >= 1 && n <= 45)).toBe(true);
		}
	});
	it("keeps six pension digits including leading zeroes", async () => {
		const { tickets } = await drawLottery(
			{ kind: "pension", count: 1 },
			sampler([0]),
		);
		expect(tickets[0]).toEqual({ group: 1, numbers: [0, 0, 0, 0, 0, 0] });
	});
	it("honors a fixed group and never repeats a pension ticket", async () => {
		const { tickets } = await drawLottery(
			{ kind: "pension", count: 5, group: 5 },
			sampler([0]),
		);
		expect(
			tickets.every(
				(ticket) => ticket.group === 5 && ticket.numbers.length === 6,
			),
		).toBe(true);
		expect(new Set(tickets.map((ticket) => ticket.numbers.join(""))).size).toBe(
			5,
		);
	});
	it("can produce the last group and six nines", async () => {
		const rank = 4_999_999;
		const { tickets } = await drawLottery(
			{ kind: "pension", count: 1 },
			sampler([rank >> 16, rank & 65535]),
		);
		expect(tickets[0]).toEqual({ group: 5, numbers: [9, 9, 9, 9, 9, 9] });
	});
	it("uses one six-digit draw for all five pension groups", async () => {
		const request = validateLotteryRequest({
			kind: "pension",
			count: 5,
			group: "all",
		});
		expect(request.group).toBe("all");
		const { tickets, source } = await drawLottery(request, sampler([0, 123]));
		expect(tickets).toHaveLength(5);
		expect(tickets.map((ticket) => ticket.group)).toEqual([1, 2, 3, 4, 5]);
		expect(
			tickets.every((ticket) => ticket.numbers.join("") === "000123"),
		).toBe(true);
		expect(
			new Set(
				tickets.map((ticket) => `${ticket.group}:${ticket.numbers.join("")}`),
			).size,
		).toBe(5);
		expect(source).toBe("quantum");
		// Tickets must not alias the same mutable digits array.
		tickets[0].numbers[0] = 9;
		expect(tickets[1].numbers).toEqual([0, 0, 0, 1, 2, 3]);
	});
	it("supports six nines across all groups", async () => {
		const rank = 999_999;
		const { tickets } = await drawLottery(
			{ kind: "pension", count: 5, group: "all" },
			sampler([rank >> 16, rank & 65535]),
		);
		expect(
			tickets.every((ticket) => ticket.numbers.join("") === "999999"),
		).toBe(true);
	});
	it("rejects an invalid all-group draw even when called directly", async () => {
		await expect(
			drawLottery({ kind: "lotto", count: 5, group: "all" }, sampler([0])),
		).rejects.toThrow();
		await expect(
			drawLottery({ kind: "pension", count: 1, group: "all" }, sampler([0])),
		).rejects.toThrow();
	});
	it.each([
		{ kind: "unknown", count: 1 },
		{ kind: "lotto", count: 0 },
		{ kind: "lotto", count: 6 },
		{ kind: "lotto", count: 1.5 },
		{ kind: "pension", count: 1, group: 0 },
		{ kind: "pension", count: 1, group: 6 },
		{ kind: "pension", count: 1, group: "1" },
		{ kind: "pension", count: 1, group: "all" },
		{ kind: "pension", count: 4, group: "all" },
		{ kind: "lotto", count: 5, group: "all" },
		null,
	])("rejects invalid lottery options %j", (data) => {
		expect(() => validateLotteryRequest(data)).toThrow();
	});
});

describe("Lotto strategies", () => {
	it.each([
		1, 2, 3, 4, 5,
	])("spreads %i games with no numbers shared between games", async (count) => {
		const { tickets, source } = await drawLottery(
			{ kind: "lotto", count, strategy: "spread" },
			sampler([0]),
		);
		expect(tickets).toHaveLength(count);
		const all = tickets.flatMap((ticket) => ticket.numbers);
		expect(new Set(all).size).toBe(count * 6);
		for (const { numbers } of tickets) {
			expect(numbers).toHaveLength(6);
			expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
			expect(numbers.every((number) => number >= 1 && number <= 45)).toBe(true);
		}
		expect(source).toBe("quantum");
	});

	it.each([
		"random",
		"spread",
	] as const)("preserves fixed numbers with %s completion", async (strategy) => {
		const fixedNumbers = [21, 7];
		const { tickets } = await drawLottery(
			{ kind: "lotto", count: 5, strategy, fixedNumbers },
			sampler([0]),
		);
		expect(fixedNumbers).toEqual([21, 7]);
		expect(tickets).toHaveLength(5);
		expect(
			new Set(tickets.map((ticket) => ticket.numbers.join(","))).size,
		).toBe(5);
		for (const { numbers } of tickets) {
			expect(numbers).toHaveLength(6);
			expect(new Set(numbers).size).toBe(6);
			expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
			expect(numbers).toEqual(expect.arrayContaining([7, 21]));
		}
		if (strategy === "spread") {
			const free = tickets.flatMap(({ numbers }) =>
				numbers.filter((number) => !fixedNumbers.includes(number)),
			);
			expect(new Set(free).size).toBe(20);
			for (let i = 0; i < tickets.length; i++) {
				for (let j = i + 1; j < tickets.length; j++) {
					expect(
						tickets[i].numbers.filter((number) =>
							tickets[j].numbers.includes(number),
						),
					).toEqual([7, 21]);
				}
			}
		}
	});

	it("unranks the first and final combinations after excluding fixed numbers", async () => {
		const first = await drawLottery(
			{ kind: "lotto", count: 1, fixedNumbers: [45, 1] },
			sampler([0]),
		);
		expect(first.tickets[0].numbers).toEqual([1, 2, 3, 4, 5, 45]);
		// There are C(43, 4) = 123410 possible completions.
		const lastRank = 123409;
		const last = await drawLottery(
			{ kind: "lotto", count: 1, fixedNumbers: [1, 45], strategy: "random" },
			sampler([lastRank >> 16, lastRank & 65535]),
		);
		expect(last.tickets[0].numbers).toEqual([1, 41, 42, 43, 44, 45]);
	});

	it("can reach each of the 40 completions with five fixed numbers", async () => {
		const results = [];
		for (let rank = 0; rank < 40; rank++) {
			const { tickets } = await drawLottery(
				{ kind: "lotto", count: 1, fixedNumbers: [1, 2, 3, 4, 5] },
				sampler([rank]),
			);
			expect(tickets[0].numbers.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
			results.push(tickets[0].numbers[5]);
		}
		expect(results).toEqual(
			Array.from({ length: 40 }, (_, index) => index + 6),
		);
	});

	it.each([
		"random",
		"spread",
	] as const)("keeps five-game uniqueness with five fixed numbers in %s mode", async (strategy) => {
		const { tickets } = await drawLottery(
			{ kind: "lotto", count: 5, strategy, fixedNumbers: [1, 2, 3, 4, 5] },
			sampler([0]),
		);
		expect(
			new Set(tickets.map((ticket) => ticket.numbers.join(","))).size,
		).toBe(5);
		for (const { numbers } of tickets) {
			expect(numbers.slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
			expect(numbers[5]).toBeGreaterThanOrEqual(6);
			expect(numbers[5]).toBeLessThanOrEqual(45);
		}
	});

	it("retains normal random behavior with an empty fixed set", async () => {
		const implicit = await drawLottery(
			{ kind: "lotto", count: 5 },
			sampler([0]),
		);
		const explicit = await drawLottery(
			{ kind: "lotto", count: 5, strategy: "random", fixedNumbers: [] },
			sampler([0]),
		);
		expect(explicit).toEqual(implicit);
	});

	it("validates and copies a sorted fixed set without aliasing the caller", () => {
		const fixedNumbers = [45, 1, 7];
		const request = validateLotteryRequest({
			kind: "lotto",
			count: 5,
			strategy: "spread",
			fixedNumbers,
		});
		expect(request.fixedNumbers).toEqual([1, 7, 45]);
		expect(request.fixedNumbers).not.toBe(fixedNumbers);
		expect(fixedNumbers).toEqual([45, 1, 7]);
		fixedNumbers[0] = 42;
		expect(request.fixedNumbers).toEqual([1, 7, 45]);
	});

	it.each([
		{ kind: "lotto", count: 5, strategy: "fixed" },
		{ kind: "lotto", count: 5, strategy: null },
		{ kind: "lotto", count: 5, strategy: true },
		{ kind: "lotto", count: 5, fixedNumbers: null },
		{ kind: "lotto", count: 5, fixedNumbers: "1,2" },
		{ kind: "lotto", count: 5, fixedNumbers: { 0: 1, length: 1 } },
		{ kind: "lotto", count: 5, fixedNumbers: [1, 1] },
		{ kind: "lotto", count: 5, fixedNumbers: [0] },
		{ kind: "lotto", count: 5, fixedNumbers: [-1] },
		{ kind: "lotto", count: 5, fixedNumbers: [46] },
		{ kind: "lotto", count: 5, fixedNumbers: [1.5] },
		{ kind: "lotto", count: 5, fixedNumbers: ["1"] },
		{ kind: "lotto", count: 5, fixedNumbers: [NaN] },
		{ kind: "lotto", count: 5, fixedNumbers: [Infinity] },
		{ kind: "lotto", count: 5, fixedNumbers: Array(1) },
		{ kind: "lotto", count: 5, fixedNumbers: [1, 2, 3, 4, 5, 6] },
		{ kind: "pension", count: 5, strategy: "random" },
		{ kind: "pension", count: 5, strategy: "spread", group: "all" },
		{ kind: "pension", count: 1, fixedNumbers: [] },
		{ kind: "pension", count: 5, fixedNumbers: [1] },
	])("rejects incompatible or malformed strategy input %j", (data) => {
		expect(() => validateLotteryRequest(data)).toThrow();
	});

	it("validates strategy conditions even when drawLottery is called directly", async () => {
		await expect(
			drawLottery(
				{ kind: "lotto", count: 5, fixedNumbers: [1, 1] },
				sampler([0]),
			),
		).rejects.toThrow();
		await expect(
			drawLottery(
				{ kind: "pension", count: 5, strategy: "spread" },
				sampler([0]),
			),
		).rejects.toThrow();
	});
});

describe("Lotto excluded numbers", () => {
	const range = (start: number, count: number) =>
		Array.from({ length: count }, (_, index) => start + index);

	it("validates and copies a sorted excluded set without mutating the caller", () => {
		const excludedNumbers = [45, 7, 1];
		const request = validateLotteryRequest({
			kind: "lotto",
			count: 5,
			excludedNumbers,
		});
		expect(request.excludedNumbers).toEqual([1, 7, 45]);
		expect(request.excludedNumbers).not.toBe(excludedNumbers);
		expect(excludedNumbers).toEqual([45, 7, 1]);
		excludedNumbers[0] = 42;
		expect(request.excludedNumbers).toEqual([1, 7, 45]);
	});

	it.each([
		{ strategy: "random" as const, fixedNumbers: [] },
		{ strategy: "spread" as const, fixedNumbers: [] },
		{ strategy: "random" as const, fixedNumbers: [1, 45] },
		{ strategy: "spread" as const, fixedNumbers: [1, 45] },
	])("never draws excluded numbers for %j", async (options) => {
		const excludedNumbers = [2, 4, 6, 8, 10, 12];
		const { tickets, source } = await drawLottery(
			{ kind: "lotto", count: 5, excludedNumbers, ...options },
			sampler([0]),
		);
		expect(tickets).toHaveLength(5);
		expect(new Set(tickets.map(({ numbers }) => numbers.join(","))).size).toBe(
			5,
		);
		for (const { numbers } of tickets) {
			expect(numbers).toHaveLength(6);
			expect(new Set(numbers).size).toBe(6);
			expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
			expect(numbers).toEqual(expect.arrayContaining(options.fixedNumbers));
			expect(numbers.every((number) => !excludedNumbers.includes(number))).toBe(
				true,
			);
		}
		if (options.strategy === "spread") {
			const randomParts = tickets.flatMap(({ numbers }) =>
				numbers.filter((number) => !options.fixedNumbers.includes(number)),
			);
			expect(new Set(randomParts).size).toBe(
				5 * (6 - options.fixedNumbers.length),
			);
		}
		expect(source).toBe("quantum");
	});

	it("uses all remaining numbers at the exact spread capacity", async () => {
		const { tickets } = await drawLottery(
			{
				kind: "lotto",
				count: 5,
				strategy: "spread",
				excludedNumbers: range(1, 15),
			},
			sampler([0]),
		);
		expect(
			tickets.flatMap(({ numbers }) => numbers).sort((a, b) => a - b),
		).toEqual(range(16, 30));
	});

	it("uses the exact remaining pool with both fixed and excluded numbers", async () => {
		const { tickets } = await drawLottery(
			{
				kind: "lotto",
				count: 5,
				strategy: "spread",
				fixedNumbers: [1, 45],
				excludedNumbers: range(3, 23),
			},
			sampler([0]),
		);
		expect(
			tickets
				.flatMap(({ numbers }) =>
					numbers.filter((number) => number !== 1 && number !== 45),
				)
				.sort((a, b) => a - b),
		).toEqual([2, ...range(26, 19)]);
	});

	it("accepts 39 exclusions when one valid combination remains", async () => {
		const { tickets } = await drawLottery(
			{ kind: "lotto", count: 1, excludedNumbers: range(1, 39) },
			sampler([0]),
		);
		expect(tickets).toEqual([{ numbers: [40, 41, 42, 43, 44, 45] }]);
	});

	it.each([
		"random",
		"spread",
	] as const)("accepts exactly five possible completions in %s mode", async (strategy) => {
		const { tickets } = await drawLottery(
			{
				kind: "lotto",
				count: 5,
				strategy,
				fixedNumbers: [1, 2, 3, 4, 5],
				excludedNumbers: range(11, 35),
			},
			sampler([0]),
		);
		expect(
			tickets.map(({ numbers }) => numbers[5]).sort((a, b) => a - b),
		).toEqual([6, 7, 8, 9, 10]);
	});

	it("can reach every remaining combination after exclusions", async () => {
		const combinations = [];
		for (let rank = 0; rank < 7; rank++) {
			const { tickets } = await drawLottery(
				{ kind: "lotto", count: 1, excludedNumbers: range(8, 38) },
				sampler([rank]),
			);
			combinations.push(tickets[0].numbers);
		}
		expect(combinations[0]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(combinations[6]).toEqual([2, 3, 4, 5, 6, 7]);
		expect(new Set(combinations.map((numbers) => numbers.join(","))).size).toBe(
			7,
		);
	});

	it("retains the previous result for an empty exclusion set", async () => {
		const implicit = await drawLottery(
			{ kind: "lotto", count: 5 },
			sampler([0]),
		);
		const explicit = await drawLottery(
			{ kind: "lotto", count: 5, excludedNumbers: [] },
			sampler([0]),
		);
		expect(explicit).toEqual(implicit);
	});

	it("reports the required and available pool for an impossible spread", () => {
		expect(() =>
			validateLotteryRequest({
				kind: "lotto",
				count: 5,
				strategy: "spread",
				fixedNumbers: [1, 45],
				excludedNumbers: range(3, 24),
			}),
		).toThrow(/20개.*19개/);
	});

	it("reports the available distinct combinations for an impossible random draw", () => {
		expect(() =>
			validateLotteryRequest({
				kind: "lotto",
				count: 5,
				fixedNumbers: [1, 2, 3, 4, 5],
				excludedNumbers: range(10, 36),
			}),
		).toThrow(/4게임.*5게임/);
	});

	it.each([
		null,
		"1,2",
		{ 0: 1, length: 1 },
		[1, 1],
		[0],
		[-1],
		[46],
		[1.5],
		["1"],
		[NaN],
		[Infinity],
		Array(1),
		range(1, 40),
	])("rejects malformed exclusions %j", (excludedNumbers) => {
		expect(() =>
			validateLotteryRequest({ kind: "lotto", count: 1, excludedNumbers }),
		).toThrow();
	});

	it.each([
		{ kind: "lotto", count: 1, fixedNumbers: [7], excludedNumbers: [7] },
		{ kind: "lotto", count: 2, excludedNumbers: range(1, 39) },
		{
			kind: "lotto",
			count: 5,
			strategy: "spread",
			excludedNumbers: range(1, 16),
		},
		{ kind: "pension", count: 1, excludedNumbers: [] },
		{ kind: "pension", count: 5, group: "all", excludedNumbers: [1] },
	])("rejects incompatible exclusion conditions %j", (data) => {
		expect(() => validateLotteryRequest(data)).toThrow();
	});

	it("rejects invalid direct draws before requesting entropy", async () => {
		let fetched = false;
		const stream = new RandomSampler(async () => {
			fetched = true;
			return { seeds: [0], source: "quantum" };
		});
		await expect(
			drawLottery(
				{
					kind: "lotto",
					count: 5,
					strategy: "spread",
					excludedNumbers: range(1, 16),
				},
				stream,
			),
		).rejects.toThrow(/30개.*29개/);
		expect(fetched).toBe(false);
	});
});
