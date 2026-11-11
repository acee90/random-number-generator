import { env } from "cloudflare:workers";
import {
	drawNumbers,
	type EntropyBatch,
	type EntropySource,
	RandomSampler,
	validateRandomRequest,
} from "./randomCore";

const POOL_KEY = "seed_pool";
const POOL_SIZE = 1000; // 풀에 저장할 난수 개수

export interface SeedPool {
	seeds: number[];
	source: EntropySource;
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
	const apiKey = env.ANU_API_KEY?.trim();
	if (!apiKey) return null;

	try {
		const response = await fetch(
			`https://api.quantumnumbers.anu.edu.au?length=${count}&type=uint16`,
			{
				headers: { "x-api-key": apiKey },
				signal: AbortSignal.timeout(5000),
			},
		);

		if (!response.ok) {
			throw new Error(`ANU API returned ${response.status}`);
		}

		const data = (await response.json()) as {
			success: boolean;
			data?: number[];
		};

		if (!data.success || !isValidSeeds(data.data, count)) {
			throw new Error("Invalid ANU API response");
		}

		console.log(`Fetched ${data.data.length} seeds from ANU Quantum`);
		return data.data;
	} catch {
		// Do not log raw fetch errors: their causes may contain request credentials.
		console.warn("ANU Quantum request failed; trying the next source.");
		return null;
	}
}

/**
 * Priority 2: Random.org Atmospheric Noise
 */
async function fetchAtmosphericSeeds(count: number): Promise<number[] | null> {
	try {
		const apiKey = env.RANDOM_ORG_API_KEY?.trim();
		// 키가 있으면 JSON-RPC API, 없으면 기존 공개 HTTP API를 사용합니다.
		const response = apiKey
			? await fetch("https://api.random.org/json-rpc/4/invoke", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						method: "generateIntegers",
						params: {
							apiKey,
							n: count,
							min: 0,
							max: 65535,
							replacement: true,
							base: 10,
						},
						id: crypto.randomUUID(),
					}),
					signal: AbortSignal.timeout(10000),
				})
			: await fetch(
					`https://www.random.org/integers/?num=${count}&min=0&max=65535&col=1&base=10&format=plain&rnd=new`,
					{ signal: AbortSignal.timeout(10000) },
				);

		if (!response.ok) {
			throw new Error(`Random.org API returned ${response.status}`);
		}

		let seeds: unknown;
		if (apiKey) {
			const data = (await response.json()) as {
				result?: { random?: { data?: number[] } };
				error?: { code: number };
			};
			if (data.error) {
				throw new Error(`Random.org API error ${data.error.code}`);
			}
			seeds = data.result?.random?.data;
		} else {
			const text = await response.text();
			seeds = text.trim().split(/\s+/).map(Number);
		}

		if (!isValidSeeds(seeds, count)) {
			throw new Error("Invalid Random.org response");
		}

		console.log(`Fetched ${seeds.length} seeds from Random.org`);
		return seeds;
	} catch {
		console.warn("Random.org request failed; trying the next source.");
		return null;
	}
}

function isValidSeeds(seeds: unknown, count: number): seeds is number[] {
	return (
		Array.isArray(seeds) &&
		seeds.length === count &&
		seeds.every((seed) => Number.isInteger(seed) && seed >= 0 && seed <= 65535)
	);
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

/** Fetch a fresh batch for one request. Never read shared KV entropy here. */
export async function fetchEntropy(count: number): Promise<EntropyBatch> {
	const quantum = await fetchQuantumSeeds(count);
	if (quantum) return { seeds: quantum, source: "quantum" };
	const atmospheric = await fetchAtmosphericSeeds(count);
	if (atmospheric) return { seeds: atmospheric, source: "atmospheric" };
	return { seeds: generateCSPRNGSeeds(count), source: "csprng" };
}

/** Legacy manual refill is diagnostic only; these values are never used by draws. */
export async function refillPool(): Promise<SeedPool> {
	const batch = await fetchEntropy(POOL_SIZE);
	const pool: SeedPool = { ...batch, createdAt: Date.now() };
	await savePool(pool);
	return pool;
}

export function createRequestSampler(count: number): RandomSampler {
	return new RandomSampler(
		fetchEntropy,
		Math.min(1024, Math.max(16, count * 4 + 8)),
	);
}

/** Compatibility names: generation now owns fresh entropy rather than a KV queue. */
export async function consumeFromPool(min: number, max: number, count: number) {
	const data = validateRandomRequest({ min, max, count, unique: false });
	return drawNumbers(data, createRequestSampler(count));
}

export async function consumeUniqueFromPool(
	min: number,
	max: number,
	count: number,
) {
	const data = validateRandomRequest({ min, max, count, unique: true });
	return drawNumbers(data, createRequestSampler(count));
}
