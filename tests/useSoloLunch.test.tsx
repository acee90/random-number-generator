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
import { soloHistoryKey, useSoloLunch } from "../src/hooks/useSoloLunch";
import { lunchSpinDurationMs } from "../src/lib/lunch";
import { getEligibleRoomCandidates } from "../src/lib/lunchRoom";
import { generateRandomNumbers } from "../src/services/randomService";

vi.mock("../src/services/randomService", () => ({
	generateRandomNumbers: vi.fn(),
}));
const places = [
	{ id: "a", name: "국밥", category: "한식" },
	{ id: "b", name: "우동", category: "일식" },
];
beforeEach(() => {
	localStorage.clear();
	vi.useFakeTimers();
	vi.mocked(generateRandomNumbers)
		.mockReset()
		.mockResolvedValue({ numbers: [0], source: "csprng" });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});
function setup() {
	return renderHook(() => useSoloLunch(places));
}
async function spin(result: ReturnType<typeof setup>["result"]) {
	await act(async () => {
		expect(result.current.room.startDraw()).toBe(true);
	});
	await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
}
describe("local game controller", () => {
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
	});
	it("resets only automatic exclusions and keeps manual filters and history", async () => {
		const { result } = setup();
		await spin(result);
		const record = structuredClone(result.current.room.snapshot.history[0]);
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
		await spin(result);
		const record = structuredClone(result.current.room.snapshot.history[0]);
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
		vi.mocked(generateRandomNumbers).mockRejectedValueOnce(
			new Error("offline"),
		);
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
		expect(result.current.room.snapshot.history).toHaveLength(1);
	});
	it("flags damaged stored records without preventing a new game", () => {
		localStorage.setItem(soloHistoryKey, "{broken");
		const { result } = setup();
		expect(result.current.storageFailed).toBe(true);
		expect(result.current.room.snapshot.history).toEqual([]);
		act(() => {
			expect(result.current.room.startDraw()).toBe(true);
		});
	});
});
