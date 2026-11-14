// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	type CandidateLibrary,
	previewLibraryKey,
	readCandidateLibrary,
	writeCandidateLibrary,
} from "../stories/candidate-lists/list-library";
import { RoomCandidateFlow } from "../stories/candidate-lists/RoomCandidateFlow";

const originalShowModal = Object.getOwnPropertyDescriptor(
	HTMLDialogElement.prototype,
	"showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
	HTMLDialogElement.prototype,
	"close",
);
beforeAll(() => {
	// jsdom needs native modal visibility and dismissal supplied by the test.
	Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
		configurable: true,
		value(this: HTMLDialogElement) {
			this.open = true;
		},
	});
	Object.defineProperty(HTMLDialogElement.prototype, "close", {
		configurable: true,
		value(this: HTMLDialogElement) {
			this.open = false;
		},
	});
});
afterAll(() => {
	for (const [key, descriptor] of [
		["showModal", originalShowModal],
		["close", originalClose],
	] as const) {
		if (descriptor)
			Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
		else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
	}
});

beforeEach(() => {
	vi.useFakeTimers();
	localStorage.removeItem(previewLibraryKey);
});
afterEach(() => {
	cleanup();
	vi.clearAllTimers();
	vi.useRealTimers();
	localStorage.removeItem(previewLibraryKey);
});

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

function sharedCandidates() {
	return screen.getByRole("status", { name: "참가자에게 공유된 후보" });
}

function changeFirstName(value: string) {
	fireEvent.change(
		screen.getByRole("textbox", { name: /^1번째\s*후보 이름/ }),
		{ target: { value } },
	);
}

function setPhase(value: "ready" | "drawing" | "voting" | "offline") {
	fireEvent.change(screen.getByRole("combobox", { name: "방 상태" }), {
		target: { value },
	});
}

function applyToRoom() {
	fireEvent.click(screen.getByRole("button", { name: "방에 적용" }));
}

function personalLibrary(): CandidateLibrary {
	return {
		version: 1,
		lastUsedId: "personal-source",
		lists: [
			{
				id: "personal-source",
				name: "원래 내 목록",
				updatedAt: 1,
				items: sampleLunchPlaces
					.slice(0, 2)
					.map((place) => ({ ...place, included: true })),
			},
		],
	};
}

describe("Storybook in-room candidate editing flow", () => {
	it("allows a deleted personal copy of the current room list to be saved again", () => {
		render(<RoomCandidateFlow />);
		fireEvent.click(screen.getByRole("button", { name: "내 목록에 저장" }));
		const firstCopy = readCandidateLibrary(localStorage).library.lists[0];
		expect(firstCopy.items).toHaveLength(6);
		expect(
			screen
				.getByRole("button", { name: "내 목록에 저장됨" })
				.matches(":disabled"),
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", {
				name: "방 만들 때 선택한 목록 저장 목록 삭제",
			}),
		);
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: "저장 목록에서 삭제할까요?" }),
			).getByRole("button", { name: "삭제" }),
		);
		expect(readCandidateLibrary(localStorage).library.lists).toHaveLength(0);
		const saveAgain = screen.getByRole("button", { name: "내 목록에 저장" });
		expect(saveAgain.matches(":disabled")).toBe(false);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v1 · 6개");
		fireEvent.click(saveAgain);
		const saved = readCandidateLibrary(localStorage).library;
		expect(saved.lists).toHaveLength(1);
		expect(saved.lists[0].id).not.toBe(firstCopy.id);
		expect(saved.lists[0].items).toEqual(firstCopy.items);
		expect(saved.lastUsedId).toBe(saved.lists[0].id);
		expect(
			screen
				.getByRole("button", { name: "내 목록에 저장됨" })
				.matches(":disabled"),
		).toBe(true);
	});

	it("keeps shared candidates unchanged and locks all editor controls until the room acknowledges the edit", async () => {
		writeCandidateLibrary(localStorage, personalLibrary());
		const storedBefore = localStorage.getItem(previewLibraryKey);
		render(<RoomCandidateFlow />);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v1 · 6개");
		fireEvent.click(screen.getByRole("button", { name: "목록 편집" }));
		changeFirstName("방에서 수정한 식당");
		applyToRoom();
		const form = screen.getByRole("form", { name: "후보 목록 편집" });
		expect(form.getAttribute("aria-busy")).toBe("true");
		for (const control of [
			...within(form).getAllByRole("textbox"),
			...within(form).getAllByRole("checkbox"),
			...within(form).getAllByRole("button"),
		]) {
			expect(control.matches(":disabled")).toBe(true);
		}
		expect(
			screen.getByRole("button", { name: "뒤로" }).matches(":disabled"),
		).toBe(true);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v1 · 6개");
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
		await advance(999);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v1 · 6개");
		expect(screen.queryByRole("list", { name: "현재 후보 목록" })).toBeNull();
		await advance(1);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v2 · 6개");
		expect(
			within(screen.getByRole("list", { name: "현재 후보 목록" })).getByText(
				"방에서 수정한 식당",
			),
		).toBeTruthy();
		expect(screen.queryByRole("form", { name: "후보 목록 편집" })).toBeNull();
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
	});

	it.each([
		"failed response",
		"connection lost",
	])("keeps the draft and applied list when %s interrupts an apply, then allows retry", async (scenario) => {
		writeCandidateLibrary(localStorage, personalLibrary());
		const storedBefore = localStorage.getItem(previewLibraryKey);
		render(<RoomCandidateFlow />);
		fireEvent.click(screen.getByRole("button", { name: "목록 편집" }));
		changeFirstName("재시도할 식당");
		if (scenario === "failed response")
			fireEvent.click(screen.getByRole("checkbox", { name: "방 적용 실패" }));
		applyToRoom();
		if (scenario === "connection lost") setPhase("offline");
		await advance(1000);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v1 · 6개");
		expect(screen.getByText(/초안은 유지됩니다\./).getAttribute("role")).toBe(
			"alert",
		);
		expect(
			(
				screen.getByRole("textbox", {
					name: /^1번째\s*후보 이름/,
				}) as HTMLInputElement
			).value,
		).toBe("재시도할 식당");
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
		if (scenario === "connection lost") {
			expect(
				screen.getByRole("button", { name: "방에 적용" }).matches(":disabled"),
			).toBe(true);
			setPhase("ready");
		} else
			fireEvent.click(screen.getByRole("checkbox", { name: "방 적용 실패" }));
		expect(
			screen.getByRole("button", { name: "방에 적용" }).matches(":disabled"),
		).toBe(false);
		applyToRoom();
		await advance(1000);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v2 · 6개");
		expect(
			within(screen.getByRole("list", { name: "현재 후보 목록" })).getByText(
				"재시도할 식당",
			),
		).toBeTruthy();
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
	});

	it("archives voting results before editing and preserves their names and vote totals after applying new candidates", async () => {
		render(<RoomCandidateFlow />);
		setPhase("voting");
		expect(
			screen.getByRole("button", { name: "목록 편집" }).matches(":disabled"),
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "투표 종료하고 다음 게임" }),
		);
		fireEvent.click(screen.getByText("이전 추첨 기록 1"));
		const history = screen.getByRole("region", { name: "1회차 기록" });
		const names = sampleLunchPlaces.slice(0, 6).map((place) => place.name);
		expect(
			within(history)
				.getAllByRole("listitem")
				.map((item) => item.textContent),
		).toEqual(names);
		expect(within(history).getByText("좋아요 4 · 싫어요 2")).toBeTruthy();
		const historicalText = history.textContent;
		fireEvent.click(screen.getByRole("button", { name: "목록 편집" }));
		changeFirstName("다음 회차 식당");
		applyToRoom();
		await advance(1000);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v2 · 6개");
		expect(
			within(screen.getByRole("list", { name: "현재 후보 목록" })).getByText(
				"다음 회차 식당",
			),
		).toBeTruthy();
		const preserved = screen.getByRole("region", { name: "1회차 기록" });
		expect(preserved.textContent).toBe(historicalText);
		expect(within(preserved).queryByText("다음 회차 식당")).toBeNull();
		expect(within(preserved).getByText("좋아요 4 · 싫어요 2")).toBeTruthy();
	});

	it("locks host edit actions during drawing, voting and reconnection and hides them from guests", () => {
		render(<RoomCandidateFlow />);
		for (const phase of ["drawing", "voting", "offline"] as const) {
			setPhase(phase);
			expect(
				screen.getByRole("button", { name: "목록 편집" }).matches(":disabled"),
			).toBe(true);
			expect(
				screen.getByRole("button", { name: "목록 리셋" }).matches(":disabled"),
			).toBe(true);
		}
		setPhase("ready");
		expect(
			screen.getByRole("button", { name: "목록 편집" }).matches(":disabled"),
		).toBe(false);
		fireEvent.click(screen.getByRole("checkbox", { name: "방장으로 보기" }));
		expect(screen.queryByRole("button", { name: "목록 편집" })).toBeNull();
		expect(screen.queryByRole("button", { name: "목록 리셋" })).toBeNull();
		expect(screen.queryByRole("button", { name: "내 목록에 저장" })).toBeNull();
		expect(
			within(screen.getByRole("list", { name: "현재 후보 목록" })).getAllByRole(
				"listitem",
			),
		).toHaveLength(6);
		setPhase("voting");
		expect(
			screen.queryByRole("button", { name: "투표 종료하고 다음 게임" }),
		).toBeNull();
	});

	it("applies a saved personal list to the room without changing it, then explicitly saves an independent copy", async () => {
		const original = personalLibrary();
		writeCandidateLibrary(localStorage, original);
		const storedBefore = localStorage.getItem(previewLibraryKey);
		render(<RoomCandidateFlow />);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v1 · 6개");
		fireEvent.click(
			screen.getByRole("button", { name: "원래 내 목록 불러와 편집" }),
		);
		changeFirstName("방에서만 바꾼 후보");
		applyToRoom();
		await advance(1000);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v2 · 2개");
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
		fireEvent.click(screen.getByRole("button", { name: "내 목록에 저장" }));
		const result = readCandidateLibrary(localStorage);
		expect(result.error).toBe("");
		expect(result.library.lists).toHaveLength(2);
		expect(
			result.library.lists.find((list) => list.id === original.lastUsedId),
		).toEqual(original.lists[0]);
		const savedCopy = result.library.lists[0];
		expect(savedCopy.id).not.toBe(original.lastUsedId);
		expect(savedCopy.items[0].name).toBe("방에서만 바꾼 후보");
		expect(result.library.lastUsedId).toBe(savedCopy.id);
		expect(
			screen
				.getByRole("button", { name: "내 목록에 저장됨" })
				.matches(":disabled"),
		).toBe(true);
		expect(sharedCandidates().textContent).toBe("공유된 후보 v2 · 2개");
	});
});
