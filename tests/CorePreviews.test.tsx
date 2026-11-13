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
import { createPreviewDraw, previewSelfId } from "../stories/core/fixtures";
import { VotePlayground, WheelPlayground } from "../stories/core/playgrounds";
import { CoreStylePreview } from "../stories/core/style-proposals";

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: false })),
	);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
const voteArgs = () => ({
	draw: createPreviewDraw(),
	selfId: previewSelfId,
	isHost: false,
	connected: true,
	pending: false,
	onNext: vi.fn(),
	onVote: vi.fn(() => false),
});
const styleArgs = {
	view: "compare" as const,
	candidateCount: 6,
	isHost: false,
	motionOff: false,
};

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
	it("runs the real room timeline and reveals the winner only when the common duration ends", () => {
		render(
			<WheelPlayground
				candidateCount={6}
				canDraw
				motionOff={false}
				initialPhase="idle"
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "점심 메뉴 추첨하기" }));
		expect(
			screen
				.getByRole("button", { name: "추첨 준비 중…" })
				.matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(350));
		expect(
			screen
				.getByRole("button", { name: "룰렛이 돌아가고 있어요" })
				.matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(7199));
		expect(screen.getByRole("status").textContent).not.toContain("추첨 결과:");
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getByRole("status").textContent).toContain("추첨 결과:");
	});
	it("cancels a pending example draw when reset and prevents guest starts", () => {
		const view = render(
			<WheelPlayground
				candidateCount={6}
				canDraw
				motionOff={false}
				initialPhase="idle"
			/>,
		);
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
	it("shares the result, injected voters and one-time own selection between both style proposals", () => {
		vi.setSystemTime(new Date("2026-11-13T04:00:00Z"));
		render(<CoreStylePreview {...styleArgs} />);
		const lime = within(screen.getByRole("region", { name: "A · 라임 보드" }));
		const line = within(screen.getByRole("region", { name: "B · 라인 보드" }));
		expect(lime.getByRole("heading", { level: 3 }).textContent).toBe(
			line.getByRole("heading", { level: 3 }).textContent,
		);
		expect(screen.getAllByText("7명 참여")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "싫어요 +1" }));
		fireEvent.click(lime.getByRole("button", { name: "좋아요 투표" }));
		for (const proposal of [lime, line]) {
			expect(
				proposal.getByRole("heading", { name: /좋아요\s*5/ }),
			).toBeTruthy();
			expect(
				proposal.getByRole("heading", { name: /싫어요\s*4/ }),
			).toBeTruthy();
			expect(
				proposal
					.getByRole("button", { name: "좋아요 투표" })
					.getAttribute("aria-pressed"),
			).toBe("true");
			expect(
				proposal
					.getByRole("button", { name: "싫어요 투표" })
					.matches(":disabled"),
			).toBe(true);
		}
		expect(
			lime.getByRole("list", { name: "좋아요 투표한 참가자" }).textContent,
		).toBe(
			line.getByRole("list", { name: "좋아요 투표한 참가자" }).textContent,
		);
		fireEvent.click(line.getByRole("button", { name: "싫어요 투표" }));
		expect(screen.getAllByText("9명 참여")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "초기화" }));
		expect(screen.getAllByText("7명 참여")).toHaveLength(2);
		expect(document.querySelectorAll("[data-self='true']")).toHaveLength(0);
		for (const proposal of [lime, line]) {
			expect(
				proposal
					.getByRole("button", { name: "좋아요 투표" })
					.matches(":disabled"),
			).toBe(false);
		}
	});
	it("hides both style results until the shared real timeline ends and opens the new round with empty votes", () => {
		vi.setSystemTime(new Date("2026-11-13T04:00:00Z"));
		render(<CoreStylePreview {...styleArgs} />);
		fireEvent.click(screen.getByRole("button", { name: "다시 추첨" }));
		expect(screen.queryAllByText("실시간 투표 현황")).toHaveLength(0);
		act(() => vi.advanceTimersByTime(350));
		expect(
			screen.getAllByRole("button", { name: "룰렛이 돌아가고 있어요" }),
		).toHaveLength(2);
		expect(
			screen.getByRole("button", { name: "좋아요 +1" }).matches(":disabled"),
		).toBe(true);
		act(() => vi.advanceTimersByTime(7199));
		expect(screen.queryAllByText("실시간 투표 현황")).toHaveLength(0);
		act(() => vi.advanceTimersByTime(1));
		expect(screen.getAllByText("실시간 투표 현황")).toHaveLength(2);
		expect(screen.getAllByText("0명 참여")).toHaveLength(2);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 +1" }));
		expect(screen.getAllByText("1명 참여")).toHaveLength(2);
	});
	it("cancels a pending shared draw on reset without replacing the restored votes later", () => {
		vi.setSystemTime(new Date("2026-11-13T04:00:00Z"));
		const view = render(<CoreStylePreview {...styleArgs} />);
		fireEvent.click(screen.getByRole("button", { name: "다시 추첨" }));
		act(() => vi.advanceTimersByTime(100));
		fireEvent.click(screen.getByRole("button", { name: "초기화" }));
		act(() => vi.advanceTimersByTime(10000));
		expect(screen.getAllByText("7명 참여")).toHaveLength(2);
		expect(screen.queryAllByText("0명 참여")).toHaveLength(0);
		fireEvent.click(screen.getByRole("button", { name: "다시 추첨" }));
		view.unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
});
