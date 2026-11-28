// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
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
		expect(
			within(main).queryByRole("button", { name: "내 후보 목록" }),
		).toBeNull();
		expect(screen.queryByText(/곳으로 시작합니다/)).toBeNull();
		expect(mocks.readName).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("previews each role and the result without connecting to a room", () => {
		render(<LunchHome />);
		const preview = within(
			screen.getByRole("region", { name: "방장과 참가자 화면 둘러보기" }),
		);
		const choices = preview.getAllByRole("button");
		const original = preview.getByRole("img").getAttribute("src");
		expect(
			preview.getByRole("button", { name: "방장 화면", pressed: true }),
		).toBeTruthy();
		fireEvent.click(preview.getByRole("button", { name: "참가자 화면" }));
		expect(
			preview.getByRole("img", { name: /후보 추천 칸/ }).getAttribute("src"),
		).not.toBe(original);
		fireEvent.click(preview.getByRole("button", { name: "추첨 결과" }));
		expect(
			choices.map((button) => button.getAttribute("aria-pressed")),
		).toEqual(["false", "false", "true"]);
		expect(preview.getByRole("img", { name: /방탈출이 당첨/ })).toBeTruthy();
		const guide = within(screen.getByRole("region", { name: "이용 방법" }));
		expect(
			guide
				.getAllByRole("heading", { level: 3 })
				.map((heading) => heading.textContent),
		).toEqual([
			"첫 추첨 후보를 준비해요",
			"링크로 친구를 초대해요",
			"슬롯·룰렛으로 하나 뽑아요",
			"결과에 반응을 남겨요",
		]);
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
