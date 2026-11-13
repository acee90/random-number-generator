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
import LunchRoomPage from "../src/components/features/LunchRoomPage";
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	previewRoomId,
	RoomPageFixtureProvider,
} from "../stories/core/room-page-fixture";

vi.mock(
	"../src/hooks/useLunchRoom",
	() => import("../stories/core/room-page-fixture"),
);

const fetchRequest = vi.fn();
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-13T05:00:00.000Z"));
	vi.stubGlobal("fetch", fetchRequest.mockReset());
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function renderPage(isHost: boolean, initialPhase: "idle" | "result") {
	return render(
		<RoomPageFixtureProvider
			isHost={isHost}
			initialPhase={initialPhase}
			candidateCount={12}
		>
			<LunchRoomPage roomId={previewRoomId} />
		</RoomPageFixtureProvider>,
	);
}

describe("Storybook room page with the local transport adapter", () => {
	it("preserves chat focus and an unsent message when a host draw reveals its result", () => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(max-width: 900px)",
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		);
		renderPage(true, "idle");
		fireEvent.click(screen.getByRole("button", { name: "점심 메뉴 추첨하기" }));
		act(() => vi.advanceTimersByTime(350));
		const input = screen.getByRole("textbox", { name: "메시지" });
		act(() => input.focus());
		fireEvent.change(input, { target: { value: "룰렛 보면서 이야기해요" } });
		expect(screen.getByRole("heading", { name: "룰렛" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "채팅" })).toBeTruthy();
		expect(
			screen.queryByRole("navigation", { name: "모바일 추첨방 화면" }),
		).toBeNull();
		act(() => vi.advanceTimersByTime(7200));
		expect(screen.getByText("0명 참여")).toBeTruthy();
		expect(document.activeElement).toBe(input);
		expect((input as HTMLTextAreaElement).value).toBe("룰렛 보면서 이야기해요");
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("runs a host draw through the real reveal, then archives it and returns to the draw button", () => {
		renderPage(true, "idle");
		fireEvent.click(screen.getByRole("button", { name: "점심 메뉴 추첨하기" }));
		expect(screen.getByRole("button", { name: "추첨 준비 중…" })).toBeTruthy();
		act(() => vi.advanceTimersByTime(350));
		expect(
			screen
				.getByRole("button", { name: "룰렛이 돌아가고 있어요" })
				.matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(7199));
		expect(screen.queryByText("실시간 투표 현황")).toBeNull();
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getByText("0명 참여")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "투표 종료하고 다음 게임" }),
		);
		expect(screen.queryByText("실시간 투표 현황")).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "점심 메뉴 추첨하기" })
				.matches(":disabled"),
		).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		expect(
			screen.getAllByRole("button", { name: /상세 기록 열기$/ }),
		).toHaveLength(2);
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("acknowledges a guest's one-time vote and sends a chat message without contacting a real room", () => {
		renderPage(false, "result");
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(screen.getByText("투표를 보내고 있습니다…")).toBeTruthy();
		expect(screen.getByRole("heading", { name: /좋아요\s*5/ })).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			within(
				screen.getByRole("region", { name: "이 메뉴, 어때요?" }),
			).getByRole("status").className,
		).toBe("sr-only");
		act(() => vi.advanceTimersByTime(140));
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByRole("heading", { name: /좋아요\s*5/ })).toBeTruthy();
		const voters = screen.getByRole("list", { name: "좋아요 투표한 참가자" });
		expect(within(voters).getByText("지민")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(screen.getByText("8명 참여")).toBeTruthy();
		expect(screen.getByRole("heading", { name: /싫어요\s*3/ })).toBeTruthy();
		const input = screen.getByRole("textbox", { name: "메시지" });
		fireEvent.change(input, { target: { value: "이 메뉴로 가요" } });
		fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
		expect(screen.getByText("이 메뉴로 가요")).toBeTruthy();
		expect((input as HTMLTextAreaElement).value).toBe("");
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("applies the host's candidate edit to the actual roulette and clears the pending edit state", () => {
		renderPage(true, "idle");
		const apply = screen.getByRole("button", { name: "후보 적용" });
		expect(apply.matches(":disabled")).toBe(true);
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		expect(screen.getByText("선택 11곳 · 적용 12곳")).toBeTruthy();
		expect(apply.matches(":disabled")).toBe(false);
		fireEvent.click(apply);
		expect(screen.getByText("선택 11곳 · 적용 11곳")).toBeTruthy();
		expect(screen.getByText("11곳 · 같은 확률")).toBeTruthy();
		expect(
			document
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("11");
		expect(screen.getByText("적용됨")).toBeTruthy();
		expect(apply.matches(":disabled")).toBe(true);
		expect(fetchRequest).not.toHaveBeenCalled();
	});
});
