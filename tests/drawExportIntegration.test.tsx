// @vitest-environment jsdom

import { Blob as BufferBlob } from "node:buffer";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import RandomGenerator from "../src/components/features/RandomGenerator";
import { generateLotteryNumbers } from "../src/services/randomService";

vi.mock("../src/services/randomService", () => ({
	generateRandomNumbers: vi.fn(),
	generateLotteryNumbers: vi.fn(),
	getSourceDisplayName: () => "ANU Quantum (양자 난수)",
}));

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("saves the restored draw's conditions after the next-draw controls change", async () => {
	localStorage.clear();
	localStorage.setItem(
		"randomlab.history",
		JSON.stringify([
			{
				id: "saved-lotto",
				kind: "lotto",
				timestamp: Date.parse("2026-11-11T00:15:00Z"),
				source: "quantum",
				rows: [
					{ numbers: [7, 11, 18, 23, 34, 45] },
					{ numbers: [2, 7, 9, 12, 24, 33] },
				],
				lottoOptions: {
					mode: "fixed",
					fixedNumbers: [7],
					excludedNumbers: [4],
					spreadRemainder: false,
				},
			},
		]),
	);
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false })),
	);
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	Object.defineProperty(Element.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
	vi.stubGlobal("Blob", BufferBlob);
	const createObjectURL = vi.fn((_blob: Blob) => "blob:export-integration");
	vi.stubGlobal("URL", { createObjectURL, revokeObjectURL: vi.fn() });
	const filenames: string[] = [];
	vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
		this: HTMLAnchorElement,
	) {
		filenames.push(this.download);
	});
	render(<RandomGenerator />);
	fireEvent.click(
		within(screen.getByRole("navigation", { name: "생성 도구" })).getByRole(
			"button",
			{ name: /로또 6\/45/ },
		),
	);
	fireEvent.click(
		within(screen.getByRole("group", { name: "추첨할 게임 수" })).getByRole(
			"button",
			{ name: /^5\s*게임$/ },
		),
	);
	fireEvent.click(screen.getByRole("radio", { name: /^번호 분산/ }));
	fireEvent.click(screen.getByText("텍스트로 저장", { exact: true }));
	const blob = createObjectURL.mock.calls[0][0] as unknown as BufferBlob;
	const text = await blob.text();
	expect(filenames).toEqual(["randomlab-lotto-20261111-091500.txt"]);
	expect(text).toContain("난수 출처: ANU Quantum (양자 난수)");
	expect(text).toContain("추첨 방식: 번호 고정: 7 · 나머지 랜덤 · 제외: 4");
	expect(text).toContain("1게임: 7, 11, 18, 23, 34, 45");
	expect(text).toContain("2게임: 2, 7, 9, 12, 24, 33");
	expect(text).not.toContain("3게임:");
	expect(generateLotteryNumbers).not.toHaveBeenCalled();
});
