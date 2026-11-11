// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RandomGenerator from "../src/components/features/RandomGenerator";
import { generateLotteryNumbers } from "../src/services/randomService";

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
	vi.unstubAllGlobals();
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
		fireEvent.click(
			screen.getByRole("button", { name: "번호 뽑기" }),
		);
		await waitFor(() =>
			expect(generateLotteryNumbers).toHaveBeenCalledWith({
				data: { kind: "pension", count: 5, group: "all" },
			}),
		);
		await screen.findByRole("button", { name: "전체 번호 복사" });
		openTool("로또 6/45");
		fireEvent.click(
			screen.getByRole("button", { name: "번호 뽑기" }),
		);
		await waitFor(() =>
			expect(generateLotteryNumbers).toHaveBeenLastCalledWith({
				data: expect.objectContaining({ kind: "lotto", count: 3 }),
			}),
		);
		await screen.findByRole("button", { name: "전체 번호 복사" });
	});
});
