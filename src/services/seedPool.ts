import { env } from "cloudflare:workers";

const POOL_KEY = "seed_pool";
const POOL_SIZE = 1000; // 풀에 저장할 난수 개수
const REFILL_THRESHOLD = 100; // 이 이하로 떨어지면 리필

export interface SeedPool {
	seeds: number[];
	source: "quantum" | "atmospheric" | "csprng";
	createdAt: number;
}

/**
 * KV에서 시드 풀 가져오기
 */
export async function getPool(): Promise<SeedPool | null> {
	const data = await env.SEED_POOL.get(POOL_KEY, "json");
	return data as SeedPool | null;
}

/**
 * KV에 시드 풀 저장하기
 */
export async function savePool(pool: SeedPool): Promise<void> {
	await env.SEED_POOL.put(POOL_KEY, JSON.stringify(pool), {
		expirationTtl: 60 * 60 * 24, // 24시간 후 만료
	});
}

/**
 * Priority 1: ANU Quantum Random Number Generator
 */
async function fetchQuantumSeeds(count: number): Promise<number[] | null> {
	try {
		const response = await fetch(
			`https://qrng.anu.edu.au/API/jsonI.php?length=${count}&type=uint16&size=2`,
			{ signal: AbortSignal.timeout(5000) },
		);

		if (!response.ok) {
			throw new Error(`ANU API returned ${response.status}`);
		}

		const data = (await response.json()) as {
			success: boolean;
			data?: number[];
		};

		if (!data.success || !data.data || data.data.length === 0) {
			throw new Error("Invalid ANU API response");
		}

		console.log(`Fetched ${data.data.length} seeds from ANU Quantum`);
		return data.data;
	} catch (error) {
		console.warn("Failed to fetch from ANU Quantum:", error);
		return null;
	}
}

/**
 * Priority 2: Random.org Atmospheric Noise
 */
async function fetchAtmosphericSeeds(count: number): Promise<number[] | null> {
	try {
		// Random.org은 한번에 최대 10000개까지 가능
		const response = await fetch(
			`https://www.random.org/integers/?num=${count}&min=0&max=65535&col=1&base=10&format=plain&rnd=new`,
			{ signal: AbortSignal.timeout(10000) },
		);

		if (!response.ok) {
			throw new Error(`Random.org API returned ${response.status}`);
		}

		const text = await response.text();
		const seeds = text
			.trim()
			.split("\n")
			.map((v) => Number.parseInt(v.trim(), 10));

		if (seeds.length < count || seeds.some(Number.isNaN)) {
			throw new Error("Invalid Random.org response");
		}

		console.log(`Fetched ${seeds.length} seeds from Random.org`);
		return seeds;
	} catch (error) {
		console.warn("Failed to fetch from Random.org:", error);
		return null;
	}
}

/**
 * Priority 3: Web Crypto CSPRNG
 */
function generateCSPRNGSeeds(count: number): number[] {
	const values = new Uint16Array(count);
	crypto.getRandomValues(values);
	console.log(`Generated ${count} seeds from CSPRNG`);
	return Array.from(values);
}

/**
 * 시드 풀 채우기 (우선순위: Quantum → Atmospheric → CSPRNG)
 */
export async function refillPool(): Promise<SeedPool> {
	let seeds: number[] | null = null;
	let source: SeedPool["source"] = "csprng";

	// Priority 1: ANU Quantum (최대 1024개 제한)
	const quantumCount = Math.min(POOL_SIZE, 1024);
	seeds = await fetchQuantumSeeds(quantumCount);
	if (seeds) {
		source = "quantum";
	}

	// Priority 2: Random.org
	if (!seeds) {
		seeds = await fetchAtmosphericSeeds(POOL_SIZE);
		if (seeds) {
			source = "atmospheric";
		}
	}

	// Priority 3: CSPRNG fallback
	if (!seeds) {
		seeds = generateCSPRNGSeeds(POOL_SIZE);
		source = "csprng";
	}

	const pool: SeedPool = {
		seeds,
		source,
		createdAt: Date.now(),
	};

	await savePool(pool);
	console.log(`Pool refilled with ${seeds.length} seeds from ${source}`);

	return pool;
}

/**
 * 풀에서 시드 소비하고 난수 생성
 */
export async function consumeFromPool(
	min: number,
	max: number,
	count: number,
): Promise<{ numbers: number[]; source: SeedPool["source"] }> {
	let pool = await getPool();

	// 풀이 없거나 부족하면 리필
	if (!pool || pool.seeds.length < count) {
		pool = await refillPool();
	}

	// 풀에서 시드 꺼내기
	const usedSeeds = pool.seeds.splice(0, count);
	const source = pool.source;

	// 남은 풀 저장 (백그라운드 리필 트리거)
	if (pool.seeds.length < REFILL_THRESHOLD) {
		// 비동기로 리필 (응답 블로킹 안함)
		refillPool().catch(console.error);
	} else {
		// 남은 풀 저장
		savePool(pool).catch(console.error);
	}

	// 시드를 범위 내 숫자로 변환
	const range = max - min + 1;
	const numbers = usedSeeds.map((seed) => min + (seed % range));

	return { numbers, source };
}

/**
 * 중복 없는 난수 생성
 */
export async function consumeUniqueFromPool(
	min: number,
	max: number,
	count: number,
): Promise<{ numbers: number[]; source: SeedPool["source"] }> {
	const range = max - min + 1;

	if (count > range) {
		throw new Error("Cannot generate more unique numbers than range allows");
	}

	// 중복 제거를 위해 더 많이 가져오기
	const fetchCount = Math.min(count * 3, range);
	const result = await consumeFromPool(min, max, fetchCount);

	const uniqueSet = new Set<number>();
	for (const num of result.numbers) {
		uniqueSet.add(num);
		if (uniqueSet.size >= count) break;
	}

	// 부족하면 CSPRNG로 채우기
	while (uniqueSet.size < count) {
		const values = new Uint32Array(1);
		crypto.getRandomValues(values);
		uniqueSet.add(min + (values[0] % range));
	}

	return {
		numbers: Array.from(uniqueSet).slice(0, count),
		source: result.source,
	};
}
