// @vitest-environment jsdom
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoomDrawFeedback from "../src/components/features/RoomDrawFeedback";
import { sampleLunchPlaces } from "../src/lib/lunch";
import type { RoomDraw, RoomDrawVote } from "../src/lib/lunchRoom";

function draw(votes?: RoomDrawVote[]): RoomDraw {
	return {
		id: "draw-feedback",
		candidates: [...sampleLunchPlaces.slice(0, 2)],
		winnerIndex: 0,
		source: "csprng",
		timestamp: 1000,
		startedAt: 2000,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: 1440,
		listVersion: 1,
		participants: [{ id: "myself", name: "나", isHost: false }],
		...(votes === undefined ? {} : { votes }),
	};
}
function vote(
	participantId: string,
	choice: "up" | "down" = "up",
	reactionMs = 220,
): RoomDrawVote {
	return {
		participantId,
		name: participantId,
		vote: choice,
		timestamp: 9200 + reactionMs,
		reactionMs,
	};
}
function props(current = draw()) {
	return {
		draw: current,
		selfId: "myself",
		isHost: false,
		connected: true,
		pending: false,
		onVote: vi.fn(() => true),
	};
}
afterEach(cleanup);

describe("completed room draw feedback", () => {
	it("offers explicit one-time choices without inventing optimistic votes", () => {
		const current = props();
		render(<RoomDrawFeedback {...current} />);
		expect(screen.getByRole("region", { name: "메뉴 투표" })).toBeTruthy();
		expect(
			screen.getByRole("group", { name: "이번 추첨 결과 투표" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(current.onVote).toHaveBeenCalledExactlyOnceWith(
			"draw-feedback",
			"up",
		);
		expect(screen.getByText("0명 참여")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("false");
	});

	it("retains the authoritative selected choice and disables both buttons after voting", () => {
		const current = props(draw([vote("myself", "down", 1500)]));
		render(<RoomDrawFeedback {...current} />);
		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
			fireEvent.click(button);
		}
		expect(current.onVote).not.toHaveBeenCalled();
		expect(
			screen
				.getByRole("button", { name: "싫어요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByRole("status").textContent).toContain(
			"싫어요에 투표했습니다.",
		);
		expect(screen.getByText("나")).toBeTruthy();
		expect(
			within(
				screen.getByRole("group", { name: "이번 추첨 결과 투표" }),
			).getByText("내 선택"),
		).toBeTruthy();
	});

	it("marks only my own team from saved votes without changing tally names or others' selections", () => {
		const current = props(draw([vote("myself", "down"), vote("동료", "up")]));
		const view = render(<RoomDrawFeedback {...current} mode="results" />);
		const selected = screen.getByRole("region", { name: /^싫어요\s*1$/ });
		const other = screen.getByRole("region", { name: /^좋아요\s*1$/ });
		expect(selected.getAttribute("data-selected")).toBe("true");
		expect(other.getAttribute("data-selected")).toBeNull();
		expect(
			within(selected).getByText("내 선택").getAttribute("aria-hidden"),
		).toBe("true");
		expect(
			within(selected).getByRole("heading", { name: /^싫어요\s*1$/ }),
		).toBeTruthy();
		view.rerender(
			<RoomDrawFeedback {...current} mode="results" selfId="동료" />,
		);
		expect(selected.getAttribute("data-selected")).toBeNull();
		expect(other.getAttribute("data-selected")).toBe("true");
		view.rerender(
			<RoomDrawFeedback {...current} mode="results" selfId="미투표자" />,
		);
		expect(view.container.querySelector('[data-selected="true"]')).toBeNull();
	});

	it("blocks new arrivals even when they are connected, but permits the original participant after reconnect", () => {
		const current = props();
		const view = render(
			<RoomDrawFeedback {...current} selfId="late-arrival" />,
		);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(current.onVote).not.toHaveBeenCalled();
		expect(screen.getByRole("status").textContent).toContain(
			"추첨 시작 후 입장해",
		);
		view.rerender(<RoomDrawFeedback {...current} />);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(current.onVote).toHaveBeenCalledExactlyOnceWith(
			current.draw.id,
			"up",
		);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				draw={{ ...current.draw, participants: undefined }}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "좋아요 투표" }).matches(":disabled"),
		).toBe(true);
	});

	it("shows both teams and global reaction ranks immediately, including ranks beyond the medals", () => {
		const current = props(
			draw([
				vote("나중 선택", "up", 1500),
				vote("가장 빠른 동료", "down", 200),
				vote("동시에 선택", "up", 200),
				vote("네 번째 동료", "down", 4000),
			]),
		);
		render(<RoomDrawFeedback {...current} mode="results" />);
		const up = screen.getByRole("list", { name: "좋아요 투표한 참가자" });
		const down = screen.getByRole("list", { name: "싫어요 투표한 참가자" });
		expect(document.querySelector(".room-draw-feedback details")).toBeNull();
		expect(screen.queryByText("참여자 보기")).toBeNull();
		expect(
			within(up)
				.getAllByRole("listitem")
				.map((item) => item.querySelector(".room-feedback-voter")?.textContent),
		).toEqual(["동시에 선택", "나중 선택"]);
		expect(
			within(down).getByRole("img", { name: "첫 번째 투표" }),
		).toBeTruthy();
		expect(within(up).getByRole("img", { name: "두 번째 투표" })).toBeTruthy();
		expect(within(up).getByRole("img", { name: "세 번째 투표" })).toBeTruthy();
		expect(within(down).getByText("4위")).toBeTruthy();
		expect(within(down).getByText("+4초")).toBeTruthy();
	});
	it("bursts only the tally that gains a confirmed vote, without replaying on duplicate snapshots", () => {
		const current = props();
		const view = render(<RoomDrawFeedback {...current} mode="results" />);
		const tally = (choice: string) =>
			document.querySelector(
				`.room-feedback-list[data-choice="${choice}"] .room-feedback-tally`,
			);
		expect(tally("up")?.getAttribute("data-burst")).toBeNull();
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={draw([vote("first")])}
			/>,
		);
		expect(tally("up")?.getAttribute("data-burst")).toBe("1");
		expect(tally("down")?.getAttribute("data-burst")).toBeNull();
		const icon = tally("up")?.querySelector(".room-feedback-tally-icon");
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={draw([vote("first")])}
			/>,
		);
		expect(tally("up")?.querySelector(".room-feedback-tally-icon")).toBe(icon);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={draw([vote("first"), vote("second", "down")])}
			/>,
		);
		expect(tally("down")?.getAttribute("data-burst")).toBe("1");
		expect(tally("up")?.querySelector(".room-feedback-tally-icon")).toBe(icon);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={draw([vote("first"), vote("third")])}
			/>,
		);
		expect(tally("up")?.getAttribute("data-burst")).toBe("2");
	});
	it("treats existing votes, reconnection, another round and archived views as baselines", () => {
		const current = props(draw([vote("first")]));
		const view = render(<RoomDrawFeedback {...current} mode="results" />);
		const bursts = () =>
			document.querySelectorAll(".room-feedback-tally[data-burst]").length;
		expect(bursts()).toBe(0);
		view.rerender(
			<RoomDrawFeedback {...current} mode="results" connected={false} />,
		);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={draw([vote("first"), vote("second")])}
			/>,
		);
		expect(bursts()).toBe(0);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={draw([vote("first"), vote("second"), vote("third")])}
			/>,
		);
		expect(bursts()).toBe(1);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				draw={{ ...current.draw, id: "another-draw" }}
			/>,
		);
		expect(bursts()).toBe(0);
		view.rerender(
			<RoomDrawFeedback
				{...current}
				mode="results"
				readOnly
				draw={draw([vote("first"), vote("second")])}
			/>,
		);
		expect(bursts()).toBe(0);
		expect(document.querySelector(".room-feedback-burst")).toBeNull();
	});

	it("shows only the live tally and lists to the host", () => {
		const current = props(draw([vote("동료 하나"), vote("동료 둘", "down")]));
		render(<RoomDrawFeedback {...current} isHost />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.getByText("2명 참여")).toBeTruthy();
		expect(
			screen.getByRole("list", { name: "좋아요 투표한 참가자" }).textContent,
		).toContain("동료 하나");
		expect(
			screen.getByRole("list", { name: "싫어요 투표한 참가자" }).textContent,
		).toContain("동료 둘");
		expect(current.onVote).not.toHaveBeenCalled();
	});

	it("shows pending feedback and blocks repeated votes while a request is in flight", () => {
		const current = props();
		render(<RoomDrawFeedback {...current} pending />);
		expect(screen.getByRole("status").textContent).toContain(
			"투표를 보내고 있습니다…",
		);
		for (const button of screen.getAllByRole("button")) {
			expect((button as HTMLButtonElement).disabled).toBe(true);
			fireEvent.click(button);
		}
		expect(current.onVote).not.toHaveBeenCalled();
	});

	it("waits for reconnection and a confirmed participant before enabling voting", () => {
		const current = props();
		const view = render(<RoomDrawFeedback {...current} connected={false} />);
		expect(screen.getByRole("status").textContent).toContain(
			"다시 연결되면 투표할 수 있습니다.",
		);
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(current.onVote).not.toHaveBeenCalled();
		view.rerender(<RoomDrawFeedback {...current} selfId={undefined} />);
		expect(screen.getByRole("status").textContent).toContain(
			"참가 정보를 확인하고 있습니다.",
		);
		expect(
			(screen.getByRole("button", { name: "좋아요 투표" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		view.rerender(<RoomDrawFeedback {...current} />);
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(current.onVote).toHaveBeenCalledExactlyOnceWith(
			"draw-feedback",
			"down",
		);
	});

	it("allows retry after an immediate send failure without locking or selecting a vote", () => {
		const current = props();
		current.onVote.mockReturnValueOnce(false).mockReturnValueOnce(true);
		render(<RoomDrawFeedback {...current} />);
		const button = screen.getByRole("button", { name: "좋아요 투표" });
		fireEvent.click(button);
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(button.getAttribute("aria-pressed")).toBe("false");
		expect(screen.getByRole("status").textContent).toContain(
			"투표를 보내지 못했습니다.",
		);
		fireEvent.click(button);
		expect(current.onVote).toHaveBeenCalledTimes(2);
		expect(screen.getByRole("status").textContent).not.toContain(
			"투표를 보내지 못했습니다.",
		);
	});

	it("updates counts and voters in server order and formats reaction delays compactly", () => {
		const current = props(draw([]));
		const view = render(<RoomDrawFeedback {...current} />);
		expect(screen.getAllByText("아직 없어요")).toHaveLength(2);
		const votes = [
			vote("빠른 동료", "up", 220),
			vote("다른 선택", "down", 130000),
			vote("차분한 동료", "up", 1500),
			vote("늦은 동료", "down", 86400000),
		];
		view.rerender(<RoomDrawFeedback {...current} draw={draw(votes)} />);
		expect(screen.getByText("4명 참여")).toBeTruthy();
		const up = screen.getByRole("list", { name: "좋아요 투표한 참가자" });
		const down = screen.getByRole("list", { name: "싫어요 투표한 참가자" });
		expect(
			within(up)
				.getAllByRole("listitem")
				.map((item) => item.querySelector(".room-feedback-voter")?.textContent),
		).toEqual(["빠른 동료", "차분한 동료"]);
		expect(up.textContent).toContain("+220ms");
		expect(up.textContent).toContain("+1.5초");
		expect(down.textContent).toContain("+2분10초");
		expect(down.textContent).toContain("+24시간");
		expect(down.textContent).not.toContain("86400000");
		expect(screen.getByRole("status").textContent).toContain(
			"좋아요 2명, 싫어요 2명",
		);
	});

	it("keeps archived feedback read-only for guests and hosts", () => {
		const current = props(draw([vote("myself")]));
		const view = render(<RoomDrawFeedback {...current} readOnly />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.getByRole("status").textContent).toContain(
			"확정된 투표 기록입니다.",
		);
		expect(screen.queryByText(/한 번 선택하면/)).toBeNull();
		view.rerender(<RoomDrawFeedback {...current} readOnly isHost pending />);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
		expect(screen.queryByText(/투표를 보내고/)).toBeNull();
		expect(
			screen.getByRole("list", { name: "좋아요 투표한 참가자" }).textContent,
		).toContain("myself");
	});

	it("awards only three global reaction medals with stable arrival order for ties, including archived records", () => {
		const current = props(
			draw([
				vote("첫 투표", "down", 220),
				vote("두 번째", "up", 220),
				vote("세 번째", "down", 400),
				vote("네 번째", "up", 1500),
			]),
		);
		const view = render(<RoomDrawFeedback {...current} />);
		const up = screen.getByRole("list", { name: "좋아요 투표한 참가자" });
		const down = screen.getByRole("list", { name: "싫어요 투표한 참가자" });
		expect(screen.getAllByRole("img")).toHaveLength(3);
		expect(
			within(up).getByRole("img", { name: "두 번째 투표" }).textContent,
		).toBe("🥈");
		expect(
			within(down).getByRole("img", { name: "첫 번째 투표" }).textContent,
		).toBe("🥇");
		expect(
			within(down).getByRole("img", { name: "세 번째 투표" }).textContent,
		).toBe("🥉");
		expect(
			within(within(up).getAllByRole("listitem")[1]).queryByRole("img"),
		).toBeNull();
		view.rerender(<RoomDrawFeedback {...current} readOnly />);
		expect(screen.getAllByRole("img")).toHaveLength(3);
		expect(screen.getByRole("img", { name: "첫 번째 투표" }).textContent).toBe(
			"🥇",
		);
		expect(screen.queryAllByRole("button")).toHaveLength(0);
	});

	it("resets the local failure and own-vote selection for a new draw", () => {
		const current = props();
		current.onVote.mockReturnValue(false);
		const view = render(<RoomDrawFeedback {...current} />);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(screen.getByRole("status").textContent).toContain(
			"투표를 보내지 못했습니다.",
		);
		view.rerender(
			<RoomDrawFeedback {...current} draw={draw([vote("myself")])} />,
		);
		expect(
			(screen.getByRole("button", { name: "좋아요 투표" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		view.rerender(
			<RoomDrawFeedback {...current} draw={{ ...draw([]), id: "next-draw" }} />,
		);
		expect(screen.getByRole("status").textContent).not.toContain(
			"투표를 보내지 못했습니다.",
		);
		expect(
			(screen.getByRole("button", { name: "좋아요 투표" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});
});
