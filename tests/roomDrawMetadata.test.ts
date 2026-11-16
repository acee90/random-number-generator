import { describe, expect, it } from "vitest";
import { getWheelRotation } from "../src/lib/lunch";
import {
	lunchRoomLimits,
	parseRoomSnapshot,
	type RoomDraw,
	type RoomSnapshot,
} from "../src/lib/lunchRoom";
import {
	exclusionRecordFor,
	hydrateRoomDrawMetadata,
	recordRoomDrawMetadata,
} from "../src/lib/roomDrawMetadata";

const epoch = 1_800_000_000_000;
const candidates = Array.from({ length: 24 }, (_, index) => ({
	id: `choice-${index + 1}`,
	name: `${index + 1}번`,
	category: "미분류",
}));
function draw(round: number): RoomDraw {
	const winnerIndex = (round - 1) % candidates.length;
	return {
		id: `draw-${round}`,
		candidates,
		winnerIndex,
		source: "csprng",
		timestamp: epoch + round * 10_000,
		startedAt: epoch + round * 10_000 + 1500,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: getWheelRotation(0, winnerIndex, candidates.length),
		listVersion: 1,
	};
}
function room(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return {
		roomId: "12345678-abcd-4abc-8abc-123456789012",
		title: "추첨 내역",
		createdAt: epoch,
		expiresAt: epoch + lunchRoomLimits.ttlMs,
		listVersion: 1,
		candidates,
		participants: [],
		messages: [],
		draw: null,
		history: [],
		status: "waiting",
		excludedIds: [],
		...overrides,
	};
}
function commit(snapshot: RoomSnapshot, next: RoomDraw, excludeDrawn: boolean) {
	if (snapshot.draw) {
		snapshot.history = [snapshot.draw, ...snapshot.history].slice(0, 20);
		snapshot.draw = null;
	}
	recordRoomDrawMetadata(snapshot, next, excludeDrawn);
	snapshot.draw = next;
	snapshot.status = "result";
	const winner = next.candidates[next.winnerIndex].id;
	snapshot.excludedIds = excludeDrawn
		? [...new Set([...(snapshot.excludedIds ?? []), winner])]
		: [winner];
}

describe("durable draw numbering and exclusion metadata", () => {
	it("keeps room round numbers across OFF replacement and manual ledger resets", () => {
		const snapshot = room();
		commit(snapshot, draw(1), true);
		commit(snapshot, draw(2), true);
		expect(
			snapshot.exclusionRecords?.map((entry) => entry.roundNumber),
		).toEqual([1, 2]);
		commit(snapshot, draw(3), false);
		expect(snapshot.drawCount).toBe(3);
		expect(snapshot.exclusionRecords).toEqual([
			exclusionRecordFor(snapshot.draw as RoomDraw),
		]);
		snapshot.excludedIds = [];
		snapshot.exclusionRecords = [];
		commit(snapshot, draw(4), true);
		expect(
			snapshot.exclusionRecords?.map((entry) => entry.roundNumber),
		).toEqual([4]);
		expect(snapshot.exclusionRecords?.[0].drawnAt).toBe(
			draw(4).startedAt + 7200,
		);
	});

	it("preserves metadata after more than twenty results and an independent rehydration", () => {
		const snapshot = room();
		for (let index = 1; index <= 22; index++)
			commit(snapshot, draw(index), true);
		expect(snapshot.history).toHaveLength(20);
		expect(snapshot.exclusionRecords).toHaveLength(22);
		expect(snapshot.exclusionRecords?.[0]).toMatchObject({
			drawId: "draw-1",
			roundNumber: 1,
		});
		const restored = parseRoomSnapshot(JSON.parse(JSON.stringify(snapshot)));
		expect(restored).not.toBeNull();
		hydrateRoomDrawMetadata(restored as RoomSnapshot);
		expect(restored?.drawCount).toBe(22);
		expect(restored?.exclusionRecords).toEqual(snapshot.exclusionRecords);
	});

	it("recovers exact old rounds when all history remains without inventing an exclusion", () => {
		const snapshot = room({
			history: [draw(2), draw(1)],
			draw: draw(3),
			status: "result",
			excludedIds: ["choice-1", "choice-3"],
		});
		hydrateRoomDrawMetadata(snapshot);
		expect(snapshot.drawCount).toBe(3);
		expect(snapshot.drawCountIsExact).toBe(true);
		expect(
			snapshot.exclusionRecords?.map((entry) => entry.roundNumber),
		).toEqual([1, 3]);
		expect(snapshot.excludedIds).toEqual(["choice-1", "choice-3"]);
	});

	it("marks truncated legacy numbering as record-relative and leaves unavailable dates unknown", () => {
		const snapshot = room({
			history: Array.from({ length: 20 }, (_, index) => draw(22 - index)),
			excludedIds: ["choice-1", "choice-3", "choice-22"],
		});
		hydrateRoomDrawMetadata(snapshot);
		expect(snapshot.drawCountIsExact).toBe(false);
		expect(snapshot.excludedIds).toContain("choice-1");
		expect(
			snapshot.exclusionRecords?.some(
				(entry) => entry.candidateId === "choice-1",
			),
		).toBe(false);
		commit(snapshot, draw(23), true);
		expect(snapshot.draw?.roundNumber).toBe(21);
		expect(snapshot.draw?.roundNumberIsExact).toBe(false);
	});
});

describe("round metadata protocol validation", () => {
	function withMetadata() {
		const snapshot = room();
		commit(snapshot, draw(1), true);
		return snapshot;
	}
	it("round trips metadata and preserves omission on legacy snapshots", () => {
		const snapshot = withMetadata();
		expect(parseRoomSnapshot(snapshot)?.exclusionRecords).toEqual(
			snapshot.exclusionRecords,
		);
		expect(parseRoomSnapshot(room())).not.toHaveProperty("drawCount");
		expect(parseRoomSnapshot(room())).not.toHaveProperty("exclusionRecords");
	});
	it.each([
		{ roundNumber: 0 },
		{ roundNumber: 1.5 },
		{ roundNumberIsExact: "yes" },
	])("rejects invalid round fields: %j", (override) => {
		const snapshot = withMetadata();
		snapshot.draw = { ...snapshot.draw, ...override } as RoomDraw;
		expect(parseRoomSnapshot(snapshot)).toBeNull();
	});
	it.each([
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1.5,
	])("rejects invalid exclusion times: %s", (drawnAt) => {
		const snapshot = withMetadata();
		(
			snapshot.exclusionRecords as NonNullable<RoomSnapshot["exclusionRecords"]>
		)[0].drawnAt = drawnAt;
		expect(parseRoomSnapshot(snapshot)).toBeNull();
	});
	it.each([
		-1,
		0,
		0.5,
		Number.MAX_SAFE_INTEGER + 1,
	])("rejects an invalid or contradictory counter: %s", (drawCount) => {
		expect(parseRoomSnapshot({ ...withMetadata(), drawCount })).toBeNull();
	});
	it("rejects duplicate or unrelated exclusion records", () => {
		const snapshot = withMetadata();
		const record = snapshot.exclusionRecords?.[0];
		expect(
			parseRoomSnapshot({ ...snapshot, exclusionRecords: [record, record] }),
		).toBeNull();
		expect(parseRoomSnapshot({ ...snapshot, excludedIds: [] })).toBeNull();
		expect(
			parseRoomSnapshot({
				...snapshot,
				drawCount: undefined,
				drawCountIsExact: true,
			}),
		).toBeNull();
	});
});
