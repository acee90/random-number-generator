// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CandidateListLoadDialog, {
	type CandidateListSelection,
} from "../src/components/features/CandidateListLoadDialog";
import {
	candidateLibraryKey,
	readCandidateLibrary,
	saveCandidateList,
} from "../src/lib/candidateLibrary";
import { sampleLunchPlaces } from "../src/lib/lunch";

beforeEach(() => localStorage.clear());
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function harness(
	select = vi.fn<(_: CandidateListSelection) => boolean | undefined>(),
) {
	function Harness() {
		const [open, setOpen] = useState(false);
		const [name, setName] = useState("입력한 초안");
		const trigger = useRef<HTMLButtonElement | null>(null);
		return (
			<>
				<label>
					작성 중인 후보
					<input
						value={name}
						onChange={(event) => setName(event.target.value)}
					/>
				</label>
				<button type="button" ref={trigger} onClick={() => setOpen(true)}>
					불러오기 열기
				</button>
				<CandidateListLoadDialog
					open={open}
					onOpenChange={setOpen}
					onSelect={select}
					returnFocusRef={trigger}
				/>
			</>
		);
	}
	return { ...render(<Harness />), select };
}
const open = () =>
	fireEvent.click(screen.getByRole("button", { name: "불러오기 열기" }));

describe("candidate list load dialog", () => {
	it("opens above the current draft and cancel restores trigger focus without changes", async () => {
		const { select } = harness();
		open();
		const dialog = screen.getByRole("dialog", { name: "목록 불러오기" });
		expect(within(dialog).getByText(/저장한 목록이 없어요/)).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
		expect(select).not.toHaveBeenCalled();
		expect(
			(
				screen.getByRole("textbox", {
					name: "작성 중인 후보",
				}) as HTMLInputElement
			).value,
		).toBe("입력한 초안");
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "불러오기 열기" }),
			),
		);
	});

	it("copies the complete real default catalog with fresh IDs and closes immediately", () => {
		const { select } = harness();
		open();
		fireEvent.click(screen.getByRole("button", { name: /^기본 음식점 목록/ }));
		expect(select).toHaveBeenCalledOnce();
		const imported = select.mock.calls[0][0];
		expect(imported.name).toBe("기본 음식점 목록");
		expect(imported.candidates).toHaveLength(sampleLunchPlaces.length);
		expect(new Set(imported.candidates.map((item) => item.id)).size).toBe(
			sampleLunchPlaces.length,
		);
		expect(imported.candidates[0].id).not.toBe(sampleLunchPlaces[0].id);
		expect(imported.candidates[0]).toMatchObject({
			...sampleLunchPlaces[0],
			id: imported.candidates[0].id,
			included: true,
		});
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("loads a saved original as independent candidates and does not import old game exclusions", () => {
		const saved = saveCandidateList({
			id: "input-list",
			name: "우리 팀 목록",
			items: [
				{ id: "first", name: "나의 후보", category: "", included: false },
				{
					id: "second",
					name: "나의 후보",
					category: "팀 추천",
					included: true,
				},
			],
		});
		const before = localStorage.getItem(candidateLibraryKey);
		const { select } = harness();
		open();
		fireEvent.click(
			screen.getByRole("button", { name: /^우리 팀 목록.*후보/ }),
		);
		const items = select.mock.calls[0][0].candidates;
		expect(items[0]).toMatchObject({
			name: "나의 후보",
			category: "미분류",
			included: true,
		});
		expect(items[1].category).toBe("팀 추천");
		expect(items.map((item) => item.id)).not.toEqual(
			saved.items.map((item) => item.id),
		);
		expect(localStorage.getItem(candidateLibraryKey)).toBe(before);
	});

	it("stays open when parent requests a draft replacement confirmation", () => {
		const select = vi.fn(() => false);
		harness(select);
		open();
		fireEvent.click(screen.getByRole("button", { name: /^기본 음식점 목록/ }));
		expect(select).toHaveBeenCalledOnce();
		expect(screen.getByRole("dialog", { name: "목록 불러오기" })).toBeTruthy();
	});

	it("keeps the default catalog available on corrupt storage and can retry reading", () => {
		localStorage.setItem(candidateLibraryKey, "unreadable");
		harness();
		open();
		expect(screen.getByRole("alert").textContent).toContain("기존 저장 내용");
		expect(
			screen
				.getByRole("button", { name: /^기본 음식점 목록/ })
				.matches(":disabled"),
		).toBe(false);
		localStorage.removeItem(candidateLibraryKey);
		fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByText(/저장한 목록이 없어요/)).toBeTruthy();
	});

	it("refreshes an open library when another tab saves a list", () => {
		harness();
		open();
		saveCandidateList({
			id: "input",
			name: "다른 탭 목록",
			items: [{ id: "one", name: "후보", category: "", included: true }],
		});
		fireEvent(
			window,
			new StorageEvent("storage", { key: candidateLibraryKey }),
		);
		expect(
			screen.getByRole("button", { name: /^다른 탭 목록.*후보/ }),
		).toBeTruthy();
	});

	it("confirms deleting only a saved copy and preserves other lists and the current draft", async () => {
		const item = { id: "one", name: "후보", category: "", included: true };
		saveCandidateList({ id: "first", name: "지울 목록", items: [item] });
		const keep = saveCandidateList({
			id: "second",
			name: "남길 목록",
			items: [item],
		});
		const { select } = harness();
		open();
		const remove = screen.getByRole("button", {
			name: "지울 목록 저장 목록 삭제",
		});
		fireEvent.click(remove);
		const confirm = screen.getByRole("alertdialog", {
			name: "저장한 목록을 삭제할까요?",
		});
		expect(
			within(confirm).getByText(/현재 방의 후보와 작성 중인 초안은 유지됩니다/),
		).toBeTruthy();
		fireEvent.click(within(confirm).getByRole("button", { name: "취소" }));
		expect(readCandidateLibrary().lists).toHaveLength(2);
		await waitFor(() => expect(document.activeElement).toBe(remove));
		fireEvent.click(remove);
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "저장 목록 삭제",
			}),
		);
		expect(readCandidateLibrary().lists).toEqual([keep]);
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(screen.getByRole("dialog", { name: "목록 불러오기" })).toBeTruthy();
		expect(select).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(
			(
				screen.getByRole("textbox", {
					name: "작성 중인 후보",
				}) as HTMLInputElement
			).value,
		).toBe("입력한 초안");
	});

	it("keeps a failed deletion open for retry and preserves storage until success", () => {
		saveCandidateList({
			id: "first",
			name: "보존할 목록",
			items: [{ id: "one", name: "후보", category: "", included: true }],
		});
		const before = localStorage.getItem(candidateLibraryKey);
		harness();
		open();
		fireEvent.click(
			screen.getByRole("button", { name: "보존할 목록 저장 목록 삭제" }),
		);
		const fail = vi
			.spyOn(Storage.prototype, "setItem")
			.mockImplementation(() => {
				throw new Error("Blocked");
			});
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "저장 목록 삭제",
			}),
		);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain(
			"기존 저장 내용은 유지",
		);
		expect(localStorage.getItem(candidateLibraryKey)).toBe(before);
		fail.mockRestore();
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "저장 목록 삭제",
			}),
		);
		expect(readCandidateLibrary().lists).toEqual([]);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("blocks selecting when locked but lets the user close the dialog", () => {
		const onSelect = vi.fn();
		const onOpenChange = vi.fn();
		render(
			<CandidateListLoadDialog
				open
				onOpenChange={onOpenChange}
				onSelect={onSelect}
				disabled
			/>,
		);
		const source = screen.getByRole("button", { name: /^기본 음식점 목록/ });
		expect(source.matches(":disabled")).toBe(true);
		fireEvent.click(source);
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
