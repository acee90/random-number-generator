export type EntropySource = "quantum" | "atmospheric" | "csprng";
export type RandomSource = EntropySource | "mixed";

export interface EntropyBatch {
	seeds: number[];
	source: EntropySource;
}

export interface RandomRequest {
	min: number;
	max: number;
	count: number;
	unique?: boolean;
}

export type LottoStrategy = "random" | "spread";

export interface LotteryRequest {
	kind: "lotto" | "pension";
	count: number;
	group?: number | "all";
	strategy?: LottoStrategy;
	fixedNumbers?: number[];
	excludedNumbers?: number[];
}

export interface LotteryTicket {
	numbers: number[];
	group?: number;
}

export function validateRandomRequest(value: unknown): RandomRequest {
	if (!value || typeof value !== "object") {
		throw new Error("생성 조건을 확인해 주세요.");
	}
	const data = value as RandomRequest;
	if (!Number.isSafeInteger(data.min) || !Number.isSafeInteger(data.max)) {
		throw new Error("최소값과 최대값은 안전한 범위의 정수여야 합니다.");
	}
	if (data.min > data.max) {
		throw new Error("최대값은 최소값 이상이어야 합니다.");
	}
	const range = BigInt(data.max) - BigInt(data.min) + 1n;
	if (range > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new Error("숫자 범위가 너무 큽니다.");
	}
	if (!Number.isInteger(data.count) || data.count < 1 || data.count > 100) {
		throw new Error("생성 개수는 1~100 사이의 정수여야 합니다.");
	}
	if (data.unique !== undefined && typeof data.unique !== "boolean") {
		throw new Error("중복 여부를 확인해 주세요.");
	}
	if (data.unique && BigInt(data.count) > range) {
		throw new Error("중복 없이 생성할 수 있는 숫자가 부족합니다.");
	}
	return {
		min: data.min,
		max: data.max,
		count: data.count,
		unique: data.unique,
	};
}

export function validateLotteryRequest(value: unknown): LotteryRequest {
	if (!value || typeof value !== "object") {
		throw new Error("추첨 조건을 확인해 주세요.");
	}
	const data = value as LotteryRequest;
	if (data.kind !== "lotto" && data.kind !== "pension") {
		throw new Error("복권 종류를 확인해 주세요.");
	}
	if (!Number.isInteger(data.count) || data.count < 1 || data.count > 5) {
		throw new Error("게임 수는 1~5 사이의 정수여야 합니다.");
	}
	if (data.kind !== "lotto") {
		if (
			data.strategy !== undefined ||
			data.fixedNumbers !== undefined ||
			data.excludedNumbers !== undefined
		) {
			throw new Error(
				"번호 고정·제외와 분산 추첨은 로또에서만 사용할 수 있습니다.",
			);
		}
	} else {
		if (
			data.strategy !== undefined &&
			data.strategy !== "random" &&
			data.strategy !== "spread"
		) {
			throw new Error("로또 추첨 방식을 확인해 주세요.");
		}
		if (data.fixedNumbers !== undefined) {
			if (
				!Array.isArray(data.fixedNumbers) ||
				data.fixedNumbers.length > 5 ||
				Array.from(data.fixedNumbers).some(
					(number) => !Number.isInteger(number) || number < 1 || number > 45,
				) ||
				new Set(data.fixedNumbers).size !== data.fixedNumbers.length
			) {
				throw new Error(
					"고정 번호는 1~45 중 서로 다른 숫자로 최대 5개까지 선택하세요.",
				);
			}
		}
		if (data.excludedNumbers !== undefined) {
			if (
				!Array.isArray(data.excludedNumbers) ||
				data.excludedNumbers.length > 39 ||
				Array.from(data.excludedNumbers).some(
					(number) => !Number.isInteger(number) || number < 1 || number > 45,
				) ||
				new Set(data.excludedNumbers).size !== data.excludedNumbers.length
			) {
				throw new Error(
					"제외 번호는 1~45 중 서로 다른 숫자로 최대 39개까지 선택하세요.",
				);
			}
		}
		const fixed = data.fixedNumbers ?? [];
		const excluded = data.excludedNumbers ?? [];
		if (fixed.some((number) => excluded.includes(number))) {
			throw new Error(
				"같은 번호를 고정 번호와 제외 번호로 함께 선택할 수 없습니다.",
			);
		}
		const available = 45 - fixed.length - excluded.length;
		const remaining = 6 - fixed.length;
		if (data.strategy === "spread") {
			const required = data.count * remaining;
			if (available < required) {
				throw new Error(
					`분산 추첨에 필요한 번호는 ${required}개인데, 고정·제외 번호를 뺀 남은 번호는 ${available}개입니다. 제외 번호나 게임 수를 줄여 주세요.`,
				);
			}
		} else {
			const possible = combinations(available, remaining);
			if (possible < data.count) {
				throw new Error(
					`현재 조건에서 서로 다른 조합은 ${possible}게임까지 만들 수 있습니다. 요청한 ${data.count}게임을 뽑으려면 제외 번호나 게임 수를 줄여 주세요.`,
				);
			}
		}
	}
	if (data.group === "all") {
		if (data.kind !== "pension") {
			throw new Error("모든 조 선택은 연금복권에서만 사용할 수 있습니다.");
		}
		if (data.count !== 5) {
			throw new Error("모든 조 선택은 5게임으로 추첨해야 합니다.");
		}
	} else if (
		data.group !== undefined &&
		(!Number.isInteger(data.group) || data.group < 1 || data.group > 5)
	) {
		throw new Error("조는 1~5 사이에서 선택해 주세요.");
	}
	return {
		kind: data.kind,
		count: data.count,
		group: data.group,
		...(data.strategy !== undefined ? { strategy: data.strategy } : {}),
		...(data.fixedNumbers !== undefined
			? { fixedNumbers: [...data.fixedNumbers].sort((a, b) => a - b) }
			: {}),
		...(data.excludedNumbers !== undefined
			? { excludedNumbers: [...data.excludedNumbers].sort((a, b) => a - b) }
			: {}),
	};
}

/** Each instance owns fresh entropy; no raw value is shared between requests. */
export class RandomSampler {
	private batch: EntropyBatch | undefined;
	private offset = 0;
	private readonly sources = new Set<EntropySource>();

	constructor(
		private readonly fetchEntropy: (count: number) => Promise<EntropyBatch>,
		private readonly batchSize = 64,
	) {}

	get source(): RandomSource {
		return this.sources.size > 1
			? "mixed"
			: (this.sources.values().next().value ?? "csprng");
	}

	/** Rejection sampling preserves uniformity, including ranges wider than 16 bits. */
	async below(range: number): Promise<number> {
		if (!Number.isSafeInteger(range) || range < 1) {
			throw new Error("Invalid sampling range");
		}
		const bound = BigInt(range);
		const wordCount = Math.max(
			1,
			Math.ceil((bound - 1n).toString(2).length / 16),
		);
		const space = 1n << BigInt(wordCount * 16);
		const limit = space - (space % bound);
		for (let attempt = 0; attempt < 128; attempt++) {
			let value = 0n;
			const sampleSources = new Set<EntropySource>();
			for (let word = 0; word < wordCount; word++) {
				if (!this.batch || this.offset >= this.batch.seeds.length) {
					this.batch = await this.fetchEntropy(this.batchSize);
					this.offset = 0;
					if (
						!Array.isArray(this.batch.seeds) ||
						!this.batch.seeds.length ||
						this.batch.seeds.some(
							(seed) => !Number.isInteger(seed) || seed < 0 || seed > 65535,
						)
					) {
						throw new Error("난수 원천의 응답이 올바르지 않습니다.");
					}
				}
				value = (value << 16n) | BigInt(this.batch.seeds[this.offset++]);
				sampleSources.add(this.batch.source);
			}
			if (value < limit) {
				for (const source of sampleSources) this.sources.add(source);
				return Number(value % bound);
			}
		}
		throw new Error("난수 변환에 실패했습니다. 다시 시도해 주세요.");
	}

	/** Sparse Fisher–Yates: exact count, without duplicate-retry loops. */
	async unique(range: number, count: number): Promise<number[]> {
		if (count > range) throw new Error("Not enough distinct numbers");
		const swaps = new Map<number, number>();
		const result: number[] = [];
		for (let index = 0; index < count; index++) {
			const remaining = range - index;
			const selected = await this.below(remaining);
			result.push(swaps.get(selected) ?? selected);
			swaps.set(selected, swaps.get(remaining - 1) ?? remaining - 1);
		}
		return result;
	}
}

export async function drawNumbers(data: RandomRequest, sampler: RandomSampler) {
	const range = data.max - data.min + 1;
	const offsets = data.unique ? await sampler.unique(range, data.count) : [];
	if (!data.unique) {
		for (let i = 0; i < data.count; i++)
			offsets.push(await sampler.below(range));
	}
	return {
		numbers: offsets.map((offset) => data.min + offset),
		source: sampler.source,
	};
}

function combinations(n: number, k: number): number {
	if (k < 0 || k > n) return 0;
	let result = 1;
	for (let i = 1; i <= k; i++) result = (result * (n - i + 1)) / i;
	return Math.round(result);
}

function combinationFromRank(
	rank: number,
	candidates: number[],
	count: number,
): number[] {
	const result: number[] = [];
	let previous = -1;
	for (let position = 0; position < count; position++) {
		for (let index = previous + 1; index < candidates.length; index++) {
			const block = combinations(
				candidates.length - index - 1,
				count - position - 1,
			);
			if (rank < block) {
				result.push(candidates[index]);
				previous = index;
				break;
			}
			rank -= block;
		}
	}
	return result;
}

export async function drawLottery(
	data: LotteryRequest,
	sampler: RandomSampler,
) {
	data = validateLotteryRequest(data);
	if (data.kind === "lotto") {
		const fixed = data.fixedNumbers ?? [];
		const fixedSet = new Set(fixed);
		const excludedSet = new Set(data.excludedNumbers ?? []);
		const candidates = Array.from(
			{ length: 45 },
			(_, index) => index + 1,
		).filter((number) => !fixedSet.has(number) && !excludedSet.has(number));
		const remaining = 6 - fixed.length;
		let completions: number[][];
		if (data.strategy === "spread") {
			// A shared shuffled deck makes the random parts disjoint across games.
			const offsets = await sampler.unique(
				candidates.length,
				data.count * remaining,
			);
			completions = Array.from({ length: data.count }, (_, index) =>
				offsets
					.slice(index * remaining, (index + 1) * remaining)
					.map((offset) => candidates[offset]),
			);
		} else {
			// Distinct ranks preserve uniformity over all combinations containing fixed numbers.
			const ranks = await sampler.unique(
				combinations(candidates.length, remaining),
				data.count,
			);
			completions = ranks.map((rank) =>
				combinationFromRank(rank, candidates, remaining),
			);
		}
		const tickets: LotteryTicket[] = completions.map((numbers) => ({
			numbers: [...fixed, ...numbers].sort((a, b) => a - b),
		}));
		return { tickets, source: sampler.source };
	}
	const group = data.group;
	if (group === "all") {
		const number = await sampler.below(1_000_000);
		const digits = String(number).padStart(6, "0").split("").map(Number);
		const tickets: LotteryTicket[] = Array.from({ length: 5 }, (_, index) => ({
			group: index + 1,
			numbers: [...digits],
		}));
		return { tickets, source: sampler.source };
	}
	// Sampling distinct ranks also guarantees that games in one draw do not repeat.
	const range = group ? 1_000_000 : 5_000_000;
	const ranks = await sampler.unique(range, data.count);
	const tickets: LotteryTicket[] = ranks.map((rank) => ({
		group: group ?? Math.floor(rank / 1_000_000) + 1,
		numbers: String(rank % 1_000_000)
			.padStart(6, "0")
			.split("")
			.map(Number),
	}));
	return { tickets, source: sampler.source };
}
