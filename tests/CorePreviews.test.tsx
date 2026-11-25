// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lunchSpinDurationMs } from "../src/lib/lunch";
import { DrawViewPreview } from "../stories/core/draw-views/DrawViewPreview";
import { createPreviewDraw, previewSelfId } from "../stories/core/fixtures";
import { VotePlayground, WheelPlayground } from "../stories/core/playgrounds";

beforeEach(() => {
	vi.useFakeTimers();
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
	vi.restoreAllMocks();
});
const voteArgs = () => ({
	draw: createPreviewDraw(),
	selfId: previewSelfId,
	isHost: false,
	connected: true,
	pending: false,
	onNext: vi.fn(),
	onRedraw: vi.fn(),
	onVote: vi.fn(() => false),
});

describe("CORE component previews", () => {
	it("adds distinct example voters and the viewer's one-time choice, then resets both the tally and selection", () => {
		render(<VotePlayground {...voteArgs()} />);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 +1" }));
		fireEvent.click(screen.getByRole("button", { name: "싫어요 +1" }));
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(screen.getByRole("heading", { name: /좋아요\s*2/ })).toBeTruthy();
		expect(screen.getByRole("heading", { name: /싫어요\s*1/ })).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(screen.getByRole("heading", { name: /싫어요\s*1/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "초기화" }));
		expect(screen.getByRole("heading", { name: /좋아요\s*0/ })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "좋아요 투표" }).matches(":disabled"),
		).toBe(false);
		expect(
			document.querySelectorAll(".room-feedback-tally[data-burst]"),
		).toHaveLength(0);
	});
	it("can pause or reset the sequence and cleans up its timer on unmount", () => {
		const view = render(<VotePlayground {...voteArgs()} />);
		fireEvent.click(screen.getByRole("button", { name: "연속 투표" }));
		act(() => vi.advanceTimersByTime(840));
		expect(screen.getByRole("heading", { name: /좋아요\s*1/ })).toBeTruthy();
		expect(screen.getByRole("heading", { name: /싫어요\s*1/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "연속 투표 멈추기" }));
		act(() => vi.advanceTimersByTime(840));
		expect(screen.getByRole("heading", { name: /좋아요\s*1/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "연속 투표" }));
		fireEvent.click(screen.getByRole("button", { name: "초기화" }));
		act(() => vi.advanceTimersByTime(840));
		expect(screen.getByRole("heading", { name: /좋아요\s*0/ })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "연속 투표" }));
		view.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("caps injected votes at distinct guests and leaves the viewer's own vote available", () => {
		render(<VotePlayground {...voteArgs()} />);
		fireEvent.click(screen.getByRole("button", { name: "연속 투표" }));
		act(() => vi.advanceTimersByTime(420 * 30));
		expect(screen.getByText("28명 참여")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "좋아요 +1" }).matches(":disabled"),
		).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(screen.getByText("29명 참여")).toBeTruthy();
	});
	it("runs the legacy room timeline and reveals the winner only when the common duration ends", () => {
		render(
			<WheelPlayground
				candidateCount={6}
				canDraw
				motionOff={false}
				initialPhase="spinning"
			/>,
		);
		expect(
			screen
				.getByRole("button", { name: "룰렛이 돌아가고 있어요" })
				.matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(lunchSpinDurationMs - 1));
		expect(screen.getByRole("status").textContent).not.toContain("추첨 결과:");
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getByRole("status").textContent).toContain("추첨 결과:");
	});
	it("resets an example draw and its preparation fixture, and prevents guest starts", () => {
		const view = render(
			<WheelPlayground
				candidateCount={6}
				canDraw
				motionOff={false}
				initialPhase="fetching"
			/>,
		);
		expect(
			screen.getByRole("button", { name: "룰렛 준비 중" }).matches(":disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "처음으로" }));
		fireEvent.click(screen.getByRole("button", { name: "점심 메뉴 추첨하기" }));
		fireEvent.click(screen.getByRole("button", { name: "처음으로" }));
		act(() => vi.advanceTimersByTime(10000));
		expect(
			screen
				.getByRole("button", { name: "점심 메뉴 추첨하기" })
				.matches(":disabled"),
		).toBe(false);
		expect(screen.getByRole("status").textContent).not.toContain("추첨 결과:");
		view.unmount();
		render(
			<WheelPlayground
				candidateCount={6}
				canDraw={false}
				motionOff={false}
				initialPhase="idle"
			/>,
		);
		expect(
			screen
				.getByRole("button", { name: "방장이 추첨을 시작할 때까지 대기" })
				.matches(":disabled"),
		).toBe(true);
	});
});

describe("draw view previews", () => {
	it.each([
		["wheel", "룰렛 돌리기"],
		["rolling", "슬롯 돌리기"],
	] as const)("holds and reaccelerates the same %s round, including redraw", (initialMode, action) => {
		render(
			<DrawViewPreview
				initialMode={initialMode}
				count={6}
				guest={false}
				longName={false}
			/>,
		);
		const spin = screen.getByRole("button", { name: action });
		const text = spin.textContent;
		const icon = spin.querySelector("svg");
		fireEvent.keyDown(spin, { key: " " });
		expect(screen.getByRole("button", { name: action })).toBe(spin);
		expect(spin.matches(":disabled")).toBe(false);
		expect(spin.textContent).toBe(text);
		expect(spin.querySelector("svg")).toBe(icon);
		act(() => vi.advanceTimersByTime(15000));
		expect(screen.queryByRole("heading", { name: "가지 덮밥" })).toBeNull();
		fireEvent.keyUp(window, { key: " " });
		act(() => vi.advanceTimersByTime(1000));
		expect(screen.getByRole("button", { name: action })).toBe(spin);
		expect(spin.matches(":disabled")).toBe(false);
		expect(spin.textContent).toBe(text);
		expect(spin.querySelector("svg")).toBe(icon);
		fireEvent.keyDown(spin, { key: "Enter" });
		act(() => vi.advanceTimersByTime(12000));
		expect(screen.queryByRole("heading", { name: "가지 덮밥" })).toBeNull();
		expect(screen.getByText("1회차")).toBeTruthy();
		fireEvent.keyUp(window, { key: "Enter" });
		act(() => vi.advanceTimersByTime(20000));
		expect(screen.getByRole("heading", { name: "가지 덮밥" })).toBeTruthy();

		const redraw = screen.getByRole("button", { name: "바로 다시 뽑기" });
		act(() => redraw.focus());
		fireEvent.keyDown(redraw, { key: "Enter" });
		expect(redraw.isConnected).toBe(false);
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: action }),
		);
		act(() => vi.advanceTimersByTime(12000));
		expect(screen.queryByRole("heading", { name: "가지 덮밥" })).toBeNull();
		fireEvent.keyUp(screen.getByRole("button", { name: action }), {
			key: "Enter",
		});
		act(() => vi.advanceTimersByTime(20000));
		expect(screen.getByRole("heading", { name: "가지 덮밥" })).toBeTruthy();
		expect(screen.getByText("2회차")).toBeTruthy();
	});

	it("keeps the card preview's preparation state and normal duration", () => {
		render(
			<DrawViewPreview
				initialMode="cards"
				count={6}
				guest={false}
				longName={false}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "카드 한 장 뽑기" }));
		act(() => vi.advanceTimersByTime(319));
		expect(
			screen.getByRole("button", { name: "추첨 준비 중" }).matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(1));
		expect(
			screen.getByRole("button", { name: "추첨 중" }).matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(lunchSpinDurationMs));
		expect(screen.getByRole("heading", { name: "가지 덮밥" })).toBeTruthy();
	});
});
