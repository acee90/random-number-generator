// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import Cookies from "js-cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RandomGenerator from "../src/components/features/RandomGenerator";
import { lotterySettingsKey } from "../src/lib/lotterySettings";
import {
	generateLotteryNumbers,
	generateRandomNumbers,
} from "../src/services/randomService";

vi.mock("../src/services/randomService", () => ({
	generateLotteryNumbers: vi.fn(async ({ data }) => ({
		tickets: Array.from({ length: data.count }, (_, index) => ({
			numbers: [1, 2, 3, 4, 5, 6],
			...(data.kind === "pension" ? { group: index + 1 } : {}),
		})),
		source: "csprng",
	})),
	generateRandomNumbers: vi.fn(),
	getSourceDisplayName: () => "Web Crypto (CSPRNG)",
}));

beforeEach(() => {
	localStorage.clear();
	vi.mocked(generateLotteryNumbers).mockClear();
	vi.mocked(generateRandomNumbers).mockClear();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false })),
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		},
	);
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	Cookies.remove("rng_settings");
	Cookies.remove("rng_history");
});

function openTool(name: "로또 6/45" | "연금복권 720+") {
	fireEvent.click(
		screen.getByRole("button", {
			name: new RegExp(name.replace(/[+]/g, "\\+")),
		}),
	);
}

function gameButton(count: number) {
	return within(
		screen.getByRole("group", { name: "추첨할 게임 수" }),
	).getByRole("button", {
		name: new RegExp(`^${count}\\s*게임$`),
	});
}

function selectedGroup() {
	return within(screen.getByRole("combobox", { name: "조 선택" }))
		.getByRole("option", { selected: true })
		.getAttribute("value");
}

describe("lottery game counts", () => {
	it("keeps the selected game count independently when switching tools", () => {
		render(<RandomGenerator />);
		openTool("로또 6/45");
		fireEvent.click(gameButton(3));
		openTool("연금복권 720+");
		expect(gameButton(1).getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(gameButton(2));
		openTool("로또 6/45");
		expect(gameButton(3).getAttribute("aria-pressed")).toBe("true");
		openTool("연금복권 720+");
		expect(gameButton(2).getAttribute("aria-pressed")).toBe("true");
	});

	it("keeps all-group pension draws at five without changing the lotto count", async () => {
		render(<RandomGenerator />);
		openTool("로또 6/45");
		fireEvent.click(gameButton(3));
		openTool("연금복권 720+");
		fireEvent.change(screen.getByRole("combobox", { name: "조 선택" }), {
			target: { value: "all" },
		});
		expect(gameButton(5).getAttribute("aria-pressed")).toBe("true");
		expect((gameButton(5) as HTMLButtonElement).matches(":disabled")).toBe(
			true,
		);
		openTool("로또 6/45");
		expect(gameButton(3).getAttribute("aria-pressed")).toBe("true");
		openTool("연금복권 720+");
		expect(gameButton(5).getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "번호 뽑기" }));
		await waitFor(() =>
			expect(generateLotteryNumbers).toHaveBeenCalledWith({
				data: { kind: "pension", count: 5, group: "all" },
			}),
		);
		await screen.findByRole("button", { name: "전체 번호 복사" });
		openTool("로또 6/45");
		fireEvent.click(screen.getByRole("button", { name: "번호 뽑기" }));
		await waitFor(() =>
			expect(generateLotteryNumbers).toHaveBeenLastCalledWith({
				data: expect.objectContaining({ kind: "lotto", count: 3 }),
			}),
		);
		await screen.findByRole("button", { name: "전체 번호 복사" });
	});
});

describe("lottery settings persistence", () => {
	it("restores both tools, fixed and excluded numbers, and the remainder setting after remounting", () => {
		const firstVisit = render(<RandomGenerator />);
		openTool("로또 6/45");
		fireEvent.click(gameButton(3));
		fireEvent.click(screen.getByRole("radio", { name: /^번호 고정/ }));
		fireEvent.click(screen.getByRole("button", { name: "7 고정 번호" }));
		fireEvent.click(screen.getByRole("button", { name: "21 고정 번호" }));
		fireEvent.click(screen.getByText("제외 번호 선택"));
		fireEvent.click(screen.getByRole("button", { name: "3 제외 번호" }));
		fireEvent.click(screen.getByRole("button", { name: "45 제외 번호" }));
		fireEvent.click(
			screen.getByRole("checkbox", { name: /^나머지 번호는 게임 간/ }),
		);
		openTool("연금복권 720+");
		fireEvent.click(gameButton(2));
		fireEvent.change(screen.getByRole("combobox", { name: "조 선택" }), {
			target: { value: "4" },
		});
		firstVisit.unmount();

		render(<RandomGenerator />);
		openTool("로또 6/45");
		expect(gameButton(3).getAttribute("aria-pressed")).toBe("true");
		expect(
			(screen.getByRole("radio", { name: /^번호 고정/ }) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "7 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "21 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		fireEvent.click(screen.getByText("제외 번호 선택"));
		expect(
			screen
				.getByRole("button", { name: "3 제외 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "45 제외 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			(
				screen.getByRole("checkbox", {
					name: /^나머지 번호는 게임 간/,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		openTool("연금복권 720+");
		expect(gameButton(2).getAttribute("aria-pressed")).toBe("true");
		expect(selectedGroup()).toBe("4");
	});

	it("restores all-group pension settings as five games while keeping the lotto count", () => {
		localStorage.setItem(
			lotterySettingsKey,
			JSON.stringify({
				lottoGameCount: 3,
				pensionGameCount: 2,
				group: "all",
				lottoMode: "random",
				fixedNumbers: [],
				excludedNumbers: [],
				spreadRemainder: true,
			}),
		);
		render(<RandomGenerator />);
		openTool("연금복권 720+");
		expect(gameButton(5).getAttribute("aria-pressed")).toBe("true");
		expect((gameButton(5) as HTMLButtonElement).matches(":disabled")).toBe(
			true,
		);
		openTool("로또 6/45");
		expect(gameButton(3).getAttribute("aria-pressed")).toBe("true");
		expect(
			JSON.parse(localStorage.getItem(lotterySettingsKey) ?? "{}")
				.pensionGameCount,
		).toBe(5);
	});

	it.each([
		"{",
		JSON.stringify({ lottoGameCount: 99 }),
	])("recovers corrupt lottery settings without changing valid integer settings: %s", (stored) => {
		localStorage.setItem(lotterySettingsKey, stored);
		localStorage.setItem(
			"randomlab.settings",
			JSON.stringify({ min: "12", max: "30", count: 2 }),
		);
		render(<RandomGenerator />);
		expect(
			(screen.getByRole("spinbutton", { name: "최소값" }) as HTMLInputElement)
				.value,
		).toBe("12");
		expect(
			screen.getByText(
				"저장된 복권 설정을 읽지 못해 복권 설정은 기본값으로 시작합니다.",
			),
		).toBeTruthy();
		openTool("로또 6/45");
		expect(gameButton(1).getAttribute("aria-pressed")).toBe("true");
		expect(
			(screen.getByRole("radio", { name: /^일반 랜덤/ }) as HTMLInputElement)
				.checked,
		).toBe(true);
		openTool("연금복권 720+");
		expect(gameButton(1).getAttribute("aria-pressed")).toBe("true");
		expect(selectedGroup()).toBe("random");
	});

	it("preserves an insufficient spread selection and shows its existing constraint message", () => {
		localStorage.setItem(
			lotterySettingsKey,
			JSON.stringify({
				lottoGameCount: 5,
				pensionGameCount: 1,
				group: "random",
				lottoMode: "spread",
				fixedNumbers: [],
				excludedNumbers: Array.from({ length: 39 }, (_, index) => index + 1),
				spreadRemainder: true,
			}),
		);
		render(<RandomGenerator />);
		openTool("로또 6/45");
		expect(gameButton(5).getAttribute("aria-pressed")).toBe("true");
		expect(
			(screen.getByRole("radio", { name: /^번호 분산/ }) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(screen.getByText("39개 제외")).toBeTruthy();
		expect(screen.getByText(/분산 추첨에 필요한 번호는 30개인데/)).toBeTruthy();
		expect(screen.queryByText(/저장된 복권 설정을 읽지 못해/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "번호 뽑기" }));
		expect(generateLotteryNumbers).not.toHaveBeenCalled();
	});

	it("keeps lottery defaults when the key is absent and still migrates legacy integer settings and history", () => {
		Cookies.set(
			"rng_settings",
			JSON.stringify({ min: "12", max: "30", count: 2 }),
		);
		Cookies.set(
			"rng_history",
			JSON.stringify([
				{ id: "old", numbers: [12, 15], timestamp: 1, source: "csprng" },
			]),
		);
		render(<RandomGenerator />);
		expect(
			(screen.getByRole("spinbutton", { name: "최소값" }) as HTMLInputElement)
				.value,
		).toBe("12");
		expect(
			JSON.parse(localStorage.getItem("randomlab.history") ?? "[]")[0],
		).toMatchObject({ kind: "number", rows: [{ numbers: [12, 15] }] });
		expect(Cookies.get("rng_settings")).toBeUndefined();
		expect(Cookies.get("rng_history")).toBeUndefined();
		openTool("로또 6/45");
		expect(gameButton(1).getAttribute("aria-pressed")).toBe("true");
		openTool("연금복권 720+");
		expect(gameButton(1).getAttribute("aria-pressed")).toBe("true");
		expect(selectedGroup()).toBe("random");
	});

	it("does not rewrite history while changing either tool's settings", () => {
		const write = vi.spyOn(Storage.prototype, "setItem");
		render(<RandomGenerator />);
		write.mockClear();
		fireEvent.change(screen.getByRole("spinbutton", { name: "최소값" }), {
			target: { value: "2" },
		});
		fireEvent.change(screen.getByRole("spinbutton", { name: "최대값" }), {
			target: { value: "50" },
		});
		expect(write.mock.calls.map(([key]) => key)).toEqual([
			"randomlab.settings",
			"randomlab.settings",
		]);
		write.mockClear();
		openTool("로또 6/45");
		fireEvent.click(gameButton(3));
		expect(write.mock.calls.map(([key]) => key)).toEqual([lotterySettingsKey]);
	});
});

type NumberField = "min" | "max" | "count";

function numberInput(field: NumberField) {
	return screen.getByRole("spinbutton", {
		name: { min: "최소값", max: "최대값", count: "생성 개수" }[field],
	});
}

function submitNumbers() {
	fireEvent.click(screen.getByRole("button", { name: "숫자 생성하기" }));
}

describe("integer condition validation", () => {
	it.each([
		{
			label: "blank minimum",
			min: "",
			max: "100",
			count: "1",
			fields: ["min"],
		},
		{ label: "blank maximum", min: "1", max: "", count: "1", fields: ["max"] },
		{
			label: "both bounds blank",
			min: "",
			max: "",
			count: "1",
			fields: ["min", "max"],
		},
		{
			label: "fractional minimum",
			min: "1.5",
			max: "100",
			count: "1",
			fields: ["min"],
		},
		{
			label: "fractional maximum",
			min: "1",
			max: "100.5",
			count: "1",
			fields: ["max"],
		},
		{
			label: "unsafe minimum",
			min: "-9007199254740992",
			max: "100",
			count: "1",
			fields: ["min"],
		},
		{
			label: "unsafe maximum",
			min: "1",
			max: "9007199254740992",
			count: "1",
			fields: ["max"],
		},
		{
			label: "unsafe range",
			min: "-9007199254740991",
			max: "9007199254740991",
			count: "1",
			fields: ["min", "max"],
		},
		{
			label: "maximum below minimum",
			min: "10",
			max: "1",
			count: "1",
			fields: ["max"],
		},
		{
			label: "zero count",
			min: "1",
			max: "100",
			count: "0",
			fields: ["count"],
		},
		{
			label: "excessive count",
			min: "1",
			max: "1000",
			count: "101",
			fields: ["count"],
		},
		{
			label: "fractional count",
			min: "1",
			max: "100",
			count: "1.5",
			fields: ["count"],
		},
		{
			label: "insufficient unique numbers",
			min: "1",
			max: "2",
			count: "3",
			fields: ["count"],
		},
	] as const)("links $label to its correction field without requesting entropy", ({
		min,
		max,
		count,
		fields,
	}) => {
		render(<RandomGenerator />);
		fireEvent.change(numberInput("min"), { target: { value: min } });
		fireEvent.change(numberInput("max"), { target: { value: max } });
		fireEvent.change(numberInput("count"), { target: { value: count } });
		expect(screen.queryByRole("alert")).toBeNull();
		submitNumbers();
		const message = screen.getByRole("alert");
		for (const field of ["min", "max", "count"] as const) {
			const invalid = (fields as readonly NumberField[]).includes(field);
			expect(numberInput(field).getAttribute("aria-invalid")).toBe(
				invalid ? "true" : null,
			);
			expect(numberInput(field).getAttribute("aria-describedby")).toBe(
				invalid ? message.id : null,
			);
		}
		expect(document.activeElement).toBe(numberInput(fields[0]));
		expect(generateRandomNumbers).not.toHaveBeenCalled();
	});

	it("clears a stale error and field annotations when the conditions are edited", () => {
		render(<RandomGenerator />);
		fireEvent.change(numberInput("min"), { target: { value: "10" } });
		fireEvent.change(numberInput("max"), { target: { value: "1" } });
		submitNumbers();
		expect(document.activeElement).toBe(numberInput("max"));
		fireEvent.change(numberInput("max"), { target: { value: "100" } });
		expect(screen.queryByRole("alert")).toBeNull();
		expect(numberInput("max").getAttribute("aria-invalid")).toBeNull();
		expect(numberInput("max").getAttribute("aria-describedby")).toBeNull();
		expect(generateRandomNumbers).not.toHaveBeenCalled();
	});

	it("clears field errors when an example is applied", () => {
		render(<RandomGenerator />);
		fireEvent.change(numberInput("min"), { target: { value: "" } });
		submitNumbers();
		fireEvent.click(screen.getByRole("button", { name: /^발표자 1명 선정/ }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(numberInput("min").getAttribute("aria-invalid")).toBeNull();
		expect(numberInput("min").getAttribute("aria-describedby")).toBeNull();
	});

	it("clears the count error when duplicates are allowed and submits the valid condition", async () => {
		vi.mocked(generateRandomNumbers).mockResolvedValueOnce({
			numbers: [1, 1, 2],
			source: "csprng",
		});
		render(<RandomGenerator />);
		fireEvent.change(numberInput("max"), { target: { value: "2" } });
		fireEvent.change(numberInput("count"), { target: { value: "3" } });
		submitNumbers();
		expect(document.activeElement).toBe(numberInput("count"));
		fireEvent.click(screen.getByRole("switch", { name: /^중복 허용/ }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(numberInput("count").getAttribute("aria-invalid")).toBeNull();
		submitNumbers();
		await waitFor(() =>
			expect(generateRandomNumbers).toHaveBeenCalledWith({
				data: { min: 1, max: 2, count: 3, unique: false },
			}),
		);
		await screen.findByRole("button", { name: "전체 결과 복사" });
	});

	it("does not leave an old integer field marked after switching tools", () => {
		render(<RandomGenerator />);
		fireEvent.change(numberInput("max"), { target: { value: "0" } });
		submitNumbers();
		openTool("로또 6/45");
		fireEvent.click(screen.getByRole("button", { name: /랜덤 숫자/ }));
		expect(screen.queryByRole("alert")).toBeNull();
		expect(numberInput("max").getAttribute("aria-invalid")).toBeNull();
		expect(numberInput("max").getAttribute("aria-describedby")).toBeNull();
	});
});
