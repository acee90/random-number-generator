import { env } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import {
	drawLottery,
	type LotteryTicket,
	type RandomSource,
	validateLotteryRequest,
	validateRandomRequest,
} from "./randomCore";
import {
	consumeFromPool,
	consumeUniqueFromPool,
	createRequestSampler,
} from "./seedPool";

export type { LotteryTicket, LottoStrategy, RandomSource } from "./randomCore";

export interface RandomResult {
	numbers: number[];
	source: RandomSource;
}

/**
 * 난수 생성 API
 * 요청별 새 난수 취득 → 실패시 CSPRNG. 검증 오류는 그대로 반환합니다.
 */
export const generateRandomNumbers = createServerFn({ method: "POST" })
	.inputValidator(validateRandomRequest)
	.handler(async ({ data }): Promise<RandomResult> => {
		const { min, max, count, unique } = data;

		if (unique) {
			return consumeUniqueFromPool(min, max, count);
		}
		return consumeFromPool(min, max, count);
	});

export interface LotteryResult {
	tickets: LotteryTicket[];
	source: RandomSource;
}

export const generateLotteryNumbers = createServerFn({ method: "POST" })
	.inputValidator(validateLotteryRequest)
	.handler(async ({ data }): Promise<LotteryResult> => {
		const samplerCount =
			data.kind === "lotto" && data.strategy === "spread"
				? Math.max(
						data.count,
						Math.ceil(
							(data.count * (6 - (data.fixedNumbers?.length ?? 0))) / 4,
						),
					)
				: data.count;
		return drawLottery(data, createRequestSampler(samplerCount));
	});

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
			anu: {
				url: "https://api.quantumnumbers.anu.edu.au",
				status: "unknown" as string,
			},
			randomOrg: {
				url: env.RANDOM_ORG_API_KEY?.trim()
					? "https://api.random.org"
					: "https://www.random.org",
				status: "unknown" as string,
			},
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
