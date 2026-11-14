// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CandidateListEditor from "../src/components/features/CandidateListEditor";
import {
	type CandidateListDraft,
	candidateDraftLimits,
} from "../src/lib/candidateListDraft";

afterEach(cleanup);

function exampleDraft(): CandidateListDraft {
	return {
		id: "office-list",
		name: "팀 점심",
		items: [
			{
				id: "place-1",
				name: "첫 번째 식당",
				category: "한식",
				included: true,
				menu: "김치찌개",
				distanceMeters: 70,
			},
			{
				id: "place-2",
				name: "두 번째 식당",
				category: "분식",
				included: true,
			},
			{
				id: "place-3",
				name: "세 번째 식당",
				category: "샐러드",
				included: false,
			},
		],
	};
}

function edit(initial: CandidateListDraft) {
	const onSave = vi.fn();
	const onChange = vi.fn();
	function ControlledEditor() {
		const [draft, setDraft] = useState(initial);
		return (
			<CandidateListEditor
				draft={draft}
				onChange={(next) => {
					onChange(next);
					setDraft(next);
				}}
				onSave={onSave}
				onCancel={() => {}}
				onImportTemplate={() => {}}
				onImportExcel={() => {}}
			/>
		);
	}
	return { ...render(<ControlledEditor />), onSave, onChange };
}

const save = () =>
	fireEvent.click(screen.getByRole("button", { name: "저장하고 사용" }));

describe("candidate list editor", () => {
	it("edits, includes and removes items without mutating the source or losing item metadata", () => {
		const original = exampleDraft();
		const before = structuredClone(original);
		const { onSave } = edit(original);
		fireEvent.change(screen.getByRole("textbox", { name: "목록 이름" }), {
			target: { value: "  우리 팀 점심  " },
		});
		fireEvent.change(
			screen.getByRole("textbox", { name: /^1번째\s*후보 이름/ }),
			{
				target: { value: "  첫 번째 식당 수정  " },
			},
		);
		fireEvent.change(
			screen.getByRole("textbox", { name: /^1번째\s*분류 \(선택\)/ }),
			{
				target: { value: "  직접 정한 분류  " },
			},
		);
		fireEvent.click(screen.getByRole("checkbox", { name: "3번째 후보 포함" }));
		fireEvent.click(screen.getByRole("button", { name: "2번째 후보 삭제" }));
		save();
		expect(onSave).toHaveBeenCalledExactlyOnceWith({
			id: "office-list",
			name: "우리 팀 점심",
			items: [
				{
					...before.items[0],
					name: "첫 번째 식당 수정",
					category: "직접 정한 분류",
				},
				{ ...before.items[2], included: true },
			],
		});
		expect(original).toEqual(before);
	});

	it("keeps separate candidates with the same name and allows an empty optional category", () => {
		const draft = exampleDraft();
		draft.items = draft.items.slice(0, 2);
		const { onSave } = edit(draft);
		fireEvent.change(
			screen.getByRole("textbox", { name: /^2번째\s*후보 이름/ }),
			{
				target: { value: draft.items[0].name },
			},
		);
		fireEvent.change(
			screen.getByRole("textbox", { name: /^2번째\s*분류 \(선택\)/ }),
			{
				target: { value: "" },
			},
		);
		save();
		expect(onSave).toHaveBeenCalledOnce();
		const saved = onSave.mock.calls[0][0] as CandidateListDraft;
		expect(saved.items.map((item) => item.id)).toEqual(["place-1", "place-2"]);
		expect(saved.items.map((item) => item.name)).toEqual([
			draft.items[0].name,
			draft.items[0].name,
		]);
		expect(saved.items[1].category).toBe("");
	});

	it("focuses each invalid field and saves only after the name, item and inclusion problems are corrected", () => {
		const draft = exampleDraft();
		draft.name = "  ";
		draft.items[0].name = " ";
		draft.items[1].included = false;
		const { onSave } = edit(draft);
		const saveButton = screen.getByRole("button", { name: "저장하고 사용" });
		expect(saveButton.matches(":disabled")).toBe(false);
		save();
		const name = screen.getByRole("textbox", { name: "목록 이름" });
		expect(document.activeElement).toBe(name);
		expect(name.getAttribute("aria-invalid")).toBe("true");
		expect(onSave).not.toHaveBeenCalled();
		fireEvent.change(name, { target: { value: "새 목록" } });
		save();
		const first = screen.getByRole("textbox", { name: /^1번째\s*후보 이름/ });
		expect(document.activeElement).toBe(first);
		expect(first.getAttribute("aria-invalid")).toBe("true");
		fireEvent.change(first, { target: { value: "새 식당" } });
		save();
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "후보 편집" }),
		);
		expect(
			screen.getByText("추첨할 후보를 2개 이상 포함해 주세요."),
		).toBeTruthy();
		expect(onSave).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("checkbox", { name: "2번째 후보 포함" }));
		save();
		expect(onSave).toHaveBeenCalledOnce();
	});

	it("retains imported text that exceeds limits and focuses the fields that need correction", () => {
		const draft = exampleDraft();
		const longName = "가".repeat(candidateDraftLimits.itemName + 1);
		draft.items[0].name = longName;
		draft.items[1].category = "나".repeat(candidateDraftLimits.category + 1);
		const { onSave } = edit(draft);
		save();
		const first = screen.getByRole("textbox", {
			name: /^1번째\s*후보 이름/,
		}) as HTMLInputElement;
		expect(document.activeElement).toBe(first);
		expect(first.value).toBe(longName);
		fireEvent.change(first, { target: { value: "수정한 식당" } });
		save();
		const category = screen.getByRole("textbox", {
			name: /^2번째\s*분류 \(선택\)/,
		});
		expect(document.activeElement).toBe(category);
		expect(category.getAttribute("aria-invalid")).toBe("true");
		expect(onSave).not.toHaveBeenCalled();
		fireEvent.change(category, { target: { value: "분식" } });
		save();
		expect(onSave).toHaveBeenCalledOnce();
	});

	it("focuses a newly added candidate and keeps keyboard focus usable after deleting rows", () => {
		const draft = exampleDraft();
		draft.items = draft.items.slice(0, 2);
		const { onChange } = edit(draft);
		fireEvent.click(screen.getByRole("button", { name: "후보 추가" }));
		const added = screen.getByRole("textbox", { name: /^3번째\s*후보 이름/ });
		expect(document.activeElement).toBe(added);
		const next = onChange.mock.lastCall?.[0] as CandidateListDraft;
		expect(next.items).toHaveLength(3);
		expect(new Set(next.items.map((item) => item.id)).size).toBe(3);
		const remove = screen.getByRole("button", { name: "2번째 후보 삭제" });
		remove.focus();
		fireEvent.click(remove);
		expect(document.activeElement).toBe(
			screen.getByRole("textbox", { name: /^2번째\s*후보 이름/ }),
		);
		fireEvent.click(screen.getByRole("button", { name: "2번째 후보 삭제" }));
		fireEvent.click(screen.getByRole("button", { name: "1번째 후보 삭제" }));
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "후보 추가" }),
		);
		expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
	});

	it("announces a failed save without clearing the draft", () => {
		const draft = exampleDraft();
		const props = {
			draft,
			onChange: vi.fn(),
			onSave: vi.fn(),
			onCancel: vi.fn(),
			onImportTemplate: vi.fn(),
			onImportExcel: vi.fn(),
		};
		const view = render(<CandidateListEditor {...props} />);
		save();
		view.rerender(
			<CandidateListEditor
				{...props}
				error="이 브라우저에 목록을 저장할 수 없습니다."
			/>,
		);
		const message = screen.getByText(
			"이 브라우저에 목록을 저장할 수 없습니다.",
		);
		expect(message.getAttribute("role")).toBe("alert");
		expect(document.activeElement).toBe(message);
		expect(
			(screen.getByRole("textbox", { name: "목록 이름" }) as HTMLInputElement)
				.value,
		).toBe(draft.name);
		expect(
			(
				screen.getByRole("textbox", {
					name: /^1번째\s*후보 이름/,
				}) as HTMLInputElement
			).value,
		).toBe(draft.items[0].name);
	});

	it("disables a locked editor without announcing an in-flight request", () => {
		const onSave = vi.fn();
		render(
			<CandidateListEditor
				draft={exampleDraft()}
				onChange={vi.fn()}
				onSave={onSave}
				onCancel={vi.fn()}
				onImportTemplate={vi.fn()}
				onImportExcel={vi.fn()}
				disabled
			/>,
		);
		const form = screen.getByRole("form", { name: "후보 목록 편집" });
		const submit = screen.getByRole("button", { name: "저장하고 사용" });
		expect(form.getAttribute("aria-busy")).toBe("false");
		expect(submit.getAttribute("aria-busy")).toBe("false");
		for (const control of [
			...screen.getAllByRole("textbox"),
			...screen.getAllByRole("checkbox"),
			...screen.getAllByRole("button"),
		]) {
			expect(control.matches(":disabled")).toBe(true);
		}
		fireEvent.submit(form);
		expect(onSave).not.toHaveBeenCalled();
	});

	it("disables every control while pending without replacing the submit label or draft", () => {
		const draft = exampleDraft();
		const props = {
			draft,
			onChange: vi.fn(),
			onSave: vi.fn(),
			onCancel: vi.fn(),
			onImportTemplate: vi.fn(),
			onImportExcel: vi.fn(),
			submitLabel: "후보 적용",
		};
		const view = render(<CandidateListEditor {...props} />);
		const form = screen.getByRole("form", { name: "후보 목록 편집" });
		const submit = screen.getByRole("button", { name: "후보 적용" });
		const name = screen.getByRole("textbox", {
			name: "목록 이름",
		}) as HTMLInputElement;
		expect(submit.matches(":disabled")).toBe(false);
		view.rerender(<CandidateListEditor {...props} pending />);
		expect(form.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("button", { name: "후보 적용" })).toBe(submit);
		expect(submit.getAttribute("aria-busy")).toBe("true");
		for (const control of [
			...screen.getAllByRole("textbox"),
			...screen.getAllByRole("checkbox"),
			...screen.getAllByRole("button"),
		]) {
			expect(control.matches(":disabled")).toBe(true);
		}
		fireEvent.click(submit);
		fireEvent.submit(form);
		expect(props.onSave).not.toHaveBeenCalled();
		expect(name.value).toBe(draft.name);
		view.rerender(<CandidateListEditor {...props} />);
		expect(submit.matches(":disabled")).toBe(false);
		expect(form.getAttribute("aria-busy")).toBe("false");
		expect(screen.getByRole("button", { name: "후보 적용" })).toBe(submit);
	});
});
