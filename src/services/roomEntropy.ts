import { drawNumbers, type EntropyBatch, RandomSampler } from "./randomCore";

export const roomEntropyTtlMs = 5 * 60 * 1000;
export const roomEntropyBatchSize = 32;
export const roomEntropyWordsPerDraw = 4;

export type PreparedRoomEntropy = EntropyBatch & { expiresAt: number };

export function reserveRoomEntropy(
	prepared: PreparedRoomEntropy | undefined,
	now: number,
): EntropyBatch | undefined {
	if (!prepared || prepared.expiresAt <= now || !prepared.seeds.length) return;
	return {
		seeds: prepared.seeds.splice(0, roomEntropyWordsPerDraw),
		source: prepared.source,
	};
}

function localWords(count: number) {
	return crypto.getRandomValues(new Uint16Array(count));
}

/** Uses only an already reserved batch or fresh Web Crypto. */
export function drawFromPreparedEntropy(max: number, reserved?: EntropyBatch) {
	const sampler = new RandomSampler(async (count) => {
		const batch = reserved ?? {
			seeds: Array.from(localWords(count)),
			source: "csprng",
		};
		reserved = undefined;
		return batch;
	}, roomEntropyWordsPerDraw);
	return drawNumbers({ min: 0, max, count: 1 }, sampler);
}

export async function drawFromSoloEntropy(
	max: number,
	reserved?: EntropyBatch,
) {
	if (!reserved) return drawFromPreparedEntropy(max);
	// The browser can inspect the prepared batch, so mix it with release-time
	// randomness before sampling a winner.
	const fresh = localWords(reserved.seeds.length);
	const result = await drawFromPreparedEntropy(max, {
		seeds: reserved.seeds.map((seed, index) => seed ^ fresh[index]),
		source: reserved.source,
	});
	return result.source === "csprng"
		? result
		: { ...result, source: "mixed" as const };
}
