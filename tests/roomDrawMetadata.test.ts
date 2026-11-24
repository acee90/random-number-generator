import { describe, expect, it } from "vitest";
import { getWheelRotation } from "../src/lib/lunch";
import {
	lunchRoomLimits,
	parseRoomSnapshot,
	type RoomDraw,
	type RoomSnapshot,
} from "../src/lib/lunchRoom";
import {
	clearDisabledRoomExclusions,
	exclusionRecordFor,
	hydrateRoomDrawMetadata,
	recordRoomDrawMetadata,
	setRoomExcludeDrawn,
	visibleRoomExclusions,
} from "../src/lib/roomDrawMetadata";

import {
	advanceRoomRound,
	applyRoomCommand,
	beginRoomDraw,
	type LifecycleCommand,
	prepareRoomDraw,
	startRoomSpin,
} from "../src/lib/roomGame";
import { getRoomHistoryTimeline, getRoomWins } from "../src/lib/roomWinHistory";

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
		excludeDrawn: true,
		...overrides,
	};
}
function commit(snapshot: RoomSnapshot, next: RoomDraw, excludeDrawn: boolean) {
	if (snapshot.draw) {
		snapshot.history = [snapshot.draw, ...snapshot.history].slice(0, 20);
		snapshot.draw = null;
	}
	snapshot.excludeDrawn = excludeDrawn;
	recordRoomDrawMetadata(snapshot, next, excludeDrawn);
	snapshot.draw = next;
	snapshot.status = "result";
}

describe("durable draw numbering and exclusion metadata", () => {
	it("keeps room round numbers across OFF draws and manual ledger resets", () => {
		const snapshot = room();
		commit(snapshot, draw(1), true);
		commit(snapshot, draw(2), true);
		expect(
			snapshot.exclusionRecords?.map((entry) => entry.roundNumber),
		).toEqual([1, 2]);
		commit(snapshot, draw(3), false);
		expect(snapshot.drawCount).toBe(3);
		expect(snapshot.exclusionRecords).toEqual([]);
		expect(snapshot.excludedIds).toEqual([]);
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

	it("clears legacy OFF exclusions on hydration without losing round counts or history", () => {
		const first = { ...draw(1), roundNumber: 1 };
		const snapshot = room({
			excludeDrawn: false,
			drawCount: 1,
			history: [first],
			excludedIds: [candidates[0].id],
			exclusionRecords: [exclusionRecordFor(first)],
		});
		const history = structuredClone(snapshot.history);
		hydrateRoomDrawMetadata(snapshot);
		expect(snapshot.excludedIds).toEqual([]);
		expect(snapshot.exclusionRecords).toEqual([]);
		expect(snapshot.drawCount).toBe(1);
		expect(snapshot.history).toEqual(history);
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

describe("result-time exclusion options", () => {
	it("adds the current winner once when enabled after a reset and preserves draw/history metadata", () => {
		const current = { ...draw(2), roundNumber: 2, excludeDrawn: false };
		const previous = { ...draw(1), roundNumber: 1 };
		const snapshot = room({
			status: "result",
			draw: current,
			history: [previous],
			drawCount: 2,
			excludedIds: [candidates[0].id],
			exclusionRecords: [exclusionRecordFor(previous)],
		});
		const original = structuredClone({
			draw: snapshot.draw,
			history: snapshot.history,
		});
		setRoomExcludeDrawn(snapshot, true);
		setRoomExcludeDrawn(snapshot, true);
		expect(snapshot.excludedIds).toEqual([candidates[0].id, candidates[1].id]);
		expect(snapshot.exclusionRecords).toEqual([
			exclusionRecordFor(previous),
			exclusionRecordFor(current),
		]);
		expect({ draw: snapshot.draw, history: snapshot.history }).toEqual(
			original,
		);
		expect(snapshot.drawCount).toBe(2);
		setRoomExcludeDrawn(snapshot, false);
		expect(snapshot.excludedIds).toEqual([candidates[0].id, candidates[1].id]);
		const records = structuredClone(snapshot.exclusionRecords);
		hydrateRoomDrawMetadata(snapshot);
		expect(snapshot.exclusionRecords).toEqual(records);
		setRoomExcludeDrawn(snapshot, true);
		expect(snapshot.excludedIds).toEqual([candidates[0].id, candidates[1].id]);
		expect({ draw: snapshot.draw, history: snapshot.history }).toEqual(
			original,
		);
		setRoomExcludeDrawn(snapshot, false);
		snapshot.draw = null;
		clearDisabledRoomExclusions(snapshot);
		expect(snapshot.excludedIds).toEqual([]);
		expect(snapshot.exclusionRecords).toEqual([]);
	});
	it("does not restore past winners in waiting or candidates removed from the current list", () => {
		const snapshot = room({ history: [draw(1)] });
		setRoomExcludeDrawn(snapshot, true);
		expect(snapshot.excludedIds).toEqual([]);
		snapshot.status = "result";
		snapshot.draw = draw(1);
		snapshot.candidates = candidates.slice(1);
		setRoomExcludeDrawn(snapshot, true);
		expect(snapshot.excludedIds).toEqual([]);
	});
	it("publishes only prior exclusions while the next winner is still spinning", () => {
		const current = {
			...draw(2),
			excludeDrawn: true,
			excludedIdsBefore: [candidates[0].id],
		};
		const snapshot = room({
			status: "drawing",
			draw: current,
			excludedIds: [candidates[0].id, candidates[1].id],
			exclusionRecords: [
				exclusionRecordFor(draw(1)),
				exclusionRecordFor(current),
			],
		});
		expect(visibleRoomExclusions(snapshot)).toEqual({
			excludedIds: [candidates[0].id],
			exclusionRecords: [exclusionRecordFor(draw(1))],
		});
		snapshot.status = "result";
		expect(visibleRoomExclusions(snapshot).excludedIds).toEqual([
			candidates[0].id,
			candidates[1].id,
		]);
	});
});

describe("room winner history", () => {
	const host = { id: "host", isHost: true, name: "방장" };
	function play(snapshot: RoomSnapshot, id: string) {
		const prepared = prepareRoomDraw(snapshot, [host]);
		beginRoomDraw(snapshot);
		startRoomSpin(
			snapshot,
			prepared,
			{ numbers: [0], source: "csprng" },
			id,
			0,
		);
		const draw = snapshot.draw as RoomDraw;
		snapshot.status = "result";
		return draw;
	}
	function command(snapshot: RoomSnapshot, msg: LifecycleCommand) {
		applyRoomCommand(snapshot, msg, host, host.id);
	}
	const wins = (snapshot: RoomSnapshot, current = true) =>
		getRoomWins(snapshot, Number.MAX_SAFE_INTEGER, true, current);
	it("retains saved candidate edits between draws and merges solo records by time without duplicating a win", () => {
		const snapshot = room({
			candidates: candidates.slice(0, 2),
			excludeDrawn: false,
		});
		const first = play(snapshot, "first");
		advanceRoomRound(snapshot, true);
		const edit = (places: RoomSnapshot["candidates"]) =>
			command(snapshot, {
				type: "room-edit",
				id: "edit",
				baseListVersion: snapshot.listVersion,
				candidates: places,
			});
		edit([candidates[0], candidates[2]]);
		edit([{ ...candidates[0], name: "새 이름" }, candidates[2]]);
		edit([...snapshot.candidates].reverse());
		expect(snapshot.candidateChanges?.map((change) => change.summary)).toEqual([
			"2번 → 3번",
			"1번 → 새 이름",
		]);
		const restored = parseRoomSnapshot(snapshot);
		expect(restored?.candidateChanges).toEqual(snapshot.candidateChanges);
		const legacy = {
			id: "legacy",
			place: candidates[1],
			timestamp: first.timestamp - 1,
			source: "csprng" as const,
			candidateCount: 2,
		};
		const timeline = getRoomHistoryTimeline(
			restored,
			Number.MAX_SAFE_INTEGER,
			false,
			[first],
			[legacy],
		);
		expect(
			timeline.map((entry) =>
				entry.kind === "change" ? entry.summary : entry.id,
			),
		).toEqual(["1번 → 새 이름", "2번 → 3번", "first", "legacy"]);
		expect(
			parseRoomSnapshot({
				...snapshot,
				candidateChanges: [
					snapshot.candidateChanges?.[0],
					snapshot.candidateChanges?.[0],
				],
			}),
		).toBeNull();
	});
	it("uses an un-timed boundary for legacy pool versions without guessing from a no-repeat draw", () => {
		const old = { ...draw(1), candidateSetVersion: 1, excludeDrawn: true };
		const next = { ...draw(2), candidateSetVersion: 2, excludeDrawn: true };
		const state = room({ candidateSetVersion: 2, history: [next, old] });
		const events = getRoomHistoryTimeline(
			state,
			Number.MAX_SAFE_INTEGER,
			false,
		);
		expect(events.map((event) => event.kind)).toEqual([
			"draw",
			"change",
			"draw",
		]);
		expect(events[1]).toMatchObject({ summary: "", exactTime: false });
	});
	it("interleaves imported solo draws and reports an observed menu replacement even if menu IDs were regenerated", () => {
		const imported = (index: number, menu: string) => ({
			...draw(index),
			excludeDrawn: false,
			candidates: [
				{ id: `a-${index}`, name: "김밥", category: "점심" },
				{ id: `b-${index}`, name: menu, category: "점심" },
			],
			winnerIndex: 0,
		});
		const events = getRoomHistoryTimeline(
			null,
			Number.MAX_SAFE_INTEGER,
			false,
			[imported(1, "쌀국수"), imported(2, "쌀국수"), imported(3, "된장찌개")],
		);
		expect(
			events.map((event) =>
				event.kind === "change" ? event.summary : event.id,
			),
		).toEqual(["draw-3", "쌀국수 → 된장찌개", "draw-2", "draw-1"]);
	});
	it("starts a fresh history on actual manual pool changes, including a change back to an earlier pool", () => {
		const snapshot = room({
			candidates: candidates.slice(0, 2),
			excludeDrawn: false,
		});
		const first = play(snapshot, "first");
		const end = first.startedAt + first.durationMs;
		expect(getRoomWins(snapshot, end - 1, true, false).recent).toEqual([]);
		expect(
			getRoomWins({ ...snapshot, history: [first] }, end, true, true).recent,
		).toEqual([first]);
		advanceRoomRound(snapshot, true);
		const filter = (excludedIds: string[]) =>
			command(snapshot, {
				type: "game-filter",
				id: "filter",
				expectedRevision: snapshot.revision ?? 1,
				filter: { categories: null, excludedIds },
			});
		filter([]);
		command(snapshot, {
			type: "room-edit",
			id: "edit",
			baseListVersion: snapshot.listVersion,
			candidates: [...snapshot.candidates].reverse(),
		});
		command(snapshot, {
			type: "draw-view",
			id: "view",
			viewMode: "wheel",
			expectedRevision: snapshot.revision ?? 1,
		});
		command(snapshot, {
			type: "options",
			id: "option",
			excludeDrawn: true,
			expectedRevision: snapshot.revision ?? 1,
		});
		expect(wins(snapshot).recent).toEqual([first]);
		filter([candidates[0].id]);
		expect(wins(snapshot).recent).toEqual([]);
		const second = play(snapshot, "second");
		advanceRoomRound(snapshot, true);
		command(snapshot, {
			type: "reset-exclusions",
			id: "reset",
			expectedRevision: snapshot.revision ?? 1,
		});
		expect(wins(snapshot).recent).toEqual([second]);
		filter([]);
		expect(wins(snapshot).recent).toEqual([]);
		expect(wins(snapshot, false).recent).toEqual([second, first]);
		const third = play(snapshot, "third");
		advanceRoomRound(snapshot, true);
		command(snapshot, {
			type: "room-edit",
			id: "rename",
			baseListVersion: snapshot.listVersion,
			candidates: snapshot.candidates.map((entry) => ({
				...entry,
				name: `${entry.name} 수정`,
			})),
		});
		const restored = parseRoomSnapshot(snapshot);
		expect(restored).toBeTruthy();
		expect(wins(restored as RoomSnapshot).recent).toEqual([]);
		expect(
			wins(restored as RoomSnapshot, false).recent.map((draw) => draw.id),
		).toEqual([third.id, second.id, first.id]);
	});
	it("separates retained legacy rounds when the same list was filtered and then restored", () => {
		const old = room({
			excludeDrawn: false,
			candidates: candidates.slice(0, 2),
		});
		const all = { categories: null, excludedIds: [] };
		const filtered = { categories: null, excludedIds: [candidates[1].id] };
		old.gameFilter = all;
		old.history = [3, 2, 1].map((round) => ({
			...draw(1),
			id: `draw-${round}`,
			gameFilter: round === 2 ? filtered : all,
		}));
		const restored = parseRoomSnapshot(old);
		expect(restored).toBeTruthy();
		expect(
			wins(restored as RoomSnapshot).recent.map((entry) => entry.id),
		).toEqual(["draw-3"]);
		expect(wins(restored as RoomSnapshot, false).recent).toHaveLength(3);
		expect(parseRoomSnapshot(restored)).toEqual(restored);
	});
	it("keeps repeated wins beyond twenty with their original names after a replacement and reload", () => {
		const snapshot = room({ candidates: [candidates[0]], excludeDrawn: false });
		for (let round = 1; round <= 23; round++) {
			play(snapshot, `win-${round}`);
			advanceRoomRound(snapshot, false);
		}
		expect(wins(snapshot).recent).toHaveLength(20);
		expect(wins(snapshot).older.map((win) => win.id)).toEqual([
			"win-3",
			"win-2",
			"win-1",
		]);
		const winner = snapshot.candidates[0].name;
		command(snapshot, {
			type: "room-edit",
			id: "replace",
			baseListVersion: snapshot.listVersion,
			candidates: [candidates[1]],
		});
		const current = play(snapshot, "new-pool");
		const restored = parseRoomSnapshot(
			JSON.parse(JSON.stringify(snapshot)),
		) as RoomSnapshot;
		expect(wins(restored).recent.map((draw) => draw.id)).toEqual([current.id]);
		expect(wins(restored).older).toEqual([]);
		const all = wins(restored, false);
		expect(all.recent).toHaveLength(20);
		expect(all.older.map((win) => [win.id, win.name])).toEqual(
			["win-4", "win-3", "win-2", "win-1"].map((id) => [id, winner]),
		);
		expect(restored.olderWins?.[0]).not.toHaveProperty("candidates");
		expect(
			parseRoomSnapshot({
				...restored,
				olderWins: [{ ...all.older[0], candidateSetVersion: 0 }],
			}),
		).toBeNull();
	});
});
