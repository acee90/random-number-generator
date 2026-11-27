// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import {
	afterEach,
	assert,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { useSoloLunch } from "../src/hooks/useSoloLunch";
import { lunchSpinDurationMs } from "../src/lib/lunch";
import { getEligibleRoomCandidates } from "../src/lib/lunchRoom";
import { createSoloRoom, readSoloRoom } from "../src/lib/soloRoom";
import { getDefaultSpinTuning, getSpinDeadline } from "../src/lib/spinDrive";
import { drawFromSoloEntropy } from "../src/services/roomEntropy";
import { prepareSoloRoomEntropy } from "../src/services/roomEntropyApi";

vi.mock("../src/services/roomEntropy", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/services/roomEntropy")>()),
	drawFromSoloEntropy: vi.fn(),
}));
vi.mock("../src/services/roomEntropyApi", () => ({
	prepareSoloRoomEntropy: vi.fn(),
}));
const places = [
	{ id: "a", name: "국밥", category: "한식" },
	{ id: "b", name: "우동", category: "일식" },
];
beforeEach(() => {
	sessionStorage.clear();
	localStorage.clear();
	vi.useFakeTimers();
	vi.mocked(prepareSoloRoomEntropy).mockReset().mockResolvedValue(null);
	vi.mocked(drawFromSoloEntropy)
		.mockReset()
		.mockResolvedValue({ numbers: [0], source: "csprng" });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function setup() {
	const initial = createSoloRoom({
		title: "내 점심방",
		hostName: "하나",
		candidates: places,
		candidateIds: [],
		startInWaiting: true,
	});
	return renderHook(() => useSoloLunch(initial));
}
async function spin(result: ReturnType<typeof setup>["result"]) {
	await act(async () => {
		expect(result.current.room.startDraw()).toBe(true);
	});
	await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
}
describe("local game controller", () => {
	it("keeps the tap boost from inputs received before the draw becomes available", async () => {
		const { result } = setup();
		const drawId = "solo-fast-drive";
		vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(
			(array) => {
				(array as Uint32Array)[0] = 1;
				return array;
			},
		);
		await act(async () => {
			expect(
				result.current.room.startDraw({ driveId: drawId, driveStartIndex: 1 }),
			).toBe(true);
			result.current.room.setDriveHeld(drawId, false, 1);
			result.current.room.setDriveHeld(drawId, true, 2);
			result.current.room.setDriveHeld(drawId, false, 1);
		});
		expect(result.current.room.snapshot.draw).toMatchObject({
			id: drawId,
			winnerIndex: 1,
			drive: {
				held: true,
				sequence: 2,
				regripSequence: 2,
				position: 1,
				speed: 27,
			},
		});
		await act(async () => vi.advanceTimersByTime(20_000));
		expect(result.current.room.vote(drawId, "up")).toBe(false);
		act(() => result.current.room.setDriveHeld(drawId, false, 3));
		const draw = result.current.room.snapshot.draw;
		assert(draw);
		expect(draw.drive?.held).toBe(false);
		await act(async () =>
			vi.advanceTimersByTime(getSpinDeadline(draw) - Date.now()),
		);
		expect(result.current.room.snapshot.status).toBe("result");
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
	});

	it("coasts and keeps the locked winner when restored from a solo hold", async () => {
		const view = setup();
		const drawId = "solo-restore-drive";
		const tuning = getDefaultSpinTuning("slot-v1");
		await act(async () => {
			await view.result.current.room.updateRoomOptions(true);
			expect(view.result.current.room.startDraw({ driveId: drawId })).toBe(
				true,
			);
		});
		await act(async () => vi.advanceTimersByTime(1200));
		expect(view.result.current.room.snapshot.draw?.drive?.held).toBe(true);
		const { roomId } = view.result.current.room.snapshot;
		view.unmount();
		const saved = readSoloRoom(roomId);
		assert(saved);
		expect(saved.snapshot.draw?.drive).toMatchObject({
			held: true,
			speed: tuning.initialSpeed,
			tuning,
		});
		const resumed = renderHook(() => useSoloLunch(saved.snapshot));
		const draw = resumed.result.current.room.snapshot.draw;
		assert(draw);
		expect(draw).toMatchObject({
			id: drawId,
			winnerIndex: 0,
			drive: { held: false, sequence: 1, tuning },
		});
		const deadline = getSpinDeadline(draw);
		await act(async () => vi.advanceTimersByTime(deadline - Date.now()));
		expect(readSoloRoom(roomId)?.snapshot).toMatchObject({
			status: "result",
			exclusionRecords: [{ drawId, drawnAt: deadline }],
		});
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
	});

	it("draws and redraws while preparation is pending, then reserves different batches", async () => {
		const sample = await vi.importActual<
			typeof import("../src/services/roomEntropy")
		>("../src/services/roomEntropy");
		const draw = vi.mocked(drawFromSoloEntropy);
		draw.mockImplementation(sample.drawFromSoloEntropy);
		let finishPreparation!: () => void;
		const prepare = vi.mocked(prepareSoloRoomEntropy).mockReturnValueOnce(
			new Promise((resolve) => {
				finishPreparation = () =>
					resolve({
						seeds: Array.from({ length: 32 }, (_, index) => index),
						source: "atmospheric",
					});
			}),
		);
		const { result } = setup();
		async function redraw() {
			const previous = result.current.room.snapshot.draw;
			assert(previous);
			await act(async () => {
				expect(
					result.current.room.startDraw({ previousDrawId: previous.id }),
				).toBe(true);
			});
			await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		}
		await spin(result);
		expect(result.current.room.snapshot.draw?.source).toBe("csprng");
		await redraw();
		expect(result.current.room.snapshot.draw?.source).toBe("csprng");
		await act(async () => finishPreparation());
		await redraw();
		expect(result.current.room.snapshot.draw?.source).toBe("mixed");
		expect(draw).toHaveBeenLastCalledWith(1, {
			seeds: [0, 1, 2, 3],
			source: "atmospheric",
		});
		await redraw();
		expect(result.current.room.snapshot.draw?.source).toBe("mixed");
		expect(draw).toHaveBeenLastCalledWith(1, {
			seeds: [4, 5, 6, 7],
			source: "atmospheric",
		});
		expect(prepare).toHaveBeenCalledExactlyOnceWith();
	});

	it("discards an old solo screen's late preparation", async () => {
		let finishPreparation!: () => void;
		vi.mocked(prepareSoloRoomEntropy).mockReturnValueOnce(
			new Promise((resolve) => {
				finishPreparation = () =>
					resolve({ seeds: Array(32).fill(5), source: "quantum" });
			}),
		);
		const original = setup();
		original.unmount();
		const next = setup();
		await act(async () => finishPreparation());
		await spin(next.result);
		expect(drawFromSoloEntropy).toHaveBeenCalledExactlyOnceWith(1, undefined);
	});

	it("persists the chosen result view and preserves the original slot winner and ballot in the archive", async () => {
		const { result } = setup();
		expect(result.current.room.snapshot.viewMode).toBe("slot-v1");
		await spin(result);
		const { roomId, draw } = result.current.room.snapshot;
		assert(draw);
		expect(draw.viewMode).toBe("slot-v1");
		act(() => {
			expect(result.current.room.vote(draw.id, "up")).toBe(true);
		});
		const voted = readSoloRoom(roomId)?.snapshot.draw;
		await act(async () => {
			expect(await result.current.room.updateDrawView("wheel")).toBe(true);
		});
		expect(readSoloRoom(roomId)?.snapshot.draw).toEqual(voted);
		act(() => {
			expect(result.current.room.nextRound(draw.id)).toBe(true);
		});
		expect(readSoloRoom(roomId)?.snapshot).toMatchObject({
			viewMode: "wheel",
			draw: null,
			history: [
				{
					id: draw.id,
					viewMode: "slot-v1",
					winnerIndex: 0,
					votes: [{ vote: "up" }],
				},
			],
		});
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
	});

	it("excludes winners on subsequent games and supports the last remaining candidate", async () => {
		const { result } = setup();
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
		});
		await spin(result);
		const first = result.current.room.snapshot.draw;
		assert(first);
		expect(first.candidates).toHaveLength(2);
		act(() => {
			expect(result.current.room.nextRound(first.id)).toBe(true);
		});
		expect(
			getEligibleRoomCandidates(result.current.room.snapshot).map((x) => x.id),
		).toEqual(["b"]);
		await spin(result);
		expect(result.current.room.snapshot.draw?.candidates).toHaveLength(1);
		expect(result.current.room.snapshot.draw?.roundNumber).toBe(2);
		expect(result.current.room.snapshot.excludedIds).toEqual(["a", "b"]);
		const second = result.current.room.snapshot.draw;
		assert(second);
		await act(async () => {
			await result.current.room.updateRoomOptions(false);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual(["a", "b"]);
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual(["a", "b"]);
		await act(async () => {
			await result.current.room.updateRoomOptions(false);
		});
		act(() => {
			result.current.room.nextRound(second.id);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		expect(result.current.room.snapshot.exclusionRecords).toEqual([]);
	});
	it("keeps two consecutive OFF games empty without reset confirmation and supports enabling the current result", async () => {
		const { result } = setup();
		await spin(result);
		const first = structuredClone(result.current.room.snapshot.draw);
		assert(first);
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		expect(result.current.room.snapshot.exclusionRecords).toEqual([]);
		act(() => {
			expect(result.current.room.nextRound(first.id)).toBe(true);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		await spin(result);
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(2);
		const second = structuredClone(result.current.room.snapshot.draw);
		assert(second);
		expect(second.candidates).toHaveLength(2);
		expect(second.roundNumber).toBe(2);
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		expect(result.current.room.snapshot.exclusionRecords).toEqual([]);
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([
			second.candidates[second.winnerIndex].id,
		]);
		await act(async () => {
			await result.current.room.updateRoomOptions(false);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([
			second.candidates[second.winnerIndex].id,
		]);
		expect(result.current.room.snapshot.exclusionRecords).toHaveLength(1);
		expect(result.current.room.snapshot.draw).toEqual(second);
		expect(
			result.current.room.snapshot.history.find((x) => x.id === first.id),
		).toEqual(first);
		act(() => {
			expect(result.current.room.nextRound(second.id)).toBe(true);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		expect(result.current.room.snapshot.exclusionRecords).toEqual([]);
	});

	it("resets only automatic exclusions and keeps manual filters and history", async () => {
		const { result } = setup();
		await spin(result);
		const record = structuredClone(result.current.room.snapshot.draw);
		assert(record);
		act(() => {
			result.current.room.nextRound(record.id);
		});
		await act(async () => {
			await result.current.room.enterEditing();
		});
		await act(async () => {
			await result.current.room.updateGameFilter({
				categories: ["일식"],
				excludedIds: ["a"],
			});
		});
		await act(async () => {
			await result.current.room.resetExclusions();
		});
		expect(result.current.room.snapshot.history[0]).toEqual(record);
		expect(result.current.room.snapshot.gameFilter).toEqual({
			categories: ["일식"],
			excludedIds: ["a"],
		});
		expect(result.current.room.snapshot.exclusionRecords).toEqual([]);
	});
	it("preserves stable IDs and previous result snapshots when editing names", async () => {
		const { result } = setup();
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
		});
		await spin(result);
		const record = structuredClone(result.current.room.snapshot.draw);
		assert(record);
		act(() => {
			result.current.room.nextRound(record.id);
		});
		await act(async () => {
			await result.current.room.enterEditing();
		});
		await act(async () => {
			expect(
				await result.current.room.editRoom({
					baseVersion: 1,
					candidates: [{ ...places[0], name: "새 국밥" }, places[1]],
				}),
			).toBe(true);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual(["a"]);
		expect(result.current.room.snapshot.candidates[0].id).toBe("a");
		expect(result.current.room.snapshot.history[0]).toEqual(record);
		expect(places[0].name).toBe("국밥");
	});
	it("rejects stale revisions, pending edits, wrong draw IDs and early next-round actions", async () => {
		const { result } = setup();
		await act(async () => {
			expect(await result.current.room.enterEditing(999)).toBe(false);
		});
		await act(async () => {
			result.current.room.startDraw();
		});
		await act(async () => {
			expect(
				await result.current.room.editRoom({ baseVersion: 1, candidates: [] }),
			).toBe(false);
		});
		act(() => {
			expect(
				result.current.room.nextRound(
					result.current.room.snapshot.draw?.id ?? "missing",
				),
			).toBe(false);
		});
		await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		act(() => {
			expect(result.current.room.nextRound("wrong")).toBe(false);
		});
	});
	it("does not apply a confirmed exclusion reset when the random request fails", async () => {
		const { result } = setup();
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
		});
		await spin(result);
		const draw = result.current.room.snapshot.draw;
		assert(draw);
		act(() => {
			result.current.room.nextRound(draw.id);
		});
		vi.mocked(drawFromSoloEntropy).mockRejectedValueOnce(new Error("offline"));
		await act(async () => {
			result.current.room.startDraw({ confirmReset: true });
		});
		expect(result.current.room.snapshot.excludedIds).toEqual(["a"]);
		expect(result.current.room.snapshot.history).toHaveLength(1);
		expect(result.current.room.snapshot.status).toBe("waiting");
	});
	it("keeps in-memory results available when local storage is blocked", async () => {
		const { result } = setup();
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new Error("blocked");
		});
		await spin(result);
		expect(result.current.storageFailed).toBe(true);
		const saved = readSoloRoom(result.current.room.snapshot.roomId);
		expect(saved?.snapshot.draw?.id).toBe(
			result.current.room.snapshot.draw?.id,
		);
		expect(saved?.storageFailed).toBe(true);
	});
	it("resumes the same spin after a refresh and archives its vote on the next game", async () => {
		const first = setup();
		await act(async () => {
			first.result.current.room.startDraw();
		});
		const { roomId, draw } = first.result.current.room.snapshot;
		assert(draw);
		first.unmount();
		const saved = readSoloRoom(roomId);
		assert(saved);
		const resumed = renderHook(() => useSoloLunch(saved.snapshot));
		await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
		act(() => {
			expect(resumed.result.current.room.vote(draw.id, "up")).toBe(true);
			expect(resumed.result.current.room.vote(draw.id, "down")).toBe(false);
			expect(resumed.result.current.room.nextRound(draw.id, true)).toBe(true);
		});
		expect(readSoloRoom(roomId)?.snapshot).toMatchObject({
			status: "editing",
			draw: null,
			history: [{ id: draw.id, votes: [{ name: "하나", vote: "up" }] }],
		});
		expect(setup().result.current.room.snapshot.history).toEqual([]);
	});
	it("saves recommendations, title changes and a closed archive until expiry", async () => {
		const { result } = setup();
		await act(async () => {
			expect(await result.current.room.openIntake()).toBe(true);
			expect(await result.current.room.addCandidate("냉면")).toBe(true);
			expect(await result.current.room.closeIntake()).toBe(true);
			expect(await result.current.room.finalizeIntake()).toBe(true);
			expect(
				await result.current.room.editRoom({
					baseVersion: 2,
					title: "새 이름",
				}),
			).toBe(true);
		});
		await spin(result);
		const { roomId, draw } = result.current.room.snapshot;
		assert(draw);
		await act(async () => {
			expect(result.current.room.vote(draw.id, "down")).toBe(true);
			expect(await result.current.room.closeRoom()).toBe(true);
		});
		const saved = readSoloRoom(roomId);
		expect(saved?.snapshot).toMatchObject({
			title: "새 이름",
			status: "closed",
			draw: { votes: [{ name: "하나", vote: "down" }] },
		});
		await act(async () => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
		expect(readSoloRoom(roomId)).toBeNull();
	});

	it("applies result-time ON immediately after reset and keeps the completed record immutable", async () => {
		const { result } = setup();
		await spin(result);
		const record = structuredClone(result.current.room.snapshot.draw);
		assert(record);
		await act(async () => {
			await result.current.room.resetExclusions();
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
		});
		expect(result.current.room.snapshot.excludedIds).toEqual([
			record.candidates[record.winnerIndex].id,
		]);
		expect(result.current.room.snapshot.draw).toEqual(record);
		expect(result.current.room.snapshot.history).toEqual([]);
		await act(async () => {
			await result.current.room.updateRoomOptions(false);
			await result.current.room.updateRoomOptions(true);
		});
		expect(result.current.room.snapshot.exclusionRecords).toHaveLength(1);
		act(() => {
			result.current.room.nextRound(record.id);
		});
		expect(
			getEligibleRoomCandidates(result.current.room.snapshot),
		).toHaveLength(1);
	});
	it("does not reveal the winning exclusion before a solo draw finishes", async () => {
		const { result } = setup();
		await act(async () => {
			await result.current.room.updateRoomOptions(true);
			result.current.room.startDraw();
		});
		expect(result.current.room.snapshot.status).toBe("drawing");
		expect(result.current.room.snapshot.excludedIds).toEqual([]);
		expect(result.current.room.snapshot.exclusionRecords).toEqual([]);
		await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		expect(result.current.room.snapshot.excludedIds).toEqual(["a"]);
	});
});
