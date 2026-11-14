// @vitest-environment jsdom
import {
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
} from "vitest";
import { candidateDraftLimits } from "../src/lib/candidateListDraft";
import { sampleLunchPlaces } from "../src/lib/lunch";
import { CandidateListFlow } from "../stories/candidate-lists/CandidateListFlow";
import {
	type CandidateLibrary,
	previewLibraryKey,
	readCandidateLibrary,
	writeCandidateLibrary,
} from "../stories/candidate-lists/list-library";

const originalShowModal = Object.getOwnPropertyDescriptor(
	HTMLDialogElement.prototype,
	"showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
	HTMLDialogElement.prototype,
	"close",
);

beforeAll(() => {
	// jsdom does not implement native modal visibility or dismissal.
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
	localStorage.removeItem(previewLibraryKey);
});
afterEach(() => {
	cleanup();
	localStorage.removeItem(previewLibraryKey);
});

function changeName(index: number, name: string) {
	fireEvent.change(
		screen.getByRole("textbox", {
			name: new RegExp(`^${index}번째\\s*후보 이름`),
		}),
		{ target: { value: name } },
	);
}

function save() {
	fireEvent.click(screen.getByRole("button", { name: "저장하고 사용" }));
}

function storedLibrary() {
	const result = readCandidateLibrary(localStorage);
	expect(result.error).toBe("");
	return result.library;
}

function savedExample(): CandidateLibrary {
	return {
		version: 1,
		lastUsedId: "my-list",
		lists: [
			{
				id: "my-list",
				name: "저장한 점심",
				updatedAt: 1,
				items: [
					{ id: "one", name: "김밥", category: "분식", included: true },
					{ id: "two", name: "국밥", category: "한식", included: true },
				],
			},
		],
	};
}

describe("Storybook candidate list flow", () => {
	it("blocks starting a new list at the library limit while allowing existing lists to be edited", () => {
		const library = savedExample();
		library.lists = Array.from(
			{ length: candidateDraftLimits.savedLists },
			(_, index) => ({
				...savedExample().lists[0],
				id: `saved-list-${index}`,
				name: `저장 목록 ${index + 1}`,
			}),
		);
		library.lastUsedId = library.lists[0].id;
		writeCandidateLibrary(localStorage, library);
		const storedBefore = localStorage.getItem(previewLibraryKey);
		render(<CandidateListFlow initialStage="current" storageMode="normal" />);
		fireEvent.click(screen.getByRole("button", { name: "목록 리셋" }));
		expect(
			screen.getByRole("heading", { level: 1, name: "후보 목록" }),
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(
			"저장 목록은 20개까지입니다. 내 목록에서 하나를 삭제한 뒤 새 목록을 만들어 주세요.",
		);
		expect(screen.queryByRole("button", { name: /^새로 만들기/ })).toBeNull();
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
		fireEvent.click(screen.getByRole("button", { name: "목록 편집" }));
		expect(
			(screen.getByRole("textbox", { name: "목록 이름" }) as HTMLInputElement)
				.value,
		).toBe("저장 목록 1");
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		fireEvent.click(
			screen.getByRole("button", { name: "저장 목록 2 불러와 편집" }),
		);
		expect(
			(screen.getByRole("textbox", { name: "목록 이름" }) as HTMLInputElement)
				.value,
		).toBe("저장 목록 2");
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
	});

	it("creates, applies and restores a custom list on the next visit", () => {
		const firstVisit = render(
			<CandidateListFlow initialStage="current" storageMode="normal" />,
		);
		fireEvent.click(screen.getByRole("button", { name: "목록 리셋" }));
		fireEvent.click(screen.getByRole("button", { name: /^새로 만들기/ }));
		fireEvent.change(screen.getByRole("textbox", { name: "목록 이름" }), {
			target: { value: "우리 팀 메뉴" },
		});
		changeName(1, "김치찌개");
		changeName(2, "파스타");
		save();
		expect(screen.getByRole("heading", { name: "우리 팀 메뉴" })).toBeTruthy();
		const current = screen.getByRole("list", { name: "현재 후보 목록" });
		expect(within(current).getByText("김치찌개")).toBeTruthy();
		expect(within(current).getByText("파스타")).toBeTruthy();
		const stored = storedLibrary();
		expect(stored.lists).toHaveLength(1);
		expect(stored.lastUsedId).toBe(stored.lists[0].id);
		expect(stored.lists[0].name).toBe("우리 팀 메뉴");
		expect(stored.lists[0].items.map((item) => item.name)).toEqual([
			"김치찌개",
			"파스타",
		]);
		firstVisit.unmount();
		render(<CandidateListFlow initialStage="current" storageMode="normal" />);
		expect(screen.getByRole("heading", { name: "우리 팀 메뉴" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "우리 팀 메뉴 불러와 편집" }),
		).toBeTruthy();
		expect(
			within(screen.getByRole("list", { name: "현재 후보 목록" }))
				.getAllByRole("listitem")
				.map((item) => item.querySelector("strong")?.textContent),
		).toEqual(["김치찌개", "파스타"]);
	});

	it("retains an unsaved draft after storage failure and discards it only after confirmation", () => {
		const original = savedExample();
		writeCandidateLibrary(localStorage, original);
		const storedBefore = localStorage.getItem(previewLibraryKey);
		render(<CandidateListFlow initialStage="current" storageMode="fail" />);
		fireEvent.click(screen.getByRole("button", { name: "목록 편집" }));
		fireEvent.change(screen.getByRole("textbox", { name: "목록 이름" }), {
			target: { value: "저장 전 초안" },
		});
		changeName(1, "수정한 김밥");
		save();
		expect(
			screen
				.getByText("저장 실패 예제입니다. 편집 내용은 유지됩니다.")
				.getAttribute("role"),
		).toBe("alert");
		expect(
			(screen.getByRole("textbox", { name: "목록 이름" }) as HTMLInputElement)
				.value,
		).toBe("저장 전 초안");
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		const firstDialog = screen.getByRole("dialog", {
			name: "편집 내용을 버릴까요?",
		});
		fireEvent(firstDialog, new Event("cancel", { cancelable: true }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(
			(
				screen.getByRole("textbox", {
					name: /^1번째\s*후보 이름/,
				}) as HTMLInputElement
			).value,
		).toBe("수정한 김밥");
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		fireEvent.click(
			within(screen.getByRole("dialog")).getByRole("button", {
				name: "편집 취소",
			}),
		);
		expect(screen.getByRole("heading", { name: "저장한 점심" })).toBeTruthy();
		const current = screen.getByRole("list", { name: "현재 후보 목록" });
		expect(within(current).getByText("김밥")).toBeTruthy();
		expect(within(current).queryByText("수정한 김밥")).toBeNull();
		expect(localStorage.getItem(previewLibraryKey)).toBe(storedBefore);
		expect(storedLibrary()).toEqual(original);
	});

	it("preserves another screen's newer saved list when an older draft tries to save", () => {
		writeCandidateLibrary(localStorage, savedExample());
		render(<CandidateListFlow initialStage="current" storageMode="normal" />);
		fireEvent.click(screen.getByRole("button", { name: "목록 편집" }));
		changeName(1, "이 화면의 초안");
		const newer = savedExample();
		newer.lists[0].name = "다른 화면에서 저장한 목록";
		newer.lists[0].items[0].name = "다른 화면의 김밥";
		newer.lists[0].updatedAt = 2;
		writeCandidateLibrary(localStorage, newer);
		const newerRaw = localStorage.getItem(previewLibraryKey);
		save();
		expect(
			screen.getByText(
				"다른 화면에서 저장 목록이 바뀌었습니다. 새로고침 후 다시 확인해 주세요. 현재 초안은 유지됩니다.",
			),
		).toBeTruthy();
		expect(
			(
				screen.getByRole("textbox", {
					name: /^1번째\s*후보 이름/,
				}) as HTMLInputElement
			).value,
		).toBe("이 화면의 초안");
		expect(localStorage.getItem(previewLibraryKey)).toBe(newerRaw);
		expect(storedLibrary()).toEqual(newer);
	});

	it("copies a template into an editable list with independent IDs and inclusion choices", () => {
		const original = structuredClone(sampleLunchPlaces);
		const salad = sampleLunchPlaces.filter(
			(item) => item.category === "샐러드",
		);
		render(<CandidateListFlow initialStage="choose" storageMode="normal" />);
		fireEvent.click(
			screen.getByRole("button", { name: /^템플릿에서 가져오기/ }),
		);
		fireEvent.click(screen.getByRole("button", { name: /^샐러드/ }));
		changeName(1, "우리 팀 샐러드");
		fireEvent.change(
			screen.getByRole("textbox", { name: /^1번째\s*분류 \(선택\)/ }),
			{ target: { value: "가벼운 점심" } },
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "2번째 후보 포함" }));
		save();
		const saved = storedLibrary().lists[0];
		expect(saved.name).toBe("샐러드");
		expect(saved.items).toHaveLength(salad.length);
		expect(saved.items[0]).toEqual({
			...salad[0],
			id: saved.items[0].id,
			name: "우리 팀 샐러드",
			category: "가벼운 점심",
			included: true,
		});
		expect(saved.items[1].included).toBe(false);
		expect(
			saved.items.every((item) => !salad.some((row) => row.id === item.id)),
		).toBe(true);
		expect(sampleLunchPlaces).toEqual(original);
		expect(
			within(screen.getByRole("list", { name: "현재 후보 목록" })).getByText(
				"제외",
			),
		).toBeTruthy();
	});

	it("requires correction of an imported blank name and preserves duplicate names as distinct candidates", () => {
		render(<CandidateListFlow initialStage="choose" storageMode="normal" />);
		fireEvent.click(screen.getByRole("button", { name: /^엑셀에서 가져오기/ }));
		fireEvent.click(screen.getByRole("button", { name: /^예제 엑셀 선택/ }));
		expect(
			screen.getByRole("table", { name: "엑셀 후보 미리보기" }),
		).toBeTruthy();
		expect(screen.getByText("이름 필요")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "편집기로 가져오기" }));
		save();
		const missingName = screen.getByRole("textbox", {
			name: /^4번째\s*후보 이름/,
		});
		expect(document.activeElement).toBe(missingName);
		expect(missingName.getAttribute("aria-invalid")).toBe("true");
		expect(localStorage.getItem(previewLibraryKey)).toBeNull();
		changeName(4, "된장찌개");
		save();
		const saved = storedLibrary().lists[0];
		expect(saved.items.map((item) => item.name)).toEqual([
			"비빔밥",
			"돈까스",
			"쌀국수",
			"된장찌개",
			"비빔밥",
		]);
		expect(new Set(saved.items.map((item) => item.id)).size).toBe(5);
		expect(saved.items.every((item) => item.included)).toBe(true);
		expect(
			screen.getByRole("heading", { name: "엑셀에서 가져온 목록" }),
		).toBeTruthy();
	});
});
