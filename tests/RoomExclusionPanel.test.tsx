// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoomExclusionPanel from "../src/components/features/RoomExclusionPanel";
import type { RoomSnapshot } from "../src/lib/lunchRoom";

afterEach(cleanup);

function snapshot(
	count = 2,
	overrides: Partial<RoomSnapshot> = {},
): RoomSnapshot {
	const candidates = Array.from({ length: count }, (_, index) => ({
		id: `candidate-${index}`,
		name: `후보 ${index + 1}`,
		category: "미분류",
	}));
	return {
		roomId: "41611852-dbae-4543-9179-bd428bfcd098",
		title: "제외 내역 검증",
		createdAt: 0,
		expiresAt: 86400000,
		listVersion: 1,
		candidates,
		participants: [],
		messages: [],
		draw: null,
		history: [],
		status: "waiting",
		excludeDrawn: true,
		excludedIds: candidates.map((entry) => entry.id),
		exclusionRecords: candidates.map((entry, index) => ({
			candidateId: entry.id,
			drawId: `draw-${index + 1}`,
			drawnAt: 1794800000000 + index * 20000,
			roundNumber: index + 1,
		})),
		...overrides,
	};
}
function props(state = snapshot()) {
	return {
		snapshot: state,
		isHost: true,
		locked: false,
		busy: false,
		showResult: false,
		onToggle: vi.fn().mockResolvedValue(true),
		onReset: vi.fn().mockResolvedValue(true),
	};
}

function openOptions() {
	const trigger = screen.getByRole("button", { name: /^중복 없이 추첨/ });
	fireEvent.click(trigger);
	return screen.getByRole("dialog", { name: "중복 없이 추첨" });
}

describe("RoomExclusionPanel", () => {
	it("shows a keyboard-scrollable 200-row ledger with draw numbers and reveal times", () => {
		const input = props(snapshot(200));
		render(<RoomExclusionPanel {...input} />);
		expect(screen.queryByRole("list", { name: "당첨 제외 내역" })).toBeNull();
		const popup = openOptions();
		expect(input.onToggle).not.toHaveBeenCalled();
		const list = screen.getByRole("list", { name: "당첨 제외 내역" });
		const rows = within(list).getAllByRole("listitem");
		expect(rows).toHaveLength(200);
		expect(within(rows[0]).getByText("후보 200")).toBeTruthy();
		expect(within(rows[0]).getByText("200회차 당첨")).toBeTruthy();
		expect(rows[0].querySelector("time")?.getAttribute("datetime")).toBe(
			new Date(1794800000000 + 199 * 20000).toISOString(),
		);
		const scroll = screen.getByRole("region", {
			name: "당첨 제외 내역 스크롤",
		});
		expect(scroll.tabIndex).toBe(0);
		fireEvent.click(
			screen.getByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" }),
		);
		expect(input.onToggle).toHaveBeenCalledExactlyOnceWith(false, 1);
		fireEvent.click(screen.getByRole("button", { name: "제외 목록 초기화" }));
		expect(input.onReset).not.toHaveBeenCalled();
		fireEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "초기화",
			}),
		);
		expect(input.onReset).toHaveBeenCalledExactlyOnceWith(1);
		fireEvent.click(within(popup).getByRole("button", { name: "닫기" }));
		expect(screen.queryByRole("list", { name: "당첨 제외 내역" })).toBeNull();
	});

	it("keeps pending OFF exclusions visible until a game boundary without mixing game filters", () => {
		const state = snapshot(2, {
			excludeDrawn: false,
			excludedIds: ["candidate-0"],
			gameFilter: { categories: null, excludedIds: ["candidate-1"] },
		});
		render(<RoomExclusionPanel {...props(state)} />);
		openOptions();
		expect(
			screen.queryByRole("heading", { name: "저장된 당첨 내역" }),
		).toBeNull();
		expect(
			screen.queryByText("꺼짐 · 저장된 당첨 후보도 추첨에 포함됩니다."),
		).toBeNull();
		expect(
			screen.getByText("다음 추첨을 시작하면 제외 내역을 비워요."),
		).toBeTruthy();
		expect(screen.queryAllByRole("listitem")).toHaveLength(1);
		expect(screen.queryByText("후보 2")).toBeNull();
		expect(screen.queryByText(/직접 제외/)).toBeNull();
	});

	it("keeps unknown older draws and marks partial numbering without fabricating a round", () => {
		const state = snapshot(2, {
			exclusionRecords: [
				{
					candidateId: "candidate-1",
					drawId: "retained-22",
					drawnAt: 1794800000000,
					roundNumber: 22,
					roundNumberIsExact: false,
				},
			],
		});
		render(<RoomExclusionPanel {...props(state)} />);
		openOptions();
		expect(screen.getByText("기록 22번째")).toBeTruthy();
		expect(
			screen.getByText("‘기록’ 번호는 남아 있는 추첨 기록 기준입니다."),
		).toBeTruthy();
		expect(screen.getByText("이전 추첨")).toBeTruthy();
		expect(screen.getByText("시각 정보 없음")).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
	});

	it.each([
		"fetching",
		"drawing",
		"closed",
	] as const)("locks game controls in %s and hides reset from participants", (status) => {
		const input = props(snapshot(2, { status }));
		const view = render(<RoomExclusionPanel {...input} />);
		openOptions();
		expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(
			true,
		);
		expect(
			(
				screen.getByRole("button", {
					name: "제외 목록 초기화",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		view.rerender(<RoomExclusionPanel {...input} isHost={false} />);
		expect(
			screen.queryByRole("button", { name: "제외 목록 초기화" }),
		).toBeNull();
		expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(
			true,
		);
	});
	it("shows every exclusion including the current winner across result-time toggles and keeps reset with the ledger", () => {
		const state = snapshot(2);
		state.status = "result";
		state.draw = {
			id: "draw-2",
			candidates: state.candidates,
			winnerIndex: 1,
			source: "csprng",
			timestamp: 0,
			startedAt: 0,
			durationMs: 4000,
			fromRotation: 0,
			toRotation: 0,
			listVersion: 1,
		};
		const view = render(<RoomExclusionPanel {...props(state)} showResult />);
		openOptions();
		expect(screen.getByText("후보 2")).toBeTruthy();
		expect(screen.getByText("후보 1")).toBeTruthy();
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(
			screen.getByRole("heading", { name: "당첨 제외 내역" }).parentElement
				?.textContent,
		).toMatch(/2.*개/);
		view.rerender(
			<RoomExclusionPanel
				{...props({ ...state, excludeDrawn: false })}
				showResult
			/>,
		);
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(
			screen.getByText("다음 게임으로 넘어가면 제외 내역을 비워요."),
		).toBeTruthy();
		view.rerender(<RoomExclusionPanel {...props(state)} showResult />);
		expect(screen.getAllByRole("listitem")).toHaveLength(2);
		expect(
			within(screen.getByRole("dialog", { name: "중복 없이 추첨" })).getByRole(
				"button",
				{ name: "제외 목록 초기화" },
			),
		).toBeTruthy();
		view.rerender(<RoomExclusionPanel {...props(state)} showResult={false} />);
		expect(screen.getByText("후보 2")).toBeTruthy();
	});
});
