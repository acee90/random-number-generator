// @vitest-environment jsdom

import {
	act,
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
	getSourceDisplayName,
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
	getSourceDisplayName: vi.fn(() => "Web Crypto (CSPRNG)"),
}));

beforeEach(() => {
	localStorage.clear();
	vi.mocked(generateLotteryNumbers).mockClear();
	vi.mocked(generateRandomNumbers).mockClear();
	vi.mocked(getSourceDisplayName).mockClear();
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
		within(screen.getByRole("navigation", { name: "생성 도구" })).getByRole(
			"button",
			{
				name: new RegExp(name.replace(/[+]/g, "\\+")),
			},
		),
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
		const fixedSelection = within(
			screen.getByRole("group", { name: "고정 번호 선택" }),
		);
		fireEvent.click(
			fixedSelection.getByRole("button", { name: "7 고정 번호" }),
		);
		fireEvent.click(
			fixedSelection.getByRole("button", { name: "21 고정 번호" }),
		);
		fireEvent.click(screen.getByText("제외 번호 선택"));
		const excludedSelection = within(
			screen.getByRole("group", { name: "추첨에서 제외할 번호" }),
		);
		fireEvent.click(
			excludedSelection.getByRole("button", { name: "3 제외 번호" }),
		);
		fireEvent.click(
			excludedSelection.getByRole("button", { name: "45 제외 번호" }),
		);
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
			within(screen.getByRole("group", { name: "고정 번호 선택" }))
				.getByRole("button", { name: "7 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			within(screen.getByRole("group", { name: "고정 번호 선택" }))
				.getByRole("button", { name: "21 고정 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		fireEvent.click(screen.getByText("제외 번호 선택"));
		expect(
			within(screen.getByRole("group", { name: "추첨에서 제외할 번호" }))
				.getByRole("button", { name: "3 제외 번호" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			within(screen.getByRole("group", { name: "추첨에서 제외할 번호" }))
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
		expect(
			screen.getByRole("button", { name: "1번째 숫자 12 복사" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "2번째 숫자 15 복사" }),
		).toBeTruthy();
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

const savedResultTime = Date.UTC(2026, 0, 2, 3, 4);
const savedResults = [
	{
		id: "number-older",
		kind: "number",
		rows: [{ numbers: [11] }],
		source: "csprng",
		timestamp: savedResultTime - 1_000,
	},
	{
		id: "lotto-latest",
		kind: "lotto",
		rows: [{ numbers: [7, 8, 21, 30, 35, 45] }],
		source: "quantum",
		timestamp: savedResultTime + 1_000,
		lottoOptions: {
			mode: "fixed",
			fixedNumbers: [7, 21],
			excludedNumbers: [4],
			spreadRemainder: true,
		},
	},
	{
		id: "pension-older",
		kind: "pension",
		rows: [{ numbers: [1, 2, 3, 4, 5, 6], group: 2 }],
		source: "csprng",
		timestamp: savedResultTime - 3_000,
	},
	{
		id: "number-latest",
		kind: "number",
		rows: [{ numbers: [42, 99] }],
		source: "mixed",
		timestamp: savedResultTime,
	},
	{
		id: "pension-latest",
		kind: "pension",
		rows: [{ numbers: [0, 8, 7, 6, 5, 4], group: 5 }],
		source: "atmospheric",
		timestamp: savedResultTime + 2_000,
	},
	{
		id: "lotto-older",
		kind: "lotto",
		rows: [{ numbers: [1, 2, 3, 4, 5, 6] }],
		source: "csprng",
		timestamp: savedResultTime - 2_000,
	},
];

function currentResult() {
	const panel = document.querySelector<HTMLElement>(".result-panel");
	if (!panel) throw new Error("Result panel is missing");
	return panel;
}

function olderResultText() {
	return screen
		.getByRole("region", { name: "이전 추첨 기록" })
		.querySelector(".history-numbers")?.textContent;
}

describe("latest result restoration", () => {
	it("restores the newest result for each tool without another draw and keeps older results separate", () => {
		localStorage.setItem("randomlab.history", JSON.stringify(savedResults));
		render(<RandomGenerator />);
		expect(within(currentResult()).getByText("마지막 추첨 결과")).toBeTruthy();
		expect(
			Array.from(currentResult().querySelectorAll(".number-value")).map(
				(el) => el.textContent,
			),
		).toEqual(["42", "99"]);
		expect(olderResultText()).toBe("11");
		expect(within(currentResult()).getByText(/2026.*01.*02/)).toBeTruthy();

		openTool("로또 6/45");
		expect(within(currentResult()).getByText("마지막 추첨 결과")).toBeTruthy();
		expect(
			Array.from(currentResult().querySelectorAll(".lotto-ball")).map(
				(el) => el.childNodes[0].textContent,
			),
		).toEqual(["7", "8", "21", "30", "35", "45"]);
		expect(currentResult().textContent).toContain(
			"번호 고정: 7, 21 · 나머지 번호 분산 · 제외: 4",
		);
		expect(olderResultText()).toBe("A1, 2, 3, 4, 5, 6번호 복사");
		expect(vi.mocked(getSourceDisplayName)).toHaveBeenCalledWith("quantum");
		expect(within(currentResult()).getByText(/2026.*01.*02/)).toBeTruthy();

		openTool("연금복권 720+");
		expect(within(currentResult()).getByText("마지막 추첨 결과")).toBeTruthy();
		expect(currentResult().querySelector(".pension-digits")?.textContent).toBe(
			"087654",
		);
		expect(currentResult().querySelector(".pension-group")?.textContent).toBe(
			"5조",
		);
		expect(olderResultText()).toBe("A2조 123456번호 복사");
		expect(vi.mocked(getSourceDisplayName)).toHaveBeenCalledWith("atmospheric");
		expect(within(currentResult()).getByText(/2026.*01.*02/)).toBeTruthy();
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		expect(generateLotteryNumbers).not.toHaveBeenCalled();
		expect(
			JSON.parse(localStorage.getItem("randomlab.history") ?? "[]"),
		).toEqual(savedResults);
	});

	it("replaces the restored label only after a new draw and retains the old result in history", async () => {
		const saved = savedResults.find((item) => item.id === "number-latest");
		localStorage.setItem("randomlab.history", JSON.stringify([saved]));
		vi.mocked(generateRandomNumbers).mockResolvedValueOnce({
			numbers: [88],
			source: "csprng",
		});
		render(<RandomGenerator />);
		expect(within(currentResult()).getByText("마지막 추첨 결과")).toBeTruthy();
		submitNumbers();
		await screen.findByRole("button", { name: "1번째 숫자 88 복사" });
		expect(within(currentResult()).getByText("이번 추첨 결과")).toBeTruthy();
		expect(within(currentResult()).queryByText("마지막 추첨 결과")).toBeNull();
		expect(olderResultText()).toBe("42, 99");
		const persisted = JSON.parse(
			localStorage.getItem("randomlab.history") ?? "[]",
		);
		expect(persisted[0]).toMatchObject({
			rows: [{ numbers: [88] }],
			source: "csprng",
		});
		expect(persisted[0].timestamp).toBeGreaterThan(savedResultTime);
		expect(persisted[1]).toEqual(saved);
	});

	it("keeps the restored current result while clearing and undoing older history", () => {
		const history = savedResults.filter((item) => item.kind === "number");
		localStorage.setItem("randomlab.history", JSON.stringify(history));
		render(<RandomGenerator />);
		fireEvent.click(screen.getByRole("button", { name: "기록 지우기" }));
		expect(within(currentResult()).getByText("마지막 추첨 결과")).toBeTruthy();
		expect(
			within(currentResult()).getByRole("button", {
				name: "1번째 숫자 42 복사",
			}),
		).toBeTruthy();
		expect(olderResultText()).toBeUndefined();
		expect(
			JSON.parse(localStorage.getItem("randomlab.history") ?? "[]"),
		).toEqual([history.find((item) => item.id === "number-latest")]);
		fireEvent.click(screen.getByRole("button", { name: "삭제 취소" }));
		expect(olderResultText()).toBe("11");
		expect(
			within(currentResult()).getByRole("button", {
				name: "1번째 숫자 42 복사",
			}),
		).toBeTruthy();
		expect(
			JSON.parse(localStorage.getItem("randomlab.history") ?? "[]"),
		).toEqual(history);
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		expect(generateLotteryNumbers).not.toHaveBeenCalled();
	});

	it.each([
		"{",
		JSON.stringify({ invalid: "history" }),
	])("preserves malformed history without inventing a current result: %s", (stored) => {
		localStorage.setItem("randomlab.history", stored);
		render(<RandomGenerator />);
		expect(within(currentResult()).queryByText("마지막 추첨 결과")).toBeNull();
		expect(
			within(currentResult()).getByText("생성한 숫자가 여기에 표시됩니다."),
		).toBeTruthy();
		expect(localStorage.getItem("randomlab.history")).toBe(stored);
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		expect(generateLotteryNumbers).not.toHaveBeenCalled();
	});

	it("does not promote a malformed newer record over a valid saved result", () => {
		const saved = savedResults.find((item) => item.id === "number-latest");
		localStorage.setItem(
			"randomlab.history",
			JSON.stringify([
				{
					...saved,
					id: "invalid-newer",
					timestamp: savedResultTime + 10_000,
					rows: [{ numbers: [1.5] }],
				},
				saved,
			]),
		);
		render(<RandomGenerator />);
		expect(within(currentResult()).getByText("마지막 추첨 결과")).toBeTruthy();
		expect(
			Array.from(currentResult().querySelectorAll(".number-value")).map(
				(el) => el.textContent,
			),
		).toEqual(["42", "99"]);
		expect(
			JSON.parse(localStorage.getItem("randomlab.history") ?? "[]"),
		).toEqual([saved]);
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		expect(generateLotteryNumbers).not.toHaveBeenCalled();
	});
});

describe("manual copy fallback", () => {
	const writeText = vi.fn<(text: string) => Promise<void>>();
	let originalClipboard: PropertyDescriptor | undefined;

	beforeEach(() => {
		originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		writeText.mockReset().mockRejectedValue(new Error("Clipboard unavailable"));
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText },
		});
	});

	afterEach(() => {
		if (originalClipboard)
			Object.defineProperty(navigator, "clipboard", originalClipboard);
		else Reflect.deleteProperty(navigator, "clipboard");
	});

	const cases = [
		{ kind: "number", location: "current", action: "item", expected: "-12" },
		{
			kind: "number",
			location: "current",
			action: "whole",
			expected: "-12, 0",
		},
		{
			kind: "lotto",
			location: "current",
			action: "row",
			expected: "7, 8, 21, 30, 35, 45",
		},
		{
			kind: "lotto",
			location: "current",
			action: "whole",
			expected: "7, 8, 21, 30, 35, 45\n7, 10, 21, 31, 33, 41",
		},
		{ kind: "pension", location: "current", action: "row", expected: "000014" },
		{
			kind: "pension",
			location: "current",
			action: "whole",
			expected: "3조 000014\n5조 001205",
		},
		{
			kind: "number",
			location: "history",
			action: "whole",
			expected: "-12, 0",
		},
		{
			kind: "lotto",
			location: "history",
			action: "row",
			expected: "7, 8, 21, 30, 35, 45",
		},
		{ kind: "pension", location: "history", action: "row", expected: "000014" },
		{
			kind: "pension",
			location: "history",
			action: "whole",
			expected: "3조 000014\n5조 001205",
		},
	] as const;

	function seedCopyResults(
		kind: "number" | "lotto" | "pension",
		location: "current" | "history",
	) {
		const rows =
			kind === "number"
				? [{ numbers: [-12, 0] }]
				: kind === "lotto"
					? [
							{ numbers: [7, 8, 21, 30, 35, 45] },
							{ numbers: [7, 10, 21, 31, 33, 41] },
						]
					: [
							{ group: 3, numbers: [0, 0, 0, 0, 1, 4] },
							{ group: 5, numbers: [0, 0, 1, 2, 0, 5] },
						];
		const target = {
			id: location === "current" ? "same-prefix" : "same-prefix-row-0",
			kind,
			rows,
			source: "csprng",
			timestamp: savedResultTime,
		};
		const latest = {
			...target,
			id: "same-prefix",
			timestamp: savedResultTime + 1_000,
		};
		localStorage.setItem(
			"randomlab.history",
			JSON.stringify(location === "current" ? [target] : [latest, target]),
		);
		render(<RandomGenerator />);
		if (kind !== "number")
			openTool(kind === "lotto" ? "로또 6/45" : "연금복권 720+");
		const owner =
			location === "current"
				? currentResult()
				: screen
						.getByRole("region", { name: "이전 추첨 기록" })
						.querySelector<HTMLElement>(".history-item");
		if (!owner) throw new Error("Copy source is missing");
		return owner;
	}

	async function selectedFallback(expected: string) {
		const field = await screen.findByRole("textbox", { name: "복사할 결과" });
		if (!(field instanceof HTMLTextAreaElement))
			throw new Error("Copy field is not a textarea");
		expect(field.value).toBe(expected);
		expect(field.readOnly).toBe(true);
		expect(document.activeElement).toBe(field);
		expect(field.selectionStart).toBe(0);
		expect(field.selectionEnd).toBe(expected.length);
		return field;
	}

	function inputErrors() {
		const form = document.querySelector<HTMLElement>("form.controls");
		if (!form) throw new Error("Conditions form is missing");
		return within(form);
	}

	it.each(
		cases,
	)("offers the exact $kind $location $action text at its source", async ({
		kind,
		location,
		action,
		expected,
	}) => {
		const owner = seedCopyResults(kind, location);
		const source = within(owner);
		const trigger =
			action === "item"
				? source.getByRole("button", { name: "1번째 숫자 -12 복사" })
				: action === "row"
					? source.getByRole("button", {
							name: new RegExp(
								`^${location === "history" ? "이전 " : ""}A게임 ${kind === "pension" ? "여섯 자리 " : ""}번호 복사$`,
							),
						})
					: source.getByRole("button", {
							name:
								location === "history"
									? /생성 결과 전체 복사$/
									: kind === "number"
										? "전체 결과 복사"
										: "전체 번호 복사",
						});
		fireEvent.click(trigger);
		const field = await selectedFallback(expected);
		expect(owner.contains(field)).toBe(true);
		if (location === "history")
			expect(currentResult().contains(field)).toBe(false);
		expect(writeText).toHaveBeenCalledWith(expected);
		expect(inputErrors().queryByRole("alert")).toBeNull();
		expect(document.querySelector("[aria-invalid='true']")).toBeNull();
	});

	it("dismisses the fallback and returns focus to the source button", async () => {
		const owner = seedCopyResults("number", "current");
		const trigger = within(owner).getByRole("button", {
			name: "1번째 숫자 -12 복사",
		});
		fireEvent.click(trigger);
		await selectedFallback("-12");
		fireEvent.click(screen.getByRole("button", { name: "복사 도움말 닫기" }));
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("clears the fallback after a successful retry without changing its raw text", async () => {
		const owner = seedCopyResults("number", "current");
		const trigger = within(owner).getByRole("button", {
			name: "1번째 숫자 -12 복사",
		});
		fireEvent.click(trigger);
		await selectedFallback("-12");
		writeText.mockResolvedValueOnce(undefined);
		fireEvent.click(screen.getByRole("button", { name: "다시 복사" }));
		await waitFor(() =>
			expect(trigger.classList.contains("is-copied")).toBe(true),
		);
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
		expect(writeText).toHaveBeenLastCalledWith("-12");
		expect(document.activeElement).toBe(trigger);
	});

	it("clears the previous copied state while a new attempt is pending", async () => {
		let rejectPending: (error: Error) => void = () => {};
		const pending = new Promise<void>((_, reject) => {
			rejectPending = reject;
		});
		writeText.mockResolvedValueOnce(undefined).mockReturnValueOnce(pending);
		const owner = seedCopyResults("number", "current");
		const first = within(owner).getByRole("button", {
			name: "1번째 숫자 -12 복사",
		});
		fireEvent.click(first);
		await waitFor(() =>
			expect(first.classList.contains("is-copied")).toBe(true),
		);
		fireEvent.click(
			within(owner).getByRole("button", { name: "2번째 숫자 0 복사" }),
		);
		expect(first.classList.contains("is-copied")).toBe(false);
		await act(async () => rejectPending(new Error("Clipboard unavailable")));
		await selectedFallback("0");
	});

	it("does not revive a late failure after changing tools", async () => {
		let rejectPending: (error: Error) => void = () => {};
		writeText.mockReturnValueOnce(
			new Promise<void>((_, reject) => {
				rejectPending = reject;
			}),
		);
		const owner = seedCopyResults("number", "current");
		fireEvent.click(
			within(owner).getByRole("button", { name: "1번째 숫자 -12 복사" }),
		);
		openTool("로또 6/45");
		await act(async () => rejectPending(new Error("Clipboard unavailable")));
		fireEvent.click(
			within(screen.getByRole("navigation", { name: "생성 도구" })).getByRole(
				"button",
				{ name: /랜덤 숫자/ },
			),
		);
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
		expect(inputErrors().queryByRole("alert")).toBeNull();
	});

	it("clears the fallback when a new result is generated", async () => {
		const owner = seedCopyResults("number", "current");
		fireEvent.click(
			within(owner).getByRole("button", { name: "1번째 숫자 -12 복사" }),
		);
		await selectedFallback("-12");
		vi.mocked(generateRandomNumbers).mockResolvedValueOnce({
			numbers: [88],
			source: "csprng",
		});
		submitNumbers();
		await screen.findByRole("button", { name: "1번째 숫자 88 복사" });
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
	});

	it("keeps a genuine input error separate from a copy failure", async () => {
		const owner = seedCopyResults("number", "current");
		fireEvent.change(numberInput("max"), { target: { value: "0" } });
		submitNumbers();
		const originalError = inputErrors().getByRole("alert").textContent;
		fireEvent.click(
			within(owner).getByRole("button", { name: "1번째 숫자 -12 복사" }),
		);
		await selectedFallback("-12");
		expect(inputErrors().getByRole("alert").textContent).toBe(originalError);
		expect(numberInput("max").getAttribute("aria-invalid")).toBe("true");
	});
});
