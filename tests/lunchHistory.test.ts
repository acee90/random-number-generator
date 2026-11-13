import { afterEach, describe, expect, it, vi } from "vitest";
import { type LunchPlace, sampleLunchPlaces } from "../src/lib/lunch";
import {
	appendLunchHistory,
	type LunchHistoryRecord,
	lunchHistoryKey,
	lunchHistoryLimit,
	readLunchHistory,
	writeLunchHistory,
} from "../src/lib/lunchHistory";

const recordedTime = Date.UTC(2026, 10, 13, 3, 0);

function entry(
	id = "draw-1",
	timestamp = recordedTime,
	place: LunchPlace = sampleLunchPlaces[0],
): LunchHistoryRecord {
	return {
		id,
		place: { ...place },
		source: "quantum",
		candidateCount: 35,
		timestamp,
	};
}

function storageOf(value: unknown) {
	return { getItem: vi.fn(() => JSON.stringify(value)) };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("saved lunch history", () => {
	it("keeps original snapshots, creation time and source after a storage round trip", () => {
		const first = entry();
		const second = {
			...entry("draw-2", recordedTime + 1_000),
			source: "mixed" as const,
			candidateCount: 2,
		};
		const writer = { setItem: vi.fn() };
		expect(writeLunchHistory(writer, [first, second])).toBe(true);
		const [key, saved] = writer.setItem.mock.calls[0];
		expect(key).toBe(lunchHistoryKey);
		const restored = readLunchHistory({ getItem: () => saved });
		expect(restored).toEqual([second, first]);
		expect(restored[1]).not.toBe(first);
		expect(restored[1].place).not.toBe(first.place);
	});

	it("retains a custom place with optional menu and zero distance", () => {
		const custom: LunchPlace = {
			id: "custom-1",
			name: "직접 입력한 음식점",
			category: "한식",
			menu: "오늘의 메뉴",
			distanceMeters: 0,
		};
		expect(
			readLunchHistory(storageOf([entry("custom-draw", 0, custom)])),
		).toEqual([entry("custom-draw", 0, custom)]);
	});

	it("keeps a custom place without menu or distance rather than inventing them", () => {
		const custom: LunchPlace = {
			id: "custom",
			name: "내 목록",
			category: "분식",
		};
		expect(
			readLunchHistory(storageOf([entry("custom", 1, custom)]))[0].place,
		).toEqual(custom);
	});

	it.each([
		"quantum",
		"atmospheric",
		"csprng",
		"mixed",
	])("keeps the recorded %s source", (source) => {
		expect(
			readLunchHistory(storageOf([{ ...entry(), source }]))[0].source,
		).toBe(source);
	});

	it("salvages valid older entries when a newest entry has a malformed place", () => {
		const older = entry("older", 100);
		const invalid = { ...entry("bad-latest", 300), place: { name: "음식점" } };
		const middle = entry("middle", 200);
		expect(readLunchHistory(storageOf([older, invalid, middle]))).toEqual([
			middle,
			older,
		]);
	});

	it("sorts and caps stored history at the newest twenty distinct draws", () => {
		const old = Array.from({ length: 25 }, (_, index) =>
			entry(`draw-${index}`, index),
		);
		const records = readLunchHistory(storageOf(old));
		expect(records).toHaveLength(lunchHistoryLimit);
		expect(records[0].id).toBe("draw-24");
		expect(records.at(-1)?.id).toBe("draw-5");
		expect(old[0].id).toBe("draw-0");
	});

	it("ignores duplicate storage ids without sacrificing unique history capacity", () => {
		const old = Array.from({ length: 25 }, (_, index) =>
			entry(`draw-${index}`, index),
		);
		const duplicate = entry("draw-24", 26);
		const records = readLunchHistory(storageOf([duplicate, ...old]));
		expect(records).toHaveLength(20);
		expect(new Set(records.map((record) => record.id)).size).toBe(20);
		expect(records[0]).toEqual(duplicate);
		expect(records.at(-1)?.id).toBe("draw-5");
	});

	it.each([
		null,
		{},
		"not an array",
		5,
	])("recovers a non-array storage value: %s", (value) => {
		expect(readLunchHistory(storageOf(value))).toEqual([]);
	});

	it("recovers absent, malformed JSON and unavailable reads", () => {
		expect(readLunchHistory({ getItem: () => null })).toEqual([]);
		expect(readLunchHistory({ getItem: () => "{" })).toEqual([]);
		expect(
			readLunchHistory({
				getItem: () => {
					throw new Error("Storage blocked");
				},
			}),
		).toEqual([]);
	});

	it("recovers SSR without a storage global and reads the browser default when available", () => {
		vi.stubGlobal("localStorage", undefined);
		expect(readLunchHistory()).toEqual([]);
		expect(writeLunchHistory(undefined, [entry()])).toBe(false);
		const defaultStorage = { ...storageOf([entry()]), setItem: vi.fn() };
		vi.stubGlobal("localStorage", defaultStorage);
		expect(readLunchHistory()).toEqual([entry()]);
		expect(writeLunchHistory(undefined, [entry()])).toBe(true);
		expect(defaultStorage.setItem).toHaveBeenCalledWith(
			lunchHistoryKey,
			JSON.stringify([entry()]),
		);
	});

	it("returns false on a failed write while preserving the draw object", () => {
		const draw = entry();
		expect(
			writeLunchHistory(
				{
					setItem: () => {
						throw new Error("Storage quota exceeded");
					},
				},
				[draw],
			),
		).toBe(false);
		expect(draw).toEqual(entry());
	});

	it("handles browsers that deny access to the storage property itself", () => {
		const descriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"localStorage",
		);
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get: () => {
				throw new Error("Storage access denied");
			},
		});
		try {
			expect(readLunchHistory()).toEqual([]);
			expect(writeLunchHistory(undefined, [entry()])).toBe(false);
		} finally {
			if (descriptor)
				Object.defineProperty(globalThis, "localStorage", descriptor);
			else Reflect.deleteProperty(globalThis, "localStorage");
		}
	});

	it.each([
		null,
		[],
		{ ...entry(), id: "" },
		{ ...entry(), id: " \t " },
		{ ...entry(), id: "x".repeat(201) },
		{ ...entry(), timestamp: -1 },
		{ ...entry(), timestamp: 1.5 },
		{ ...entry(), timestamp: 8_640_000_000_000_001 },
		{ ...entry(), timestamp: "100" },
		{ ...entry(), candidateCount: 1 },
		{ ...entry(), candidateCount: 2.5 },
		{ ...entry(), candidateCount: Number.MAX_SAFE_INTEGER + 1 },
		{ ...entry(), candidateCount: "35" },
		{ ...entry(), source: "unverified" },
		{ ...entry(), place: null },
		{ ...entry(), place: { ...entry().place, id: "" } },
		{ ...entry(), place: { ...entry().place, name: " " } },
		{ ...entry(), place: { ...entry().place, name: "x".repeat(201) } },
		{ ...entry(), place: { ...entry().place, category: "架空分類" } },
		{ ...entry(), place: { ...entry().place, menu: "" } },
		{ ...entry(), place: { ...entry().place, menu: "x".repeat(201) } },
		{ ...entry(), place: { ...entry().place, distanceMeters: -1 } },
		{ ...entry(), place: { ...entry().place, distanceMeters: 1.5 } },
		{ ...entry(), place: { ...entry().place, distanceMeters: "67" } },
	])("drops an invalid row while retaining a valid neighbor: %j", (invalid) => {
		expect(readLunchHistory(storageOf([invalid, entry("valid")]))).toEqual([
			entry("valid"),
		]);
	});
});

describe("appending lunch history", () => {
	it("inserts by original creation time and caps without mutating the previous state", () => {
		const history = Array.from({ length: 20 }, (_, index) =>
			entry(`old-${index}`, index),
		);
		const next = appendLunchHistory(history, entry("newest", 30));
		expect(next).toHaveLength(20);
		expect(next[0].id).toBe("newest");
		expect(next.at(-1)?.id).toBe("old-1");
		expect(history).toHaveLength(20);
		expect(history[0].id).toBe("old-0");
		expect(appendLunchHistory(next, entry("late-older", 5))[0].id).toBe(
			"newest",
		);
	});

	it("treats a repeated completion id as the same draw, preserving its original snapshot", () => {
		const original = entry();
		const history = appendLunchHistory([], original);
		const repeated = {
			...entry(original.id, recordedTime + 5_000, sampleLunchPlaces[1]),
			source: "csprng" as const,
		};
		expect(appendLunchHistory(history, repeated)).toEqual([original]);
	});

	it("does not let later candidate or history mutations change saved snapshots", () => {
		const original = entry();
		const result = appendLunchHistory([], original);
		original.place.name = "changed after draw";
		expect(result[0].place.name).toBe(sampleLunchPlaces[0].name);
		const next = appendLunchHistory(
			result,
			entry("second", recordedTime + 1_000),
		);
		result[0].place.name = "changed previous history";
		expect(next[1].place.name).toBe(sampleLunchPlaces[0].name);
	});

	it("keeps valid history when an invalid new record is supplied", () => {
		expect(
			appendLunchHistory([entry("valid")], { ...entry(), candidateCount: 0 }),
		).toEqual([entry("valid")]);
	});
});
