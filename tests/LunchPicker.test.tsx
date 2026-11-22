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
import LunchPicker from "../src/components/features/LunchPicker";
import { soloHistoryKey } from "../src/hooks/useSoloLunch";
import { lunchSpinDurationMs } from "../src/lib/lunch";
import { lunchHistoryKey } from "../src/lib/lunchHistory";
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

function listAction(name: string) {
	fireEvent.keyDown(screen.getByRole("button", { name: "목록 작업" }), {
		key: "ArrowDown",
	});
	fireEvent.click(screen.getByRole("menuitem", { name }));
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
	it("starts a new solo session in the same candidate editor as a new room", () => {
		render(<LunchPicker />);
		expect(screen.getByRole("searchbox", { name: "후보 검색" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "목록 작업" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "추가하기" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "룰렛 돌리기" })).toBeNull();
	});
	it("requires writing and finalizing a list before showing the wheel", async () => {
		render(<LunchPicker />);
		expect(
			screen.getByRole("button", { name: "마감" }).hasAttribute("disabled"),
		).toBe(true);
		await addCandidate("새 후보");
		expect(screen.queryByRole("button", { name: "룰렛 돌리기" })).toBeNull();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(
			screen.getByRole("button", { name: "마지막 후보 확정" }),
		).toBeTruthy();
	});
	it("opens the shared list loader directly from the solo preparation screen", () => {
		render(<LunchPicker />);
		listAction("목록 불러오기");
		expect(screen.getByRole("dialog", { name: "목록 불러오기" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: /기본 음식점 목록/ }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(screen.getByRole("button", { name: "목록 작업" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "룰렛 돌리기" })).toBeNull();
	});

	it("shows the room lifecycle UI without collaboration controls", () => {
		render(<LunchPicker places={places} />);
		expect(screen.getByRole("heading", { name: "혼자 추첨하기" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "후보 편집" })).toBeTruthy();
		expect(screen.getByRole("button", { name: /후보 보기/ })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "초대 링크 복사" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: /메시지/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "룰렛·결과" })).toBeNull();
	});
	it("uses the shared result, then waits for an explicit new spin", async () => {
		render(<LunchPicker places={places} />);
		await draw();
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /좋아요/ })).toBeNull();
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
		render(<LunchPicker places={places} />);
		await draw();
		const firstRecord = localStorage.getItem(soloHistoryKey);
		fireEvent.click(screen.getByRole("button", { name: "후보 편집" }));
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "후보 편집" }),
		);
		await addCandidate("분식집");
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(localStorage.getItem(soloHistoryKey)).toBe(firstRecord);
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
		render(<LunchPicker places={places} />);
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
		render(<LunchPicker places={places} />);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "룰렛 돌리기" })),
		);
		expect(screen.getByRole("alert").textContent).toContain("다시 시도");
		expect(localStorage.getItem(soloHistoryKey)).toBeNull();
		await draw();
		expect(screen.getByRole("heading", { name: "한식당" })).toBeTruthy();
	});
	it("edits and finalizes candidates with the shared editor and hides recommendation intake", async () => {
		render(<LunchPicker places={places} />);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보 편집" })),
		);
		expect(screen.queryByRole("switch", { name: "후보 추천받기" })).toBeNull();
		expect(screen.getByRole("button", { name: "마감" })).toBeTruthy();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(screen.getByRole("button", { name: "룰렛 돌리기" })).toBeTruthy();
	});
	it("persists full draw records and restores them after remounting", async () => {
		const first = render(<LunchPicker places={places} />);
		await draw();
		expect(
			JSON.parse(localStorage.getItem(soloHistoryKey) ?? "[]"),
		).toHaveLength(1);
		first.unmount();
		render(<LunchPicker places={places} />);
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
		render(<LunchPicker places={places} />);
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		expect(
			within(screen.getByRole("dialog")).getByRole("heading", {
				name: "중식당",
			}),
		).toBeTruthy();
		expect(localStorage.getItem(lunchHistoryKey)).toContain("legacy");
	});
	it("returns keyboard focus to the history trigger after Escape", async () => {
		render(<LunchPicker places={places} />);
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
		const view = render(<LunchPicker places={places} />);
		fireEvent.click(screen.getByRole("button", { name: "룰렛 돌리기" }));
		view.unmount();
		await act(async () => resolve({ numbers: [0], source: "csprng" }));
		await act(async () => vi.advanceTimersByTime(lunchSpinDurationMs));
		expect(localStorage.getItem(soloHistoryKey)).toBeNull();
	});
});
