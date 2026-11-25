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
import { lunchHistoryKey } from "../src/lib/lunchHistory";
import {
	createSoloRoom,
	readSoloRoom,
	soloHistoryKey,
} from "../src/lib/soloRoom";
import { drawFromSoloEntropy } from "../src/services/roomEntropy";
import { prepareSoloRoomEntropy } from "../src/services/roomEntropyApi";

vi.mock("../src/services/roomEntropy", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/services/roomEntropy")>()),
	drawFromSoloEntropy: vi.fn(),
}));
vi.mock("../src/services/roomEntropyApi", () => ({
	prepareSoloRoomEntropy: vi.fn(),
}));
vi.mock("../src/services/randomService", () => ({
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
	vi.mocked(prepareSoloRoomEntropy).mockReset().mockResolvedValue(null);
	vi.mocked(drawFromSoloEntropy)
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
		fireEvent.click(screen.getByRole("button", { name: "슬롯 돌리기" })),
	);
	await act(async () => vi.advanceTimersByTime(15000));
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
		expect(screen.getByRole("button", { name: "후보" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "후보 보기" })).toBeNull();
		expect(screen.queryByRole("button", { name: "초대 링크 복사" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: /메시지/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "룰렛·결과" })).toBeNull();
	});
	it("replaces the spin button with the round actions in the cabinet above the votes", async () => {
		renderRoom();
		const spin = screen.getByRole("button", { name: "슬롯 돌리기" });
		const controls = spin.parentElement;
		const canvas = controls?.closest(".slot-machine")?.querySelector("canvas");
		expect(controls?.closest(".slot-cabinet")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "대기화면으로 이동" }),
		).toBeNull();
		await draw();
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
		const up = screen.getByRole("button", { name: /좋아요/ });
		fireEvent.click(up);
		expect(up.getAttribute("aria-pressed")).toBe("true");
		const next = screen.getByRole("button", {
			name: "대기화면으로 이동",
		});
		expect(spin.isConnected).toBe(false);
		expect(screen.queryByRole("button", { name: "추첨 완료" })).toBeNull();
		expect(controls?.closest(".slot-machine")?.querySelector("canvas")).toBe(
			canvas,
		);
		expect(controls?.contains(next)).toBe(true);
		expect(
			controls?.contains(
				screen.getByRole("button", { name: "바로 다시 뽑기" }),
			),
		).toBe(true);
		expect(
			next.compareDocumentPosition(up) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		next.focus();
		fireEvent.click(next);
		expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBe(
			document.activeElement,
		);
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
	});
	it("redraws directly from the result once and preserves the last ballot in history", async () => {
		const { roomId } = renderRoom();
		await draw();
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		const voted = readSoloRoom(roomId)?.snapshot.draw;
		expect(voted?.votes).toMatchObject([{ vote: "up" }]);
		const redraw = screen.getByRole("button", { name: "바로 다시 뽑기" });
		await act(async () => {
			fireEvent.click(redraw);
			fireEvent.click(redraw);
		});
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(2);
		expect(readSoloRoom(roomId)?.snapshot.history).toEqual([voted]);
		expect(
			screen.queryByRole("heading", { name: "다음 추첨 대기" }),
		).toBeNull();
		await act(async () => vi.advanceTimersByTime(15000));
		expect(readSoloRoom(roomId)?.snapshot.draw?.roundNumber).toBe(2);
		expect(screen.getByText("0명 참여")).toBeTruthy();
	});

	it("edits candidates straight from a completed game and keeps that game's record", async () => {
		const { roomId } = renderRoom();
		await draw();
		const firstRecord = readSoloRoom(roomId)?.snapshot.draw;
		fireEvent.click(screen.getByRole("button", { name: "후보" }));
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "후보 편집" }),
		);
		await addCandidate("분식집");
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(readSoloRoom(roomId)?.snapshot.history[0]).toEqual(firstRecord);
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
		vi.mocked(drawFromSoloEntropy).mockResolvedValueOnce({
			numbers: [2],
			source: "csprng",
		});
		await draw();
		expect(drawFromSoloEntropy).toHaveBeenLastCalledWith(2, undefined);
		expect(screen.getByRole("heading", { name: "분식집" })).toBeTruthy();
	});
	it("locks duplicate draws and candidate edits until the timeline completes", async () => {
		let resolve!: (value: { numbers: number[]; source: "csprng" }) => void;
		vi.mocked(drawFromSoloEntropy).mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		renderRoom();
		const button = screen.getByRole("button", { name: "슬롯 돌리기" });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(drawFromSoloEntropy).toHaveBeenCalledTimes(1);
		expect(
			screen.getByRole("button", { name: "후보" }).matches(":disabled"),
		).toBe(true);
		await act(async () => resolve({ numbers: [0], source: "csprng" }));
		expect(
			screen.queryByRole("button", { name: "대기화면으로 이동" }),
		).toBeNull();
		expect(screen.queryByRole("heading", { name: "한식당" })).toBeNull();
		await act(async () => vi.advanceTimersByTime(15000));
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
	});
	it("recovers from invalid random results without recording them", async () => {
		vi.mocked(drawFromSoloEntropy).mockResolvedValueOnce({
			numbers: [8],
			source: "csprng",
		});
		renderRoom();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "슬롯 돌리기" })),
		);
		expect(screen.getByRole("alert").textContent).toContain("다시 시도");
		expect(localStorage.getItem(soloHistoryKey)).toBeNull();
		await draw();
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
	});
	it("edits and finalizes candidates with the shared editor and supports recommendation intake", async () => {
		renderRoom();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보" })),
		);
		expect(screen.getByRole("switch", { name: "후보 추천받기" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "마감" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBeTruthy();
	});
	it("persists full draw records and restores them after remounting", async () => {
		const first = renderRoom();
		await draw();
		fireEvent.click(screen.getByRole("button", { name: "대기화면으로 이동" }));
		expect(readSoloRoom(first.roomId)?.snapshot.history).toHaveLength(1);
		first.unmount();
		render(<SoloLunchRoomPage roomId={first.roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "당첨 내역 열기" }));
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "당첨 내역" }),
		);
		expect(
			screen.getByRole("button", { name: "한식당 상세 기록 열기" }),
		).toBeTruthy();
	});
	it("starts the board history with the current candidates and keeps completed wins after editing", async () => {
		const first = renderRoom();
		expect(screen.queryByRole("button", { name: "지난 기록" })).toBeNull();
		await draw();
		const open = () =>
			fireEvent.click(screen.getByRole("button", { name: "당첨 내역 열기" }));
		const close = () =>
			fireEvent.click(
				within(screen.getByRole("dialog")).getByRole("button", {
					name: "닫기",
				}),
			);
		open();
		expect(
			screen.queryByRole("checkbox", { name: "이전 게임 포함" }),
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "한식당 상세 기록 열기" }),
		);
		expect(
			screen.getByText("상세 기록을 열었을 때의 투표 현황입니다."),
		).toBeTruthy();
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		await act(async () => vi.advanceTimersByTime(0));
		close();
		fireEvent.click(screen.getByRole("button", { name: "대기화면으로 이동" }));
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보" })),
		);
		await addCandidate("새 후보");
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		first.unmount();
		render(<SoloLunchRoomPage roomId={first.roomId} />);
		open();
		expect(screen.getByText("현재 후보로 당첨된 내역이 없어요.")).toBeTruthy();
		const includePrevious = () =>
			screen.getByRole("checkbox", {
				name: "이전 게임 포함",
			}) as HTMLInputElement;
		expect(includePrevious().checked).toBe(false);
		fireEvent.click(includePrevious());
		const events = within(
			screen.getByRole("region", { name: "당첨 목록" }),
		).getAllByRole("listitem");
		expect(events[0].textContent).toContain("후보 변경");
		expect(events[0].textContent).toContain("새 후보 추가");
		expect(events[1].textContent).toContain("한식당");
		fireEvent.click(
			screen.getByRole("button", { name: "한식당 상세 기록 열기" }),
		);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		await act(async () => vi.advanceTimersByTime(0));
		expect(includePrevious().checked).toBe(true);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "한식당 상세 기록 열기" }),
		);
		fireEvent.click(includePrevious());
		expect(screen.queryByText("새 후보 추가")).toBeNull();
		expect(screen.getByText("현재 후보로 당첨된 내역이 없어요.")).toBeTruthy();
		fireEvent.click(includePrevious());
		close();
		open();
		expect(includePrevious().checked).toBe(false);
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
		fireEvent.click(screen.getByRole("button", { name: "당첨 내역 열기" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "이전 게임 포함" }));
		expect(
			within(screen.getByRole("listitem")).getByText("중식당"),
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
		fireEvent.click(screen.getByRole("button", { name: "당첨 내역 열기" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "이전 게임 포함" }));
		expect(
			screen.queryByRole("heading", { name: "이전 혼자 추첨 기록" }),
		).toBeNull();
		expect(screen.getAllByRole("listitem")).toHaveLength(1);
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
		expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBeTruthy();
	});
	it("returns keyboard focus to the history trigger after Escape", async () => {
		renderRoom();
		const trigger = screen.getByRole("button", { name: "당첨 내역 열기" });
		fireEvent.click(trigger);
		fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		await act(async () => vi.advanceTimersByTime(400));
		expect(document.activeElement).toBe(trigger);
	});

	it("ignores responses received after the solo screen unmounts", async () => {
		let resolve!: (value: { numbers: number[]; source: "csprng" }) => void;
		vi.mocked(drawFromSoloEntropy).mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const view = renderRoom();
		fireEvent.click(screen.getByRole("button", { name: "슬롯 돌리기" }));
		view.unmount();
		await act(async () => resolve({ numbers: [0], source: "csprng" }));
		await act(async () => vi.advanceTimersByTime(15000));
		expect(readSoloRoom(view.roomId)?.snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			history: [],
		});
	});
});
