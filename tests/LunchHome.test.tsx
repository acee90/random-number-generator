// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LunchHome from "../src/components/features/LunchHome";

const mocks = vi.hoisted(() => ({ readName: vi.fn() }));
vi.mock("../src/lib/lunchRoomClient", () => ({
	readLunchRoomName: mocks.readName,
}));
vi.mock("../src/components/layout/SiteHeader", () => ({
	default: () => (
		<nav aria-label="사이트 메뉴">
			<a href="/">점메추</a>
		</nav>
	),
}));
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	mocks.readName.mockReset();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("Jeommechu lunch home", () => {
	it("lets users choose room setup or solo drawing before collecting room details", () => {
		render(<LunchHome />);
		const main = screen.getByRole("main");
		expect(within(main).getByRole("heading", { level: 1 })).toBeTruthy();
		expect(
			within(main)
				.getByRole("link", { name: /방 만들기/ })
				.getAttribute("href"),
		).toBe("/create");
		expect(
			within(main)
				.getByRole("link", { name: /혼자 추첨하기/ })
				.getAttribute("href"),
		).toBe("/solo");
		expect(main.querySelector("form")).toBeNull();
		expect(within(main).queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(mocks.readName).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("does not expose unsupported configuration or create a room just by opening the homepage", () => {
		render(<LunchHome />);
		const main = within(screen.getByRole("main"));
		expect(
			main.queryByRole("button", {
				name: /공개|비공개|메뉴 추가|엑셀|투표|가중치|위치 검색/,
			}),
		).toBeNull();
		expect(main.queryByRole("checkbox")).toBeNull();
		expect(main.queryByRole("radio")).toBeNull();
		expect(main.queryByRole("combobox")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
