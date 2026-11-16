import { describe, expect, it } from "vitest";
import type {
	RoomDraw,
	RoomExclusionRecord,
	RoomSnapshot,
} from "../src/lib/lunchRoom";
import {
	getRoomExclusionHistory,
	roomExclusionRoundLabel,
} from "../src/lib/roomExclusionHistory";

const candidates = [
	{ id: "a", name: "비빔밥", category: "한식" },
	{ id: "b", name: "우동", category: "일식" },
	{ id: "c", name: "샐러드", category: "샐러드" },
];
function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return {
		roomId: "41611852-dbae-4543-9179-bd428bfcd098",
		title: "제외 내역 검증",
		createdAt: 0,
		expiresAt: 86400000,
		listVersion: 1,
		candidates,
		participants: [],
		messages: [],
		draw: null,
		history: [],
		status: "waiting",
		excludeDrawn: true,
		excludedIds: ["a", "b", "c"],
		...overrides,
	};
}
function record(candidateId: string, roundNumber: number): RoomExclusionRecord {
	return {
		candidateId,
		drawId: `draw-${roundNumber}`,
		roundNumber,
		drawnAt: roundNumber * 20000,
	};
}
function draw(candidateId: string, roundNumber?: number): RoomDraw {
	return {
		id: `draw-${candidateId}`,
		candidates,
		winnerIndex: candidates.findIndex((entry) => entry.id === candidateId),
		source: "csprng",
		timestamp: 1000,
		startedAt: 2000,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: 1440,
		listVersion: 1,
		...(roundNumber === undefined ? {} : { roundNumber }),
	};
}

describe("automatic draw exclusion history", () => {
	it("sorts a complete ledger by draw time rather than candidate source order", () => {
		const state = snapshot({
			exclusionRecords: [record("a", 1), record("b", 3), record("c", 2)],
		});
		const before = structuredClone(state);
		const rows = getRoomExclusionHistory(state);
		expect(rows.map((entry) => entry.candidate.id)).toEqual(["b", "c", "a"]);
		expect(rows.map((entry) => roomExclusionRoundLabel(entry.record))).toEqual([
			"3회 추첨",
			"2회 추첨",
			"1회 추첨",
		]);
		expect(state).toEqual(before);
	});

	it("preserves legacy exclusions beyond retained history without inventing old timestamps", () => {
		const state = snapshot({
			excludedIds: ["a", "b"],
			exclusionRecords: [record("b", 31), record("c", 32)],
			gameFilter: { categories: null, excludedIds: ["c"] },
		});
		const rows = getRoomExclusionHistory(state);
		expect(rows.map((entry) => entry.candidate.id)).toEqual(["b", "a"]);
		expect(rows[1].record).toBeUndefined();
		expect(roomExclusionRoundLabel(rows[1].record)).toBe("이전 추첨");
		expect(rows.some((entry) => entry.candidate.id === "c")).toBe(false);
	});

	it("recovers reveal times from retained history and omits an unfinished current draw", () => {
		const state = snapshot({
			excludedIds: ["a", "b"],
			status: "result",
			draw: draw("b", 2),
			history: [draw("a", 1)],
		});
		const rows = getRoomExclusionHistory(state);
		expect(rows.every((entry) => entry.record?.drawnAt === 9200)).toBe(true);
		expect(rows.map((entry) => entry.record?.roundNumber)).toEqual([2, 1]);
		const unfinished = getRoomExclusionHistory({
			...state,
			status: "drawing",
		});
		expect(
			unfinished.find((entry) => entry.candidate.id === "b")?.record,
		).toBeUndefined();
		expect(
			unfinished.find((entry) => entry.candidate.id === "a")?.record?.drawnAt,
		).toBe(9200);
	});

	it("keeps the stored ledger while repeat exclusion is off and deduplicates IDs", () => {
		const rows = getRoomExclusionHistory(
			snapshot({
				excludeDrawn: false,
				excludedIds: ["a", "a", "b", "deleted"],
				exclusionRecords: [record("a", 1), record("a", 2), record("b", 3)],
			}),
		);
		expect(rows.map((entry) => entry.candidate.id)).toEqual(["b", "a"]);
		expect(rows[1].record?.roundNumber).toBe(2);
	});

	it("distinguishes reconstructed numbers and rejects unusable dates for display", () => {
		const partial = { ...record("a", 22), roundNumberIsExact: false };
		expect(roomExclusionRoundLabel(partial)).toBe("기록 22번째");
		const rows = getRoomExclusionHistory(
			snapshot({
				excludedIds: ["a"],
				exclusionRecords: [{ ...partial, drawnAt: Number.MAX_SAFE_INTEGER }],
			}),
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].record).toBeUndefined();
		expect(getRoomExclusionHistory(null)).toEqual([]);
	});
});
