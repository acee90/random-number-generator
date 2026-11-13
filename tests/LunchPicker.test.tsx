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
import {
	type LunchCategory,
	type LunchPlace,
	lunchCategories,
	lunchSource,
	sampleLunchPlaces as realLunchPlaces,
} from "../src/lib/lunch";
import { lunchHistoryKey, readLunchHistory } from "../src/lib/lunchHistory";
import { generateRandomNumbers } from "../src/services/randomService";

vi.mock("../src/services/randomService", () => ({
	generateRandomNumbers: vi.fn(),
	getSourceDisplayName: vi.fn((source: string) => `출처: ${source}`),
}));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);
const writeText = vi.fn<(text: string) => Promise<void>>();
const sampleLunchPlaces: readonly LunchPlace[] = [
	{ id: "korean-1", name: "첫 번째 한식당", category: "한식" },
	{ id: "korean-2", name: "두 번째 한식당", category: "한식" },
	{ id: "chinese-1", name: "첫 번째 중식당", category: "중식" },
	{ id: "chinese-2", name: "두 번째 중식당", category: "중식" },
	{ id: "japanese-1", name: "일식당", category: "일식" },
	{ id: "salad-1", name: "샐러드 식당", category: "샐러드" },
];

function renderPicker() {
	return render(<LunchPicker places={sampleLunchPlaces} />);
}

function candidatePanelIsOpen() {
	const button = screen.getByRole("button", { name: /^후보 / });
	const expanded = button.getAttribute("aria-expanded");
	expect(["true", "false"]).toContain(expanded);
	expect(button.getAttribute("aria-pressed")).toBe(expanded);
	return expanded === "true";
}

function openCandidates() {
	if (!candidatePanelIsOpen())
		fireEvent.click(screen.getByRole("button", { name: /^후보 / }));
}

function closeCandidates() {
	if (candidatePanelIsOpen())
		fireEvent.click(screen.getByRole("button", { name: /^후보 / }));
}

function expectWheelLabels(
	places: readonly LunchPlace[],
	sourceNumbers: readonly number[],
) {
	const labels = Array.from(
		document.querySelectorAll(".lunch-wheel-rotor text"),
		(node) => node.textContent ?? "",
	);
	expect(labels).toHaveLength(places.length);
	for (const [index, place] of places.entries()) {
		const prefix = `${sourceNumbers[index]} `;
		expect(labels[index].startsWith(prefix)).toBe(true);
		const name = labels[index].slice(prefix.length).replace(/…$/, "");
		expect(name.length).toBeGreaterThan(0);
		expect(place.name.startsWith(name)).toBe(true);
	}
	return labels;
}

function selectCategories(...categories: LunchCategory[]) {
	openCandidates();
	for (const category of lunchCategories) {
		const button = screen.getByRole("button", { name: category });
		if (
			(button.getAttribute("aria-pressed") === "true") !==
			categories.includes(category)
		)
			fireEvent.click(button);
	}
}

beforeEach(() => {
	localStorage.clear();
	vi.mocked(generateRandomNumbers).mockReset();
	writeText.mockReset().mockResolvedValue(undefined);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: true })),
	);
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (clipboardDescriptor)
		Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
	else Reflect.deleteProperty(navigator, "clipboard");
});

async function draw() {
	closeCandidates();
	await act(async () => {
		fireEvent.click(
			screen.getByRole("button", {
				name: /^(점심 메뉴 추첨하기|한 번 더 추첨하기)$/,
			}),
		);
	});
}

function sourceResult(index: number) {
	vi.mocked(generateRandomNumbers).mockResolvedValueOnce({
		numbers: [index],
		source: "quantum",
	});
}

describe("lunch draw prototype", () => {
	it("preserves every supplied restaurant and category, respects missing distances and draws from the full catalog", async () => {
		render(<LunchPicker />);
		expect(
			screen.getByRole("heading", { name: "점심 메뉴 추첨", level: 1 }),
		).toBeTruthy();
		expect(
			screen.getByText(
				`${lunchSource.label} ${realLunchPlaces.length}곳을 불러왔습니다. 거리는 제공한 엑셀의 기준이며, 현재 위치에서 측정한 거리가 아닙니다.`,
			),
		).toBeTruthy();
		expect(
			screen.getByText(/현재 위치에서 측정한 거리가 아닙니다/),
		).toBeTruthy();
		expect(candidatePanelIsOpen()).toBe(false);
		expect(
			screen
				.getByRole("button", { name: /^추첨 기록/ })
				.getAttribute("aria-expanded"),
		).toBe("false");
		openCandidates();
		expect(screen.getAllByRole("checkbox")).toHaveLength(
			realLunchPlaces.length,
		);
		for (const category of ["전체", ...lunchCategories])
			expect(
				screen
					.getByRole("button", { name: category })
					.getAttribute("aria-pressed"),
			).toBe("true");
		expect(
			screen
				.getAllByRole("checkbox")
				.map((input) => input.getAttribute("aria-label")),
		).toEqual(realLunchPlaces.map((place) => `${place.name} 추첨 포함`));
		const withDistance = realLunchPlaces.find(
			(place) => place.distanceMeters !== undefined,
		);
		expect(withDistance).toBeDefined();
		const distanceRow = screen
			.getByRole("checkbox", { name: `${withDistance?.name} 추첨 포함` })
			.closest("label");
		expect(
			within(distanceRow as HTMLElement).getByText(
				`${withDistance?.distanceMeters}m`,
			),
		).toBeTruthy();
		for (const place of realLunchPlaces.filter(
			(item) => item.distanceMeters === undefined,
		)) {
			const row = screen
				.getByRole("checkbox", { name: `${place.name} 추첨 포함` })
				.closest("label");
			expect(row?.textContent).not.toMatch(/\d+m|undefined/);
		}
		expect(document.body.textContent).not.toContain("undefined");
		expect(
			screen.queryByRole("button", { name: /위치|실시간|엑셀/ }),
		).toBeNull();
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		sourceResult(realLunchPlaces.length - 1);
		await draw();
		expect(generateRandomNumbers).toHaveBeenCalledExactlyOnceWith({
			data: {
				min: 0,
				max: realLunchPlaces.length - 1,
				count: 1,
				unique: false,
			},
		});
		expect(
			screen.getByRole("region", {
				name: realLunchPlaces[realLunchPlaces.length - 1].name,
			}),
		).toBeTruthy();
	});

	it("toggles categories independently, allows none, and makes 전체 select all every time", async () => {
		renderPicker();
		openCandidates();
		fireEvent.click(screen.getByRole("button", { name: "한식" }));
		expect(
			screen.getByRole("button", { name: "한식" }).getAttribute("aria-pressed"),
		).toBe("false");
		expect(
			screen.getByRole("button", { name: "중식" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "일식" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed"),
		).toBe("false");
		expect(screen.getAllByRole("checkbox")).toHaveLength(4);
		selectCategories("한식", "중식");
		expect(screen.getAllByRole("checkbox")).toHaveLength(4);
		selectCategories();
		expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
		await draw();
		expect(screen.getByRole("alert").textContent).toContain("2곳 이상");
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "추첨 후보" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "전체" }));
		expect(screen.getAllByRole("checkbox")).toHaveLength(
			sampleLunchPlaces.length,
		);
		for (const category of ["전체", ...lunchCategories])
			expect(
				screen
					.getByRole("button", { name: category })
					.getAttribute("aria-pressed"),
			).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "전체" }));
		expect(screen.getAllByRole("checkbox")).toHaveLength(
			sampleLunchPlaces.length,
		);
		expect(screen.getByRole("alert").textContent).toBe("");
	});

	it("keeps wheel attributes identical across tiny engine math differences", () => {
		const coordinates = () =>
			Array.from(
				document.querySelectorAll(".lunch-wheel-rotor text"),
				(node) => [
					node.getAttribute("x"),
					node.getAttribute("y"),
					node.getAttribute("transform"),
				],
			);
		const nativeCos = Math.cos;
		const nativeSin = Math.sin;
		const cos = vi
			.spyOn(Math, "cos")
			.mockImplementation((angle) => nativeCos(angle) + Number.EPSILON);
		const sin = vi
			.spyOn(Math, "sin")
			.mockImplementation((angle) => nativeSin(angle) + Number.EPSILON);
		const first = render(<LunchPicker />);
		const serverCoordinates = coordinates();
		first.unmount();
		cos.mockRestore();
		sin.mockRestore();
		render(<LunchPicker />);
		expect(coordinates()).toEqual(serverCoordinates);
	});

	it("uses every equal wedge with matching source numbers after excluding candidates", async () => {
		render(<LunchPicker />);
		expectWheelLabels(
			realLunchPlaces,
			realLunchPlaces.map((_, index) => index + 1),
		);
		openCandidates();
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${realLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		expectWheelLabels(
			realLunchPlaces.slice(1),
			realLunchPlaces.slice(1).map((_, index) => index + 2),
		);
		const firstSelected = document.querySelector(
			".lunch-place:not(.is-excluded)",
		);
		expect(
			firstSelected?.querySelector(".lunch-place-number")?.textContent,
		).toBe("2");
		const remainingCount = realLunchPlaces.length - 1;
		const lastIndex = remainingCount - 1;
		sourceResult(lastIndex);
		await draw();
		expect(generateRandomNumbers).toHaveBeenCalledWith({
			data: { min: 0, max: lastIndex, count: 1, unique: false },
		});
		expect(
			screen.getByRole("region", {
				name: realLunchPlaces[realLunchPlaces.length - 1].name,
			}),
		).toBeTruthy();
		const rotation = Number(
			document
				.querySelector<HTMLElement>(".lunch-wheel-rotor")
				?.style.transform.match(/[\d.]+/)?.[0],
		);
		expect(
			(rotation + ((lastIndex + 0.5) * 360) / remainingCount) % 360,
		).toBeCloseTo(0, 5);
	});

	it("keeps shortened names unambiguous with source numbers in a small category pool", () => {
		render(<LunchPicker />);
		selectCategories("편의점");
		const selected = realLunchPlaces.filter(
			(place) => place.category === "편의점",
		);
		const sourceNumbers = realLunchPlaces.flatMap((place, index) =>
			place.category === "편의점" ? [index + 1] : [],
		);
		const labels = expectWheelLabels(selected, sourceNumbers);
		expect(new Set(labels).size).toBe(labels.length);
		expect(document.querySelectorAll(".lunch-place-number")).toHaveLength(
			labels.length,
		);
	});

	it.each([
		0,
		sampleLunchPlaces.length - 1,
	])("maps endpoint index %i to the correct candidate and pointer", async (index) => {
		sourceResult(index);
		renderPicker();
		await draw();
		expect(generateRandomNumbers).toHaveBeenCalledWith({
			data: {
				min: 0,
				max: sampleLunchPlaces.length - 1,
				count: 1,
				unique: false,
			},
		});
		const result = screen.getByRole("region", {
			name: sampleLunchPlaces[index].name,
		});
		expect(document.activeElement).toBe(
			within(result).getByRole("heading", {
				name: sampleLunchPlaces[index].name,
			}),
		);
		expect(
			within(result).getByText(sampleLunchPlaces[index].name),
		).toBeTruthy();
		expect(within(result).getByText(/출처: quantum/)).toBeTruthy();
		const rotor = document.querySelector<HTMLElement>(".lunch-wheel-rotor");
		const rotation = Number(rotor?.style.transform.match(/[\d.]+/)?.[0]);
		const pointerAngle =
			(rotation + ((index + 0.5) * 360) / sampleLunchPlaces.length) % 360;
		expect(Math.min(pointerAngle, 360 - pointerAngle)).toBeLessThan(0.0001);
	});

	it("maps the returned index within a filtered and excluded snapshot", async () => {
		sourceResult(0);
		renderPicker();
		const chinese = sampleLunchPlaces.filter(
			(place) => place.category === "중식",
		);
		selectCategories("중식");
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${chinese[0].name} 추첨 포함`,
			}),
		);
		await draw();
		expect(screen.getByRole("alert").textContent).toContain("2곳 이상");
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "전체" }));
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		await draw();
		expect(generateRandomNumbers).toHaveBeenCalledWith({
			data: {
				min: 0,
				max: sampleLunchPlaces.length - 3,
				count: 1,
				unique: false,
			},
		});
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
		openCandidates();
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${chinese[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
	});

	it("retains individual exclusions when a category is turned off and on", async () => {
		renderPicker();
		openCandidates();
		const excludedName = `${sampleLunchPlaces[0].name} 추첨 포함`;
		fireEvent.click(screen.getByRole("checkbox", { name: excludedName }));
		fireEvent.click(screen.getByRole("button", { name: "한식" }));
		expect(screen.queryByRole("checkbox", { name: excludedName })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "한식" }));
		expect(
			(screen.getByRole("checkbox", { name: excludedName }) as HTMLInputElement)
				.checked,
		).toBe(false);
		selectCategories("한식", "중식");
		sourceResult(0);
		await draw();
		expect(generateRandomNumbers).toHaveBeenCalledWith({
			data: { min: 0, max: 2, count: 1, unique: false },
		});
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
	});

	it("selects and clears only the visible category, and clears a stale validation error when corrected", async () => {
		sourceResult(1);
		renderPicker();
		selectCategories("한식");
		fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
		await draw();
		expect(screen.getByRole("alert").textContent).toContain("2곳 이상");
		expect(screen.getByText(/선택한 음식점이 없습니다/)).toBeTruthy();
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "추첨 후보" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "모두 선택" }));
		expect(screen.getByRole("alert").textContent).toBe("");
		await draw();
		expect(generateRandomNumbers).toHaveBeenCalledWith({
			data: { min: 0, max: 1, count: 1, unique: false },
		});
		const korean = sampleLunchPlaces.filter(
			(place) => place.category === "한식",
		);
		expect(screen.getByRole("region", { name: korean[1].name })).toBeTruthy();
	});

	it("applies select and clear only to places in the active categories", () => {
		renderPicker();
		selectCategories("한식");
		fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
		selectCategories("중식");
		expect(
			screen
				.getAllByRole("checkbox")
				.every((input) => (input as HTMLInputElement).checked),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
		selectCategories("한식");
		expect(
			screen
				.getAllByRole("checkbox")
				.every((input) => !(input as HTMLInputElement).checked),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "모두 선택" }));
		fireEvent.click(screen.getByRole("button", { name: "전체" }));
		for (const place of sampleLunchPlaces) {
			const input = screen.getByRole("checkbox", {
				name: `${place.name} 추첨 포함`,
			}) as HTMLInputElement;
			expect(input.checked).toBe(place.category !== "중식");
		}
	});

	it("exposes a focusable native center button, locks the selected snapshot and prevents duplicate requests", async () => {
		let complete: (value: { numbers: number[]; source: "csprng" }) => void =
			() => {};
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		renderPicker();
		selectCategories("한식", "중식");
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		closeCandidates();
		const centerButton = screen.getByRole("button", {
			name: "점심 메뉴 추첨하기",
		});
		expect(centerButton.tagName).toBe("BUTTON");
		expect(centerButton.closest(".lunch-wheel")).not.toBeNull();
		expect(centerButton.closest('[aria-hidden="true"]')).toBeNull();
		expect(centerButton.getAttribute("type")).toBe("button");
		expect(centerButton.tabIndex).toBe(0);
		centerButton.focus();
		expect(document.activeElement).toBe(centerButton);
		expect(generateRandomNumbers).not.toHaveBeenCalled();
		await draw();
		expect(candidatePanelIsOpen()).toBe(false);
		expect(
			screen
				.getByRole("button", { name: "추첨 준비 중…" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen.getByRole("button", { name: /^후보 / }).matches(":disabled"),
		).toBe(true);
		const candidateInputs = Array.from(
			document.querySelectorAll<HTMLInputElement>(
				'.lunch-candidate-panel input[type="checkbox"]',
			),
		);
		expect(candidateInputs).toHaveLength(4);
		expect(candidateInputs.every((input) => input.matches(":disabled"))).toBe(
			true,
		);
		fireEvent.click(screen.getByRole("button", { name: "추첨 준비 중…" }));
		fireEvent.click(screen.getByRole("button", { name: /^후보 / }));
		await act(async () => complete({ numbers: [2], source: "csprng" }));
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
		expect(generateRandomNumbers).toHaveBeenCalledWith({
			data: { min: 0, max: 2, count: 1, unique: false },
		});
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[3].name }),
		).toBeTruthy();
	});

	it("reveals an animated result only at the end, with a manual skip and no second draw", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
		sourceResult(0);
		renderPicker();
		await draw();
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[0].name }),
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "룰렛이 돌아가고 있어요" })
				.matches(":disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "결과 바로 보기" }));
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[0].name }),
		).toBeTruthy();
		await act(async () => vi.advanceTimersByTime(0));
		expect(vi.getTimerCount()).toBe(0);
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
	});

	it("records only the completed draw once when skip and a late transition both finish", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
		let complete: (value: { numbers: number[]; source: "quantum" }) => void =
			() => {};
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		renderPicker();
		await draw();
		expect(localStorage.getItem(lunchHistoryKey)).toBeNull();
		await act(async () => complete({ numbers: [0], source: "quantum" }));
		expect(
			screen
				.getByRole("button", { name: "룰렛이 돌아가고 있어요" })
				.matches(":disabled"),
		).toBe(true);
		expect(readLunchHistory()).toEqual([]);
		fireEvent.click(screen.getByRole("button", { name: "결과 바로 보기" }));
		const records = readLunchHistory();
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({
			place: sampleLunchPlaces[0],
			source: "quantum",
			candidateCount: sampleLunchPlaces.length,
		});
		const transition = new Event("transitionend", { bubbles: true });
		Object.defineProperty(transition, "propertyName", { value: "transform" });
		const rotor = document.querySelector(".lunch-wheel-rotor");
		expect(rotor).not.toBeNull();
		fireEvent(rotor as Element, transition);
		await act(async () => vi.advanceTimersByTime(7500));
		expect(readLunchHistory()).toEqual(records);
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
	});

	it("dismisses the result without losing history and hides it during a fresh draw", async () => {
		sourceResult(0);
		const view = renderPicker();
		await draw();
		const result = screen.getByRole("region", {
			name: sampleLunchPlaces[0].name,
		});
		expect(
			within(result).getByRole("button", { name: "한 번 더 추첨하기" }),
		).toBeTruthy();
		const center = document.querySelector<HTMLButtonElement>(
			".lunch-wheel-center",
		);
		expect(center).not.toBeNull();
		expect(center?.matches(":disabled")).toBe(true);
		expect(center?.closest('[aria-hidden="true"]')).not.toBeNull();
		const firstRecord = readLunchHistory()[0];
		fireEvent.click(screen.getByRole("button", { name: "룰렛 다시 보기" }));
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[0].name }),
		).toBeNull();
		expect(readLunchHistory()).toEqual([firstRecord]);
		let complete: (value: { numbers: number[]; source: "csprng" }) => void =
			() => {};
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		await draw();
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[0].name }),
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "추첨 준비 중…" })
				.matches(":disabled"),
		).toBe(true);
		expect(readLunchHistory()).toEqual([firstRecord]);
		await act(async () => complete({ numbers: [1], source: "csprng" }));
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
		expect(readLunchHistory().map((record) => record.place.id)).toEqual([
			sampleLunchPlaces[1].id,
			sampleLunchPlaces[0].id,
		]);
		view.unmount();
		renderPicker();
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: /^추첨 기록/ }));
		const history = screen.getByRole("region", { name: "추첨 기록" });
		expect(within(history).getByText(sampleLunchPlaces[0].name)).toBeTruthy();
		expect(within(history).getByText(sampleLunchPlaces[1].name)).toBeTruthy();
		expect(
			within(history)
				.getByText(sampleLunchPlaces[1].name)
				.compareDocumentPosition(
					within(history).getByText(sampleLunchPlaces[0].name),
				),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		await act(async () =>
			fireEvent.click(
				within(history).getByRole("button", {
					name: `${sampleLunchPlaces[1].name} 기록 복사`,
				}),
			),
		);
		expect(writeText).toHaveBeenCalledWith(
			`음식점: ${sampleLunchPlaces[1].name}\n분류: ${sampleLunchPlaces[1].category}`,
		);
	});

	it("finishes if a CSS transition-end event is unavailable", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
		sourceResult(1);
		renderPicker();
		await draw();
		await act(async () => vi.advanceTimersByTime(4000));
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		await act(async () => vi.advanceTimersByTime(3500));
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "한 번 더 추첨하기" })
				.matches(":disabled"),
		).toBe(false);
	});

	it("keeps reduced-motion results immediate without scheduling a spin", async () => {
		vi.useFakeTimers();
		sourceResult(0);
		renderPicker();
		await draw();
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[0].name }),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "결과 바로 보기" })).toBeNull();
		await act(async () => vi.advanceTimersByTime(0));
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		{ numbers: [], source: "csprng" },
		{ numbers: [0, 1], source: "csprng" },
		{ numbers: [-1], source: "csprng" },
		{ numbers: [sampleLunchPlaces.length], source: "csprng" },
		{ numbers: [0.5], source: "csprng" },
		{ numbers: [0], source: "unknown" },
	])("rejects malformed responses without substituting a winner: %j", async (response) => {
		vi.mocked(generateRandomNumbers).mockResolvedValueOnce(
			response as Awaited<ReturnType<typeof generateRandomNumbers>>,
		);
		renderPicker();
		await draw();
		expect(screen.getByRole("alert").textContent).toContain("다시 시도");
		expect(screen.queryByRole("button", { name: "결과 복사" })).toBeNull();
		expect(generateRandomNumbers).toHaveBeenCalledTimes(1);
		expect(readLunchHistory()).toEqual([]);
	});

	it("clears the previous result during a fresh request and keeps failures until retry", async () => {
		sourceResult(0);
		renderPicker();
		await draw();
		let rejectDraw: (error: Error) => void = () => {};
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectDraw = reject;
			}),
		);
		await draw();
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[0].name }),
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "추첨 준비 중…" })
				.matches(":disabled"),
		).toBe(true);
		expect(readLunchHistory()).toHaveLength(1);
		await act(async () => rejectDraw(new Error("offline")));
		expect(screen.getByRole("alert").textContent).toContain("다시 시도");
		expect(readLunchHistory()).toHaveLength(1);
		sourceResult(1);
		await draw();
		expect(screen.getByRole("alert").textContent).toBe("");
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
	});

	it("offers the actual restaurant and category for manual copying when clipboard access fails", async () => {
		sourceResult(0);
		writeText.mockRejectedValueOnce(new Error("denied"));
		renderPicker();
		await draw();
		const button = screen.getByRole("button", { name: "결과 복사" });
		await act(async () => fireEvent.click(button));
		const field = screen.getByRole("textbox", {
			name: "복사할 결과",
		}) as HTMLTextAreaElement;
		expect(field.value).toBe(
			`음식점: ${sampleLunchPlaces[0].name}\n분류: ${sampleLunchPlaces[0].category}`,
		);
		expect(document.activeElement).toBe(field);
		fireEvent.click(screen.getByRole("button", { name: "복사 도움말 닫기" }));
		expect(document.activeElement).toBe(button);
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
	});

	it("invalidates a copy failure when the candidate list changes", async () => {
		let rejectCopy: (error: Error) => void = () => {};
		writeText.mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectCopy = reject;
			}),
		);
		sourceResult(0);
		renderPicker();
		await draw();
		fireEvent.click(screen.getByRole("button", { name: "결과 복사" }));
		openCandidates();
		fireEvent.click(screen.getByRole("button", { name: "한식" }));
		await act(async () => rejectCopy(new Error("denied")));
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
	});

	it("does not schedule or reveal a late request after unmounting", async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"matchMedia",
			vi.fn(() => ({ matches: false })),
		);
		let complete: (value: { numbers: number[]; source: "csprng" }) => void =
			() => {};
		vi.mocked(generateRandomNumbers).mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		const view = renderPicker();
		await draw();
		view.unmount();
		await act(async () => complete({ numbers: [0], source: "csprng" }));
		expect(vi.getTimerCount()).toBe(0);
	});
});
