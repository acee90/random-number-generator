// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoomDrawResult from "../src/components/features/RoomDrawResult";
import { sampleLunchPlaces } from "../src/lib/lunch";
import type { RoomDraw, RoomDrawVote } from "../src/lib/lunchRoom";

function ballot(
	participantId: string,
	vote: RoomDrawVote["vote"],
	reactionMs: number,
): RoomDrawVote {
	return {
		participantId,
		name: participantId === "self" ? "지민" : participantId,
		vote,
		reactionMs,
		timestamp: 9200 + reactionMs,
	};
}
function initialProps() {
	const draw: RoomDraw = {
		id: "optimistic-round",
		candidates: sampleLunchPlaces.slice(0, 2),
		winnerIndex: 0,
		source: "csprng",
		timestamp: 1000,
		startedAt: 2000,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: 1440,
		listVersion: 1,
		participants: [{ id: "self", name: "지민", isHost: false }],
		votes: [ballot("민지", "up", 220), ballot("준호", "down", 400)],
	};
	return {
		draw,
		selfId: "self",
		isHost: false,
		connected: true,
		pending: false,
		readOnly: false,
		canNext: false,
		onNext: vi.fn(),
	};
}
function resultHarness(host = false) {
	const original = initialProps();
	if (host) {
		original.isHost = true;
		original.draw.participants = [{ id: "self", name: "방장", isHost: true }];
	}
	const send = vi.fn<(_id: string, _choice: RoomDrawVote["vote"]) => boolean>(
		() => true,
	);
	let updateState: (patch: Partial<typeof original>) => void;
	function Harness() {
		const [props, setProps] = useState(original);
		updateState = (patch) => setProps((current) => ({ ...current, ...patch }));
		return (
			<RoomDrawResult
				{...props}
				onVote={(id, choice) => {
					const accepted = send(id, choice);
					if (accepted) setProps((current) => ({ ...current, pending: true }));
					return accepted;
				}}
			/>
		);
	}
	const view = render(<Harness />);
	return {
		original,
		send,
		...view,
		update: (patch: Partial<typeof original>) => act(() => updateState(patch)),
	};
}
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function setMobileViewport(mobile: boolean) {
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({ matches: mobile })),
	);
}

describe("optimistic room result voting", () => {
	it("lets the host vote optimistically and keeps next-game navigation separate until the vote settles", () => {
		const { original, send, update, container } = resultHarness(true);
		const next = screen.getByRole("button", {
			name: "다음 게임 대기 화면으로",
		}) as HTMLButtonElement;
		update({ canNext: true });
		expect(next.disabled).toBe(false);
		expect(next.getAttribute("data-variant")).toBe("outline");
		expect(
			screen.getByRole("heading", { name: original.draw.candidates[0].name }),
		).toBeTruthy();
		expect(
			container.querySelector(".room-result-summary")?.textContent,
		).toContain("당첨 메뉴");
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(send).toHaveBeenCalledExactlyOnceWith("optimistic-round", "up");
		expect(next.disabled).toBe(true);
		expect(screen.getByText("3명 참여")).toBeTruthy();
		expect(
			container
				.querySelector(".room-result-layout")
				?.getAttribute("data-own-choice"),
		).toBe("up");
		expect(
			screen.getByRole("list", { name: "좋아요 투표한 참가자" }).textContent,
		).toContain("방장");
		update({
			pending: false,
			draw: {
				...original.draw,
				votes: [
					...(original.draw.votes ?? []),
					{ ...ballot("self", "up", 700), name: "방장" },
				],
			},
		});
		expect(next.disabled).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(send).toHaveBeenCalledOnce();
	});
	it("keeps an archived host result read-only and presents the complete long winner name", () => {
		const original = initialProps();
		const onVote = vi.fn(() => true);
		const longName = "아주 긴 당첨 메뉴 이름 ".repeat(6).trim();
		render(
			<RoomDrawResult
				{...original}
				isHost
				readOnly
				draw={{
					...original.draw,
					candidates: [{ ...original.draw.candidates[0], name: longName }],
				}}
				onVote={onVote}
			/>,
		);
		expect(screen.getByRole("heading", { name: longName }).textContent).toBe(
			longName,
		);
		expect(screen.queryByRole("button", { name: "좋아요 투표" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "다음 게임 대기 화면으로" }),
		).toBeNull();
		expect(onVote).not.toHaveBeenCalled();
	});
	it("updates selection, count and own row immediately, then confirms without duplication or a second burst", () => {
		const { original, send, update, container } = resultHarness();
		const result = container.querySelector(".room-result-layout");
		expect(result?.getAttribute("data-own-choice")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(result?.getAttribute("data-own-choice")).toBe("up");
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByText("3명 참여")).toBeTruthy();
		const tally = screen.getByRole("heading", { name: /좋아요\s*2/ });
		expect(
			tally.closest(".room-feedback-list")?.getAttribute("data-selected"),
		).toBe("true");
		const burst = tally.getAttribute("data-burst");
		expect(burst).toBe("1");
		const voters = screen.getByRole("list", { name: "좋아요 투표한 참가자" });
		expect(within(voters).getByText("지민")).toBeTruthy();
		expect(
			within(voters).getByRole("note", { name: "투표 확인 중" }).textContent,
		).toBe("…");
		expect(screen.getByRole("status").className).toBe("sr-only");
		expect(document.querySelector(".room-feedback-spinner")).toBeNull();
		expect(screen.queryByText(/한 번 선택하면/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(send).toHaveBeenCalledTimes(1);
		update({
			pending: false,
			draw: {
				...original.draw,
				votes: [...(original.draw.votes ?? []), ballot("self", "up", 600)],
			},
		});
		expect(
			screen
				.getByRole("heading", { name: /좋아요\s*2/ })
				.getAttribute("data-burst"),
		).toBe(burst);
		expect(screen.getByText("3명 참여")).toBeTruthy();
		expect(within(voters).getAllByText("지민")).toHaveLength(1);
		expect(screen.queryByRole("note", { name: "투표 확인 중" })).toBeNull();
		expect(within(voters).getByText("+600ms")).toBeTruthy();
		expect(result?.getAttribute("data-own-choice")).toBe("up");
		expect(
			tally.closest(".room-feedback-list")?.getAttribute("data-selected"),
		).toBe("true");
		expect(original.draw.votes).toHaveLength(2);
	});
	it("rolls back a rejected or timed-out request and allows a new selection", () => {
		const { update, send, container } = resultHarness();
		const result = container.querySelector(".room-result-layout");
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(result?.getAttribute("data-own-choice")).toBe("up");
		update({ pending: false });
		expect(result?.getAttribute("data-own-choice")).toBeNull();
		expect(
			container.querySelector('.room-feedback-list[data-selected="true"]'),
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("false");
		expect(screen.getByRole("heading", { name: /좋아요\s*1/ })).toBeTruthy();
		expect(screen.queryByText("지민")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(result?.getAttribute("data-own-choice")).toBe("down");
		expect(
			screen
				.getByRole("button", { name: "싫어요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(send).toHaveBeenCalledTimes(2);
	});
	it("uses the authoritative choice when it differs from the provisional choice", () => {
		const { original, update, container } = resultHarness();
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		update({
			pending: false,
			draw: {
				...original.draw,
				votes: [...(original.draw.votes ?? []), ballot("self", "down", 600)],
			},
		});
		expect(screen.getByRole("heading", { name: /좋아요\s*1/ })).toBeTruthy();
		expect(screen.getByRole("heading", { name: /싫어요\s*2/ })).toBeTruthy();
		expect(
			container
				.querySelector(".room-result-layout")
				?.getAttribute("data-own-choice"),
		).toBe("down");
		expect(
			screen
				.getByRole("heading", { name: /좋아요\s*1/ })
				.closest(".room-feedback-list")
				?.getAttribute("data-selected"),
		).toBeNull();
		expect(
			screen
				.getByRole("heading", { name: /싫어요\s*2/ })
				.closest(".room-feedback-list")
				?.getAttribute("data-selected"),
		).toBe("true");
		expect(
			screen
				.getByRole("button", { name: "싫어요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});
	it.each([
		["좋아요", /좋아요\s*2/],
		["싫어요", /싫어요\s*2/],
	] as const)("keeps mobile %s focus on its mounted tally button through acknowledgement", (label, tallyName) => {
		setMobileViewport(true);
		const { original, update } = resultHarness();
		const button = screen.getByRole("button", { name: `${label} 투표` });
		button.focus();
		fireEvent.click(button);
		const tally = screen.getByRole("heading", { level: 5, name: tallyName });
		expect(document.activeElement).toBe(button);
		expect(tally.contains(button)).toBe(true);
		const choice = label === "좋아요" ? "up" : "down";
		update({
			pending: false,
			draw: {
				...original.draw,
				votes: [...(original.draw.votes ?? []), ballot("self", choice, 600)],
			},
		});
		expect(document.activeElement).toBe(button);
	});
	it("keeps desktop focus on the selected action rather than moving it to the tally", () => {
		setMobileViewport(false);
		resultHarness();
		const button = screen.getByRole("button", { name: "좋아요 투표" });
		button.focus();
		fireEvent.click(button);
		expect(document.activeElement).toBe(button);
	});
	it("does not steal mobile chat focus on an incoming vote or its later acknowledgement", () => {
		setMobileViewport(true);
		render(<input aria-label="채팅 작성" />);
		const input = screen.getByRole("textbox", { name: "채팅 작성" });
		input.focus();
		const { original, update } = resultHarness();
		update({
			draw: {
				...original.draw,
				votes: [...(original.draw.votes ?? []), ballot("self", "down", 600)],
			},
		});
		expect(document.activeElement).toBe(input);
		update({ ...original });
		const button = screen.getByRole("button", { name: "좋아요 투표" });
		button.focus();
		fireEvent.click(button);
		input.focus();
		update({
			pending: false,
			draw: {
				...original.draw,
				votes: [...(original.draw.votes ?? []), ballot("self", "up", 600)],
			},
		});
		expect(document.activeElement).toBe(input);
	});
	it("does not add a provisional vote when sending fails immediately", () => {
		const { send } = resultHarness();
		send.mockReturnValue(false);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(screen.getByRole("heading", { name: /좋아요\s*1/ })).toBeTruthy();
		expect(screen.queryByText("내 선택")).toBeNull();
		expect(screen.getByRole("status").className).toBe("room-feedback-status");
		expect(screen.getByRole("status").textContent).toContain(
			"투표를 보내지 못했습니다",
		);
	});
	it.each([
		"connection",
		"round",
		"identity",
	] as const)("does not resurrect a pending selection after a %s change", (change) => {
		const { original, update, container } = resultHarness();
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		const patch =
			change === "connection"
				? { connected: false }
				: change === "round"
					? { draw: { ...original.draw, id: "next-round" } }
					: { selfId: "another-person" };
		update(patch);
		expect(
			container
				.querySelector(".room-result-layout")
				?.getAttribute("data-own-choice"),
		).toBeNull();
		expect(screen.queryByRole("note", { name: "투표 확인 중" })).toBeNull();
		update({ ...original, pending: true });
		expect(screen.getByRole("heading", { name: /좋아요\s*1/ })).toBeTruthy();
		expect(screen.queryByText("내 선택")).toBeNull();
	});
});
