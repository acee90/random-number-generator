// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SoloLunchRoomPage from "../src/components/features/SoloLunchRoomPage";
import { lunchSpinDurationMs } from "../src/lib/lunch";
import { lunchHistoryKey } from "../src/lib/lunchHistory";
import {
	createSoloRoom,
	readSoloRoom,
	soloHistoryKey,
} from "../src/lib/soloRoom";
import { generateRandomNumbers } from "../src/services/randomService";

vi.mock("../src/services/randomService", () => ({
	generateRandomNumbers: vi.fn(),
	getSourceDisplayName: (source: string) => source,
}));
const places = [
	{ id: "one", name: "한식당", category: "한식" },
	{ id: "two", name: "중식당", category: "중식" },
];
beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	vi.useFakeTimers();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
	vi.mocked(generateRandomNumbers)
		.mockReset()
		.mockResolvedValue({ numbers: [0], source: "csprng" });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
async function draw() {
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "룰렛 돌리기" })),
	);
	await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
}

function renderRoom() {
	const { roomId } = createSoloRoom({
		title: "내 점심방",
		hostName: "하나",
		candidates: places,
		candidateIds: [],
		startInWaiting: true,
	});
	return { ...render(<SoloLunchRoomPage roomId={roomId} />), roomId };
}

async function addCandidate(value: string) {
	const addRow = screen.queryByRole("button", { name: "추가하기" });
	if (addRow) fireEvent.click(addRow);
	const quickAdd = within(screen.getByRole("form", { name: "후보 빠른 추가" }));
	fireEvent.change(quickAdd.getByLabelText("새 후보 이름"), {
		target: { value },
	});
	await act(async () =>
		fireEvent.click(quickAdd.getByRole("button", { name: "후보 추가" })),
	);
}

describe("shared solo game screen", () => {
	it("keeps unknown private rooms out of the shared room service", () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		render(<SoloLunchRoomPage roomId={crypto.randomUUID()} />);
		expect(
			screen.getByRole("heading", { name: "이 탭에서 방을 찾을 수 없습니다" }),
		).toBeTruthy();
		expect(fetch).not.toHaveBeenCalled();
	});
	it("shows the room lifecycle UI without collaboration controls", () => {
		renderRoom();
		expect(screen.getByRole("heading", { name: "내 점심방" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "후보 편집" })).toBeTruthy();
		expect(screen.getByRole("button", { name: /후보 보기/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "초대 링크 복사" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: /메시지/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "룰렛·결과" })).toBeNull();
	});
	it("uses the shared result, then waits for an explicit new spin", async () => {
		renderRoom();
		await draw();
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
		const up = screen.getByRole("button", { name: /좋아요/ });
		fireEvent.click(up);
		expect(up.getAttribute("aria-pressed")).toBe("true");
		const next = screen.getByRole("button", {
			name: "다음 게임",
		});
		next.focus();
		fireEvent.click(next);
		expect(screen.getByRole("button", { name: "룰렛 돌리기" })).toBe(
			document.activeElement,
		);
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
	});
	it("edits candidates straight from a completed game and keeps that game's record", async () => {
		const { roomId } = renderRoom();
		await draw();
		const firstRecord = readSoloRoom(roomId)?.snapshot.draw;
		fireEvent.click(screen.getByRole("button", { name: "후보 편집" }));
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "후보 편집" }),
		);
		await addCandidate("분식집");
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(readSoloRoom(roomId)?.snapshot.history[0]).toEqual(firstRecord);
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
		vi.mocked(generateRandomNumbers).mockResolvedValueOnce({
			numbers: [2],
			source: "csprng",
		});
		await draw();
		expect(generateRandomNumbers).toHaveBeenLastCalledWith({
			data: { min: 0, max: 2, count: 1, unique: false },
		});
		expect(screen.getByRole("heading", { name: "분식집" })).toBeTruthy();
	});
	it("locks duplicate draws and candidate edits until the timeline completes", async () => {
		let resolve!: (value: { numbers: number[]; source: "csprng" }) => void;
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		renderRoom();
		const button = screen.getByRole("button", { name: "룰렛 돌리기" });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("button", { name: "후보 편집" })).toBeNull();
		await act(async () => resolve({ numbers: [0], source: "csprng" }));
		expect(screen.queryByRole("heading", { name: "한식당" })).toBeNull();
		await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
	});
	it("recovers from invalid random results without recording them", async () => {
		vi.mocked(generateRandomNumbers).mockResolvedValueOnce({
			numbers: [8],
			source: "csprng",
		});
		renderRoom();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "룰렛 돌리기" })),
		);
		expect(screen.getByRole("alert").textContent).toContain("다시 시도");
		expect(localStorage.getItem(soloHistoryKey)).toBeNull();
		await draw();
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
	});
	it("edits and finalizes candidates with the shared editor and supports recommendation intake", async () => {
		renderRoom();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보 편집" })),
		);
		expect(screen.getByRole("switch", { name: "후보 추천받기" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "마감" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(screen.getByRole("button", { name: "룰렛 돌리기" })).toBeTruthy();
	});
	it("persists full draw records and restores them after remounting", async () => {
		const first = renderRoom();
		await draw();
		fireEvent.click(screen.getByRole("button", { name: "다음 게임" }));
		expect(readSoloRoom(first.roomId)?.snapshot.history).toHaveLength(1);
		first.unmount();
		render(<SoloLunchRoomPage roomId={first.roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "추첨 기록" }),
		);
		expect(
			screen.getByRole("button", { name: "한식당 상세 기록 열기" }),
		).toBeTruthy();
	});
	it("preserves old winner-only history without inventing candidate snapshots", () => {
		localStorage.setItem(
			lunchHistoryKey,
			JSON.stringify([
				{
					id: "legacy",
					place: places[1],
					candidateCount: 5,
					source: "csprng",
					timestamp: 1000,
				},
			]),
		);
		renderRoom();
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		expect(
			within(screen.getByRole("dialog")).getByRole("heading", {
				name: "중식당",
			}),
		).toBeTruthy();
		expect(localStorage.getItem(lunchHistoryKey)).toContain("legacy");
	});
	it("can open detailed pre-room solo records without adding them to a new room", async () => {
		const first = renderRoom();
		await draw();
		const previous = readSoloRoom(first.roomId)?.snapshot.draw;
		localStorage.setItem(soloHistoryKey, JSON.stringify([previous]));
		first.unmount();
		const next = renderRoom();
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		expect(
			screen.getByRole("heading", { name: "이전 혼자 추첨 기록" }),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "한식당 상세 기록 열기" }),
		);
		expect(
			screen.getByRole("heading", { name: "한식당 상세 기록" }),
		).toBeTruthy();
		expect(readSoloRoom(next.roomId)?.snapshot.history).toEqual([]);
	});
	it("can still play when pre-room draws are damaged", () => {
		localStorage.setItem(soloHistoryKey, "{broken");
		renderRoom();
		expect(
			screen.getByText(/기록을 저장하거나 불러오지 못했습니다/),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "룰렛 돌리기" })).toBeTruthy();
	});
	it("returns keyboard focus to the history trigger after Escape", async () => {
		renderRoom();
		const trigger = screen.getByRole("button", { name: "지난 기록" });
		fireEvent.click(trigger);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		await act(async () => vi.advanceTimersByTime(400));
		expect(document.activeElement).toBe(trigger);
	});

	it("ignores responses received after the solo screen unmounts", async () => {
		let resolve!: (value: { numbers: number[]; source: "csprng" }) => void;
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const view = renderRoom();
		fireEvent.click(screen.getByRole("button", { name: "룰렛 돌리기" }));
		view.unmount();
		await act(async () => resolve({ numbers: [0], source: "csprng" }));
		await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		expect(readSoloRoom(view.roomId)?.snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			history: [],
		});
	});
});
