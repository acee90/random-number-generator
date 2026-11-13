// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RandomGenerator from "../src/components/features/RandomGenerator";
import SiteHeader from "../src/components/layout/SiteHeader";
import { Route as ToolsRoute } from "../src/routes/tools";
import {
	generateLotteryNumbers,
	generateRandomNumbers,
} from "../src/services/randomService";

vi.mock("../src/services/randomService", () => ({
	generateLotteryNumbers: vi.fn(),
	generateRandomNumbers: vi.fn(),
	getSourceDisplayName: vi.fn(() => "Web Crypto (CSPRNG)"),
}));

beforeEach(() => {
	localStorage.clear();
	vi.mocked(generateLotteryNumbers).mockReset();
	vi.mocked(generateRandomNumbers).mockReset();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: true })),
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
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("shared site and tool navigation", () => {
	it("shows only the lunch service in the public navigation", () => {
		render(<SiteHeader active="lunch" />);
		expect(
			screen.getByRole("link", { name: "점메추 홈" }).getAttribute("href"),
		).toBe("/");
		const navigation = within(
			screen.getByRole("navigation", { name: "서비스 메뉴" }),
		);
		expect(
			navigation
				.getByRole("link", { name: "점메추" })
				.getAttribute("aria-current"),
		).toBe("page");
		expect(navigation.getAllByRole("link")).toHaveLength(1);
		for (const label of ["랜덤 숫자", "로또 6/45", "연금복권 720+"])
			expect(navigation.queryByText(label)).toBeNull();
	});

	it("also hides secondary navigation when a retained tool page supplies switching callbacks", () => {
		const change = vi.fn();
		const view = render(
			<SiteHeader active="number" onToolChange={change} toolsDisabled />,
		);
		expect(screen.queryByRole("button")).toBeNull();
		view.rerender(<SiteHeader active="number" onToolChange={change} />);
		expect(screen.queryByRole("button")).toBeNull();
		expect(
			screen.getByRole("link", { name: "점메추" }).getAttribute("href"),
		).toBe("/");
		expect(change).not.toHaveBeenCalled();
	});

	it("validates direct tool URLs and defaults unknown or non-string values to numbers", () => {
		const validate = ToolsRoute.options.validateSearch;
		if (typeof validate !== "function")
			throw new Error("Expected tools search validator");
		for (const tool of ["number", "lotto", "pension"])
			expect(validate({ tool })).toEqual({ tool });
		for (const tool of [undefined, "unknown", 1, ["lotto"]])
			expect(validate({ tool })).toEqual({ tool: "number" });
	});

	it("syncs URL-driven mode changes without remounting or resetting each tool's settings", () => {
		const changed = vi.fn();
		const view = render(
			<RandomGenerator initialMode="lotto" onModeChange={changed} />,
		);
		expect(
			screen.getByRole("heading", { name: "로또 번호 추첨" }),
		).toBeTruthy();
		fireEvent.click(
			within(screen.getByRole("group", { name: "추첨할 게임 수" })).getByRole(
				"button",
				{ name: /^3\s*게임$/ },
			),
		);
		view.rerender(
			<RandomGenerator initialMode="pension" onModeChange={changed} />,
		);
		fireEvent.click(
			within(screen.getByRole("group", { name: "추첨할 게임 수" })).getByRole(
				"button",
				{ name: /^2\s*게임$/ },
			),
		);
		view.rerender(
			<RandomGenerator initialMode="lotto" onModeChange={changed} />,
		);
		expect(
			screen.getByRole("heading", { name: "로또 번호 추첨" }),
		).toBeTruthy();
		expect(
			within(screen.getByRole("group", { name: "추첨할 게임 수" }))
				.getByRole("button", { name: /^3\s*게임$/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		view.rerender(
			<RandomGenerator initialMode="pension" onModeChange={changed} />,
		);
		expect(
			within(screen.getByRole("group", { name: "추첨할 게임 수" }))
				.getByRole("button", { name: /^2\s*게임$/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(changed).not.toHaveBeenCalled();
		expect(generateLotteryNumbers).not.toHaveBeenCalled();
		expect(generateRandomNumbers).not.toHaveBeenCalled();
	});
});
