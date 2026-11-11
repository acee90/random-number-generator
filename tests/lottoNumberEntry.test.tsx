// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LottoStrategyControls, {
	type LottoMode,
} from "../src/components/features/LottoStrategyControls";

afterEach(cleanup);

function Harness({
	initialFixed = [],
	initialExcluded = [],
	mode = "fixed",
	disabled = false,
	onFixedChange = vi.fn(),
	onExcludedChange = vi.fn(),
	onSubmit = vi.fn(),
}: {
	initialFixed?: number[];
	initialExcluded?: number[];
	mode?: LottoMode;
	disabled?: boolean;
	onFixedChange?: (numbers: number[]) => void;
	onExcludedChange?: (numbers: number[]) => void;
	onSubmit?: () => void;
}) {
	const [fixed, setFixed] = useState(initialFixed);
	const [excluded, setExcluded] = useState(initialExcluded);
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<LottoStrategyControls
				mode={mode}
				onModeChange={() => {}}
				fixedNumbers={fixed}
				onFixedNumbersChange={(numbers) => {
					onFixedChange(numbers);
					setFixed(numbers);
				}}
				excludedNumbers={excluded}
				onExcludedNumbersChange={(numbers) => {
					onExcludedChange(numbers);
					setExcluded(numbers);
				}}
				spreadRemainder={true}
				onSpreadRemainderChange={() => {}}
				gameCount={5}
				disabled={disabled}
			/>
		</form>
	);
}

function entry(kind: "고정" | "제외") {
	return screen.getByRole("textbox", {
		name: `${kind} 번호 한 번에 추가`,
	}) as HTMLTextAreaElement;
}

function add(kind: "고정" | "제외", text: string) {
	fireEvent.change(entry(kind), { target: { value: text } });
	fireEvent.click(screen.getByRole("button", { name: `${kind} 번호 추가` }));
}

function openExclusions() {
	fireEvent.click(screen.getByText("제외 번호 선택"));
}

describe("bulk Lotto number entry", () => {
	it("adds mixed comma and whitespace input without repeating selected numbers", () => {
		const onFixedChange = vi.fn();
		render(<Harness initialFixed={[21]} onFixedChange={onFixedChange} />);
		add("고정", "7, 2\n7\t21");
		expect(onFixedChange).toHaveBeenCalledExactlyOnceWith([2, 7, 21]);
		expect(entry("고정").value).toBe("");
		expect(screen.getByText("고정 번호 2개를 추가했습니다.")).toBeTruthy();
		expect(document.activeElement).toBe(entry("고정"));
		fireEvent.click(screen.getByRole("button", { name: "2 고정 번호" }));
		expect(onFixedChange).toHaveBeenLastCalledWith([7, 21]);
	});

	it("adds excluded numbers to the current selection and accepts both endpoints", () => {
		const onExcludedChange = vi.fn();
		render(
			<Harness initialExcluded={[3]} onExcludedChange={onExcludedChange} />,
		);
		openExclusions();
		add("제외", "1,3 45\t1");
		expect(onExcludedChange).toHaveBeenCalledExactlyOnceWith([1, 3, 45]);
		expect(entry("제외").value).toBe("");
		expect(screen.getByText("제외 번호 2개를 추가했습니다.")).toBeTruthy();
	});

	it("does not add duplicates or change the original selection", () => {
		const onFixedChange = vi.fn();
		render(<Harness initialFixed={[1, 45]} onFixedChange={onFixedChange} />);
		add("고정", "45, 1, 45");
		expect(onFixedChange).not.toHaveBeenCalled();
		expect(screen.getByText("고정 번호 0개를 추가했습니다.")).toBeTruthy();
		expect(entry("고정").value).toBe("");
	});

	it.each([
		"",
		" \t ",
		"0",
		"46",
		"1.5",
		"1e1",
		"7x",
		"1,2;3",
		"1,-2",
		"+3",
		"0x10",
	])("rejects the entire fixed-number input %j and focuses its linked error", (text) => {
		const onFixedChange = vi.fn();
		render(<Harness initialFixed={[21]} onFixedChange={onFixedChange} />);
		add("고정", text);
		const input = entry("고정");
		expect(onFixedChange).not.toHaveBeenCalled();
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(input);
		const errorId = input.getAttribute("aria-describedby")?.split(" ").at(-1);
		expect(document.getElementById(errorId ?? "")?.textContent).toMatch(
			/입력해 주세요/,
		);
		expect(
			screen
				.getByRole("button", { name: "21 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("rejects an invalid excluded-number entry without applying its valid tokens", () => {
		const onExcludedChange = vi.fn();
		render(
			<Harness initialExcluded={[21]} onExcludedChange={onExcludedChange} />,
		);
		openExclusions();
		add("제외", "2,46");
		expect(onExcludedChange).not.toHaveBeenCalled();
		expect(entry("제외").getAttribute("aria-invalid")).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "2 제외 번호" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("keeps fixed numbers unchanged when any pasted number is excluded", () => {
		const onFixedChange = vi.fn();
		render(
			<Harness
				initialFixed={[21]}
				initialExcluded={[7]}
				onFixedChange={onFixedChange}
			/>,
		);
		add("고정", "2,7");
		expect(onFixedChange).not.toHaveBeenCalled();
		expect(screen.getByText(/7번은 제외 중입니다/)).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "2 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("keeps exclusions unchanged when any pasted number is actively fixed", () => {
		const onExcludedChange = vi.fn();
		render(
			<Harness
				initialFixed={[7]}
				initialExcluded={[21]}
				onExcludedChange={onExcludedChange}
			/>,
		);
		openExclusions();
		add("제외", "2,7");
		expect(onExcludedChange).not.toHaveBeenCalled();
		expect(screen.getByText(/7번은 고정 중입니다/)).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "2 제외 번호" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("uses the same inactive-fixed-number rule as manual exclusion buttons", () => {
		const onExcludedChange = vi.fn();
		render(
			<Harness
				mode="random"
				initialFixed={[7]}
				onExcludedChange={onExcludedChange}
			/>,
		);
		openExclusions();
		add("제외", "7");
		expect(onExcludedChange).toHaveBeenCalledExactlyOnceWith([7]);
	});

	it("preserves the fixed selection if a batch would exceed five numbers", () => {
		const onFixedChange = vi.fn();
		render(
			<Harness initialFixed={[1, 2, 3, 4]} onFixedChange={onFixedChange} />,
		);
		add("고정", "5,6");
		expect(onFixedChange).not.toHaveBeenCalled();
		expect(screen.getByText(/고정 번호는 최대 5개/)).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "5 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("preserves exclusions if a batch would leave fewer than six numbers", () => {
		const onExcludedChange = vi.fn();
		render(
			<Harness
				initialExcluded={Array.from({ length: 38 }, (_, index) => index + 1)}
				onExcludedChange={onExcludedChange}
			/>,
		);
		openExclusions();
		add("제외", "39,40");
		expect(onExcludedChange).not.toHaveBeenCalled();
		expect(screen.getByText(/제외 번호는 최대 39개/)).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "39 제외 번호" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("adds on Enter without submitting the containing draw form", () => {
		const onFixedChange = vi.fn();
		const onSubmit = vi.fn();
		render(<Harness onFixedChange={onFixedChange} onSubmit={onSubmit} />);
		const input = entry("고정");
		fireEvent.change(input, { target: { value: "7,21" } });
		expect(
			fireEvent.keyDown(input, {
				key: "Enter",
				code: "Enter",
				cancelable: true,
			}),
		).toBe(false);
		expect(onFixedChange).toHaveBeenCalledExactlyOnceWith([7, 21]);
		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("clears validation when editing and applies the corrected entry", () => {
		const onFixedChange = vi.fn();
		render(<Harness onFixedChange={onFixedChange} />);
		add("고정", "46");
		fireEvent.change(entry("고정"), { target: { value: "45" } });
		expect(entry("고정").getAttribute("aria-invalid")).toBe("false");
		fireEvent.click(screen.getByRole("button", { name: "고정 번호 추가" }));
		expect(onFixedChange).toHaveBeenCalledExactlyOnceWith([45]);
	});

	it("disables both entries while a draw is running", () => {
		const onFixedChange = vi.fn();
		const onExcludedChange = vi.fn();
		render(
			<Harness
				disabled
				onFixedChange={onFixedChange}
				onExcludedChange={onExcludedChange}
			/>,
		);
		openExclusions();
		for (const kind of ["고정", "제외"] as const) {
			const input = entry(kind);
			const button = screen.getByRole("button", {
				name: `${kind} 번호 추가`,
			}) as HTMLButtonElement;
			expect(input.matches(":disabled")).toBe(true);
			expect(button.disabled).toBe(true);
			fireEvent.change(input, { target: { value: "7" } });
			fireEvent.keyDown(input, { key: "Enter" });
			fireEvent.click(button);
		}
		expect(onFixedChange).not.toHaveBeenCalled();
		expect(onExcludedChange).not.toHaveBeenCalled();
	});
});
