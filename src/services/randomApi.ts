import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { consumeFromPool, consumeUniqueFromPool } from "./seedPool";

export type RandomSource = "quantum" | "atmospheric" | "csprng";

export interface RandomResult {
	numbers: number[];
	source: RandomSource;
}

/**
 * 난수 생성 API
 * KV 시드 풀 사용 → 풀 비면 외부 API로 리필 → 실패시 CSPRNG
 */
export const generateRandomNumbers = createServerFn({ method: "POST" })
	.inputValidator((d: { min: number; max: number; count: number; unique?: boolean }) => d)
	.handler(async ({ data }): Promise<RandomResult> => {
		const { min, max, count, unique } = data;

		// 유효성 검사
		if (min >= max) {
			throw new Error("min must be less than max");
		}
		if (count < 1 || count > 100) {
			throw new Error("count must be between 1 and 100");
		}

		try {
			if (unique) {
				return await consumeUniqueFromPool(min, max, count);
			}
			return await consumeFromPool(min, max, count);
		} catch (error) {
			console.error("Pool consumption failed, falling back to CSPRNG:", error);

			// 최종 폴백: CSPRNG
			const range = max - min + 1;
			const values = new Uint32Array(count);
			crypto.getRandomValues(values);

			const numbers = unique
				? Array.from(
						new Set(Array.from(values).map((v) => min + (v % range))),
					).slice(0, count)
				: Array.from(values).map((v) => min + (v % range));

			return { numbers, source: "csprng" };
		}
	},
);

/**
 * 시드 풀 상태 확인 API
 */
export const getPoolStatus = createServerFn({ method: "GET" }).handler(
	async () => {
		const { getPool } = await import("./seedPool");
		const pool = await getPool();

		return pool
			? {
					hasPool: true,
					remaining: pool.seeds.length,
					source: pool.source,
					createdAt: pool.createdAt,
				}
			: {
					hasPool: false,
					remaining: 0,
					source: null,
					createdAt: null,
				};
	},
);

/**
 * 시드 풀 강제 리필 API
 */
export const forceRefillPool = createServerFn({ method: "POST" }).handler(
	async () => {
		const { refillPool } = await import("./seedPool");
		const pool = await refillPool();

		return {
			success: true,
			remaining: pool.seeds.length,
			source: pool.source,
		};
	},
);

/**
 * KV 바인딩 상태 확인 API
 */
export const getBindingStatus = createServerFn({ method: "GET" }).handler(
	async () => {
		const bindings: Record<string, { available: boolean; type: string }> = {};

		// SEED_POOL KV 확인
		try {
			const hasKV = env.SEED_POOL !== undefined;
			bindings.SEED_POOL = {
				available: hasKV,
				type: hasKV ? "KVNamespace" : "undefined",
			};
		} catch {
			bindings.SEED_POOL = { available: false, type: "error" };
		}

		return {
			timestamp: Date.now(),
			bindings,
		};
	},
);

/**
 * 전체 시스템 상태 확인 API
 */
export const getSystemStatus = createServerFn({ method: "GET" }).handler(
	async () => {
		const { getPool } = await import("./seedPool");

		// KV 바인딩 상태
		let kvStatus: "connected" | "error" | "unavailable" = "unavailable";
		let kvError: string | null = null;

		try {
			if (env.SEED_POOL) {
				// KV 접근 테스트
				await env.SEED_POOL.get("__health_check__");
				kvStatus = "connected";
			}
		} catch (e) {
			kvStatus = "error";
			kvError = e instanceof Error ? e.message : "Unknown error";
		}

		// 풀 상태
		let poolStatus: {
			exists: boolean;
			remaining: number;
			source: string | null;
			ageMinutes: number | null;
		} = {
			exists: false,
			remaining: 0,
			source: null,
			ageMinutes: null,
		};

		try {
			const pool = await getPool();
			if (pool) {
				poolStatus = {
					exists: true,
					remaining: pool.seeds.length,
					source: pool.source,
					ageMinutes: Math.round((Date.now() - pool.createdAt) / 60000),
				};
			}
		} catch {
			// 풀 조회 실패
		}

		// 외부 API 상태 (간단한 체크)
		const externalApis = {
			anu: { url: "https://qrng.anu.edu.au", status: "unknown" as string },
			randomOrg: { url: "https://www.random.org", status: "unknown" as string },
		};

		return {
			timestamp: Date.now(),
			kv: {
				status: kvStatus,
				error: kvError,
			},
			pool: poolStatus,
			externalApis,
			environment: {
				runtime: "cloudflare-workers",
			},
		};
	},
);
