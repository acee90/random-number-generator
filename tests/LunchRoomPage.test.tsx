// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LunchRoomPage from "../src/components/features/LunchRoomPage";
import { useLunchRoom } from "../src/hooks/useLunchRoom";
import {
	getWheelRotation,
	lunchCategories,
	sampleLunchPlaces,
} from "../src/lib/lunch";
import { lunchHistoryKey } from "../src/lib/lunchHistory";
import type { RoomDraw, RoomSnapshot } from "../src/lib/lunchRoom";

vi.mock("../src/hooks/useLunchRoom", () => ({ useLunchRoom: vi.fn() }));
vi.mock("../src/components/layout/SiteHeader", () => ({
	default: () => (
		<header>
			<a href="/">랜덤랩</a>
		</header>
	),
}));
vi.mock("../src/services/randomService", () => ({
	getSourceDisplayName: (source: string) => `출처: ${source}`,
}));
const roomId = "9b8c4944-5841-462d-b5a4-a701044be6b2";
const baseTime = new Date("2026-11-13T05:00:00.000Z").getTime();
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
	navigator,
	"clipboard",
);
const animationDescriptor = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"animate",
);
type RoomState = ReturnType<typeof useLunchRoom>;
let room: RoomState;
let reduced = false;
const writeText = vi.fn<(text: string) => Promise<void>>();
const fetchNicknameAvailability = vi.fn<typeof fetch>();
const animations: {
	currentTime: number | null;
	pause: ReturnType<typeof vi.fn>;
	cancel: ReturnType<typeof vi.fn>;
}[] = [];
const animate = vi.fn(() => {
	const animation = { currentTime: 0, pause: vi.fn(), cancel: vi.fn() };
	animations.push(animation);
	return animation as unknown as Animation;
});

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return {
		roomId,
		title: "오늘 점심 함께 골라요",
		createdAt: baseTime - 1000,
		expiresAt: baseTime - 1000 + 86400000,
		listVersion: 1,
		candidates: [...sampleLunchPlaces.slice(0, 2)],
		participants: [
			{ id: "host-client", name: "방장", isHost: true },
			{ id: "guest-client", name: "참가자", isHost: false },
		],
		messages: [],
		draw: null,
		history: [],
		status: "waiting",
		...overrides,
	};
}
function draw(startedAt = baseTime + 1500): RoomDraw {
	return {
		id: "draw-one",
		candidates: [...sampleLunchPlaces.slice(0, 2)],
		winnerIndex: 1,
		source: "quantum",
		timestamp: startedAt - 1500,
		startedAt,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: getWheelRotation(0, 1, 2),
		listVersion: 1,
		participants: snapshot().participants,
	};
}
function updateRoom(view: ReturnType<typeof render>, next: Partial<RoomState>) {
	room = { ...room, ...next };
	vi.mocked(useLunchRoom).mockReturnValue(room);
	view.rerender(<LunchRoomPage roomId={roomId} />);
}

describe("current result feedback and frozen history", () => {
	it("exposes guest voting only after reveal and preserves the acknowledged selection", async () => {
		const current = { ...draw(baseTime - 7000), votes: [] };
		room.snapshot = snapshot({ draw: current, status: "drawing" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("button", { name: "좋아요 투표" })).toBeNull();
		await act(async () => vi.advanceTimersByTime(200));
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(room.vote).toHaveBeenCalledExactlyOnceWith(current.id, "up");
		updateRoom(view, { votePendingDrawId: current.id });
		expect(
			screen.getByRole("button", { name: "싫어요 투표" }).matches(":disabled"),
		).toBe(true);
		updateRoom(view, {
			votePendingDrawId: null,
			snapshot: snapshot({
				draw: {
					...current,
					votes: [
						{
							participantId: "guest-client",
							name: "참가자",
							vote: "up",
							timestamp: Date.now(),
							reactionMs: 0,
						},
					],
				},
			}),
		});
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.getByRole("button", { name: "싫어요 투표" }).matches(":disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(room.vote).toHaveBeenCalledTimes(1);
	});

	it("keeps current feedback available when the host changes candidates before the next draw", () => {
		const current = { ...draw(baseTime - 8000), votes: [] };
		room.snapshot = snapshot({ draw: current });
		const view = render(<LunchRoomPage roomId={roomId} />);
		updateRoom(view, {
			snapshot: snapshot({
				draw: current,
				listVersion: 2,
				candidates: sampleLunchPlaces.slice(2, 4),
			}),
		});
		expect(
			screen.getByRole("button", { name: "좋아요 투표" }).matches(":disabled"),
		).toBe(false);
		expect(
			document.querySelector(".lunch-wheel-rotor text")?.textContent,
		).toContain("3 ");
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(room.vote).toHaveBeenCalledExactlyOnceWith(current.id, "down");
	});

	it("keeps the result focused on the menu and voting, with no copy or metadata controls", () => {
		room.snapshot = snapshot({ draw: draw(baseTime - 8000) });
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByText("추첨 정보")).toBeNull();
		expect(screen.queryByRole("button", { name: "결과 복사" })).toBeNull();
		expect(document.querySelector(".room-result-tools")).toBeNull();
		expect(
			screen.getByRole("button", { name: "좋아요 투표" }).matches(":disabled"),
		).toBe(false);
	});

	it("keeps late guests read-only and never offers host navigation", () => {
		room.snapshot = snapshot({
			draw: {
				...draw(baseTime - 8000),
				participants: [{ id: "host-client", name: "방장", isHost: true }],
			},
		});
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByRole("button", { name: "좋아요 투표" }).matches(":disabled"),
		).toBe(true);
		expect(screen.getByText(/추첨 시작 후 입장해/)).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: /룰렛 다시 보기|투표 종료하고 다음 게임|한 번 더 추첨하기/,
			}),
		).toBeNull();
		expect(
			screen.getByRole("region", { name: "실시간 투표 현황" }).parentElement
				?.className,
		).toBe("room-result-layout");
	});
	it("lets the host close voting for everyone, then focuses the next draw without auto-starting", () => {
		room.self = { id: "host-client", isHost: true };
		const current = draw(baseTime - 8000);
		room.snapshot = snapshot({ draw: current });
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("button", { name: "룰렛 다시 보기" })).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "투표 종료하고 다음 게임" }),
		);
		expect(room.nextRound).toHaveBeenCalledExactlyOnceWith(current.id);
		expect(room.startDraw).not.toHaveBeenCalled();
		updateRoom(view, { nextPending: true });
		expect(
			screen
				.getByRole("button", { name: "투표 종료 중…" })
				.matches(":disabled"),
		).toBe(true);
		updateRoom(view, {
			nextPending: false,
			snapshot: snapshot({ draw: null, history: [current] }),
		});
		expect(
			screen.queryByRole("region", { name: "실시간 투표 현황" }),
		).toBeNull();
		expect(document.activeElement?.id).toContain("-start");
		expect(room.startDraw).not.toHaveBeenCalled();
	});

	it("shows fixed ballots in history with no vote action and freezes the opened copy", () => {
		const archived = {
			...draw(baseTime - 8000),
			votes: [
				{
					participantId: "guest-client",
					name: "확정이름",
					vote: "up" as const,
					timestamp: baseTime,
					reactionMs: 800,
				},
			],
		};
		room.snapshot = snapshot({ history: [archived] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		fireEvent.click(
			screen.getByRole("button", {
				name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
			}),
		);
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).queryByRole("button", { name: "좋아요 투표" }),
		).toBeNull();
		expect(within(dialog).getByText("확정된 투표 기록입니다.")).toBeTruthy();
		expect(within(dialog).getByText("확정이름")).toBeTruthy();
		archived.votes[0].name = "바뀐이름";
		updateRoom(view, { snapshot: snapshot({ history: [archived] }) });
		expect(within(dialog).getByText("확정이름")).toBeTruthy();
		expect(within(dialog).queryByText("바뀐이름")).toBeNull();
		expect(room.vote).not.toHaveBeenCalled();
	});
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(baseTime);
	localStorage.clear();
	reduced = false;
	animations.length = 0;
	animate.mockClear();
	writeText.mockReset().mockResolvedValue(undefined);
	fetchNicknameAvailability
		.mockReset()
		.mockImplementation(async (_url, options) => {
			const { name } = JSON.parse(String(options?.body));
			return new Response(JSON.stringify({ name, available: true }), {
				headers: { "Content-Type": "application/json" },
			});
		});
	vi.stubGlobal("fetch", fetchNicknameAvailability);
	Object.defineProperty(HTMLElement.prototype, "animate", {
		configurable: true,
		value: animate,
	});
	Object.defineProperty(navigator, "clipboard", {
		configurable: true,
		value: { writeText },
	});
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: reduced,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
	room = {
		snapshot: snapshot(),
		self: { id: "guest-client", isHost: false },
		connection: "connected",
		nickname: "참가자",
		waitingForEntry: false,
		entryPending: false,
		enter: vi.fn(() => true),
		error: "",
		startPending: false,
		nextPending: false,
		candidatesPending: false,
		votePendingDrawId: null,
		clockOffset: 0,
		serverNow: () => Date.now(),
		rename: vi.fn(() => true),
		sendChat: vi.fn(() => true),
		startDraw: vi.fn(() => true),
		nextRound: vi.fn(() => true),
		updateCandidates: vi.fn(() => true),
		vote: vi.fn(() => true),
		reconnect: vi.fn(),
		clearError: vi.fn(),
	};
	vi.mocked(useLunchRoom).mockReset().mockReturnValue(room);
});
afterEach(() => {
	cleanup();
	vi.runOnlyPendingTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	if (clipboardDescriptor)
		Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
	else Reflect.deleteProperty(navigator, "clipboard");
	if (animationDescriptor)
		Object.defineProperty(
			HTMLElement.prototype,
			"animate",
			animationDescriptor,
		);
	else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

describe("the live room visual viewport", () => {
	it("tracks keyboard-height changes, falls back while zoomed and releases its resize listener on unmount", () => {
		const viewport = Object.assign(new EventTarget(), {
			height: 800,
			scale: 1,
		});
		const addListener = vi.spyOn(viewport, "addEventListener");
		const removeListener = vi.spyOn(viewport, "removeEventListener");
		vi.stubGlobal("visualViewport", viewport);
		const view = render(<LunchRoomPage roomId={roomId} />);
		const root = view.container.querySelector<HTMLDivElement>(".lunch-room");
		expect(root?.classList.contains("room-live")).toBe(true);
		expect(root?.dataset.compactViewport).toBeUndefined();
		expect(root?.style.getPropertyValue("--room-viewport-height")).toBe(
			"800px",
		);
		viewport.height = 420;
		act(() => viewport.dispatchEvent(new Event("resize")));
		expect(root?.style.getPropertyValue("--room-viewport-height")).toBe(
			"420px",
		);
		expect(root?.dataset.compactViewport).toBe("true");
		viewport.scale = 2;
		act(() => viewport.dispatchEvent(new Event("resize")));
		expect(root?.style.getPropertyValue("--room-viewport-height")).toBe("");
		expect(root?.dataset.compactViewport).toBeUndefined();
		viewport.scale = 1;
		viewport.height = 480;
		act(() => viewport.dispatchEvent(new Event("resize")));
		expect(root?.style.getPropertyValue("--room-viewport-height")).toBe(
			"480px",
		);
		expect(root?.dataset.compactViewport).toBe("true");
		viewport.height = 800;
		act(() => viewport.dispatchEvent(new Event("resize")));
		expect(root?.dataset.compactViewport).toBeUndefined();
		const listener = addListener.mock.calls.find(
			([type]) => type === "resize",
		)?.[1];
		expect(listener).toBeTypeOf("function");
		view.unmount();
		expect(removeListener).toHaveBeenCalledWith("resize", listener);
		expect(root?.style.getPropertyValue("--room-viewport-height")).toBe("");
		expect(root?.dataset.compactViewport).toBeUndefined();
	});

	it("keeps entry and closed screens unconstrained while attaching the live viewport after entry", () => {
		const viewport = Object.assign(new EventTarget(), {
			height: 640,
			scale: 1,
		});
		vi.stubGlobal("visualViewport", viewport);
		room.waitingForEntry = true;
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(view.container.querySelector(".room-live")).toBeNull();
		expect(
			view.container
				.querySelector<HTMLDivElement>(".lunch-room")
				?.style.getPropertyValue("--room-viewport-height"),
		).toBe("");
		updateRoom(view, { waitingForEntry: false });
		expect(view.container.querySelector(".room-live")).not.toBeNull();
		expect(
			view.container
				.querySelector<HTMLDivElement>(".lunch-room")
				?.style.getPropertyValue("--room-viewport-height"),
		).toBe("640px");
		updateRoom(view, {
			connection: "closed",
			snapshot: snapshot({ status: "closed" }),
		});
		expect(view.container.querySelector(".room-live")).toBeNull();
		expect(
			view.container
				.querySelector<HTMLDivElement>(".lunch-room")
				?.style.getPropertyValue("--room-viewport-height"),
		).toBe("");
	});
});

describe("synchronized lunch room UI", () => {
	it("shows the approved host candidates already selected on the first room paint", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ candidates: [...sampleLunchPlaces] });
		const paints: { count: number; checked: number }[] = [];
		vi.mocked(useLunchRoom).mockReturnValue(room);
		render(
			<Profiler
				id="first-room-paint"
				onRender={() => {
					const inputs = Array.from(
						document.querySelectorAll<HTMLInputElement>(
							".room-candidate-list input",
						),
					);
					paints.push({
						count: inputs.length,
						checked: inputs.filter((input) => input.checked).length,
					});
				}}
			>
				<LunchRoomPage roomId={roomId} />
			</Profiler>,
		);
		expect(paints[0]).toEqual({
			count: sampleLunchPlaces.length,
			checked: sampleLunchPlaces.length,
		});
	});

	it("refreshes a readonly candidate's visible name and category even when its ID is unchanged", () => {
		const view = render(<LunchRoomPage roomId={roomId} />);
		const renamed = {
			...sampleLunchPlaces[0],
			name: "수정된 식당",
			category: "한식" as const,
		};
		updateRoom(view, {
			snapshot: snapshot({ candidates: [renamed, sampleLunchPlaces[1]] }),
		});
		const candidates = document.querySelector(".room-readonly-candidates");
		expect(candidates?.textContent).toContain("수정된 식당");
		expect(candidates?.textContent).toContain("한식");
		expect(candidates?.textContent).not.toContain(sampleLunchPlaces[0].name);
	});

	it("asks for a nickname without rendering or joining the room before explicit entry", () => {
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		render(<LunchRoomPage roomId={roomId} asGuest />);
		expect(useLunchRoom).toHaveBeenCalledWith(roomId, true, {
			requireEntry: true,
		});
		expect(
			screen.getByRole("heading", { name: "닉네임을 정해 주세요" }),
		).toBeTruthy();
		expect(
			screen.getByRole("textbox", { name: "닉네임" }).getAttribute("maxlength"),
		).toBe("12");
		expect(screen.queryByRole("heading", { name: "채팅" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "점심 메뉴 추첨하기" }),
		).toBeNull();
		expect(room.enter).not.toHaveBeenCalled();
	});

	it("prefills a saved nickname without submitting it automatically", () => {
		localStorage.setItem("randomlab:lunch-room-name", "저장한 이름");
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			(screen.getByRole("textbox", { name: "닉네임" }) as HTMLInputElement)
				.value,
		).toBe("저장한 이름");
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(room.enter).not.toHaveBeenCalled();
	});

	it("keeps entry controls pending until the server accepts the participant", async () => {
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		const view = render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", { name: "닉네임" });
		fireEvent.change(input, { target: { value: "  동료  " } });
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350);
		});
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		expect(room.enter).toHaveBeenCalledExactlyOnceWith("동료");
		updateRoom(view, { entryPending: true });
		expect((input as HTMLInputElement).disabled).toBe(true);
		expect(
			(screen.getByRole("button", { name: "입장 중…" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		expect(room.enter).toHaveBeenCalledTimes(1);
		updateRoom(view, {
			snapshot: snapshot(),
			self: { id: "guest-client", isHost: false },
			connection: "connected",
			waitingForEntry: false,
			entryPending: false,
		});
		expect(screen.queryByRole("form", { name: "추첨방 입장" })).toBeNull();
		expect(screen.getByRole("heading", { name: "채팅" })).toBeTruthy();
	});

	it("keeps the attempted nickname editable after a duplicate rejection and allows another choice", async () => {
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		const view = render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", { name: "닉네임" });
		fireEvent.change(input, { target: { value: "동료" } });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350);
		});
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		updateRoom(view, {
			error: "이미 사용 중인 닉네임입니다. 다른 이름을 입력해 주세요.",
		});
		expect(screen.getByRole("alert").textContent).toContain("이미 사용 중");
		expect((input as HTMLInputElement).value).toBe("동료");
		expect(document.activeElement).toBe(input);
		fireEvent.change(input, { target: { value: "다른 동료" } });
		updateRoom(view, { error: "" });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350);
		});
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		expect(room.enter).toHaveBeenLastCalledWith("다른 동료");
		expect(room.enter).toHaveBeenCalledTimes(2);
	});

	it("rejects empty and overlong entry names before requesting a join", () => {
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", { name: "닉네임" });
		for (const value of ["  ", "가".repeat(13)]) {
			fireEvent.change(input, { target: { value } });
			fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
			expect(screen.getByRole("alert").textContent).toContain("1~12자");
		}
		expect(room.enter).not.toHaveBeenCalled();
	});

	it("waits for the scheduled start and never reveals the result before the common end", async () => {
		room.snapshot = snapshot({ draw: draw(), status: "drawing" });
		render(<LunchRoomPage roomId={roomId} />);
		expect(animate).toHaveBeenCalledWith(
			[
				{ transform: "rotate(0deg)" },
				{ transform: `rotate(${draw().toRotation}deg)` },
			],
			{ duration: 7200, easing: "cubic-bezier(.12,.72,.16,1)", fill: "both" },
		);
		expect(animations[0].currentTime).toBe(-1500);
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		await act(async () => vi.advanceTimersByTime(8699));
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		await act(async () => vi.advanceTimersByTime(1));
		const result = screen.getByRole("region", {
			name: sampleLunchPlaces[1].name,
		});
		expect(
			within(result).getByRole("heading", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
		expect(
			within(result).queryByRole("button", { name: "한 번 더 추첨하기" }),
		).toBeNull();
		expect(result.querySelector("details")).toBeNull();
		expect(localStorage.getItem(lunchHistoryKey)).toBeNull();
	});

	it("joins an existing animation at server elapsed time and cancels it on unmount", async () => {
		vi.setSystemTime(baseTime + 4500);
		room.snapshot = snapshot({ draw: draw(), status: "drawing" });
		room.clockOffset = 500;
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(animations[0].currentTime).toBe(3500);
		await act(async () => vi.advanceTimersByTime(3699));
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		await act(async () => vi.advanceTimersByTime(1));
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
		view.unmount();
		expect(animations[0].cancel).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps reduced-motion users static while still withholding the winner until the end", async () => {
		reduced = true;
		room.snapshot = snapshot({ draw: draw(), status: "drawing" });
		render(<LunchRoomPage roomId={roomId} />);
		expect(animate).not.toHaveBeenCalled();
		await act(async () => vi.advanceTimersByTime(8699));
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		await act(async () => vi.advanceTimersByTime(1));
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
	});

	it("switches to the new candidate version after a completed draw without altering room history", () => {
		const previous = draw(baseTime - 8000);
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			draw: previous,
			history: [previous],
			status: "drawing",
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeTruthy();
		const next = snapshot({
			draw: previous,
			history: [previous],
			listVersion: 2,
			candidates: [...sampleLunchPlaces.slice(2, 4)],
		});
		updateRoom(view, { snapshot: next });
		expect(
			screen.queryByRole("region", { name: sampleLunchPlaces[1].name }),
		).toBeNull();
		const labels = Array.from(
			document.querySelectorAll(".lunch-wheel-rotor text"),
			(node) => node.textContent,
		);
		expect(labels[0]).toContain("3 ");
		expect(labels[1]).toContain("4 ");
		expect(
			screen
				.getByRole("button", { name: "점심 메뉴 추첨하기" })
				.matches(":disabled"),
		).toBe(false);
		expect(next.history).toEqual([previous]);
	});

	it("shows plain chat text and preserves an older reading position as new messages arrive", () => {
		const first = {
			id: "message-one",
			participantId: "host-client",
			name: "방장",
			text: "<img src=x onerror=alert(1)>",
			timestamp: baseTime,
		};
		room.snapshot = snapshot({ messages: [first] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.getByText(first.text)).toBeTruthy();
		expect(document.querySelector("img")).toBeNull();
		const list = screen.getByRole("log", { name: "방 채팅 메시지" });
		Object.defineProperties(list, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 600 },
		});
		list.scrollTop = 100;
		fireEvent.scroll(list);
		updateRoom(view, {
			snapshot: snapshot({
				messages: [
					first,
					{
						...first,
						id: "message-two",
						text: "김밥 먹을까요?",
						timestamp: baseTime + 1000,
					},
				],
			}),
		});
		expect(list.scrollTop).toBe(100);
		fireEvent.click(screen.getByRole("button", { name: "새 메시지 1개 보기" }));
		expect(list.scrollTop).toBe(600);
	});

	it.each([
		false,
		true,
	])("shares a plain room URL for legacy guest flag %s and restores the manual-copy trigger", async (asGuest) => {
		writeText.mockRejectedValueOnce(new Error("clipboard denied"));
		localStorage.setItem(`randomlab:lunch-room-host:${roomId}`, "a".repeat(64));
		render(<LunchRoomPage roomId={roomId} asGuest={asGuest} />);
		expect(useLunchRoom).toHaveBeenCalledWith(roomId, asGuest, {
			requireEntry: true,
		});
		expect(screen.queryByRole("button", { name: "후보 설정" })).toBeNull();
		const trigger = screen.getByRole("button", { name: "초대 링크 복사" });
		await act(async () => fireEvent.click(trigger));
		const field = screen.getByRole("textbox", {
			name: "복사할 결과",
		}) as HTMLTextAreaElement;
		const expectedUrl = `${window.location.origin}/lunch-room/${roomId}`;
		expect(field.value).toBe(expectedUrl);
		expect(document.activeElement).toBe(field);
		fireEvent.click(screen.getByRole("button", { name: "복사 도움말 닫기" }));
		expect(document.activeElement).toBe(trigger);
		await act(async () => fireEvent.click(trigger));
		expect(writeText.mock.calls).toEqual([[expectedUrl], [expectedUrl]]);
		expect(screen.getByRole("button", { name: "링크 복사됨" })).toBe(trigger);
	});

	it("provides plaintext Enter-to-send and same-room nickname editing", () => {
		render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", { name: "메시지" });
		expect(input.getAttribute("maxlength")).toBe("500");
		fireEvent.change(input, { target: { value: "오늘은 김밥!" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(room.sendChat).toHaveBeenCalledExactlyOnceWith("오늘은 김밥!");
		fireEvent.click(screen.getByRole("button", { name: /^내 프로필:/ }));
		const nickname = screen.getByRole("textbox", { name: "닉네임" });
		expect(nickname.getAttribute("maxlength")).toBe("12");
		fireEvent.change(nickname, { target: { value: " " } });
		fireEvent.click(screen.getByRole("button", { name: "변경" }));
		expect(room.rename).not.toHaveBeenCalled();
		expect(nickname.getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(nickname);
		fireEvent.change(nickname, { target: { value: "가".repeat(13) } });
		fireEvent.click(screen.getByRole("button", { name: "변경" }));
		expect(room.rename).not.toHaveBeenCalled();
		expect(screen.getByText("13/12")).toBeTruthy();
		fireEvent.change(nickname, {
			target: { value: "이름 변경" },
		});
		fireEvent.click(screen.getByRole("button", { name: "변경" }));
		expect(room.rename).toHaveBeenCalledExactlyOnceWith("이름 변경");
		expect(screen.queryByRole("textbox", { name: "닉네임" })).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: /^내 프로필:/ }),
		);
	});

	it("shows completed room history and copies a row without exposing the active draw", async () => {
		const completed = draw(baseTime - 8000);
		const active = {
			...draw(),
			id: "active-draw",
			winnerIndex: 0,
			toRotation: getWheelRotation(0, 0, 2),
		};
		room.snapshot = snapshot({
			draw: active,
			history: [active, completed],
			status: "drawing",
		});
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		const history = screen.getByRole("region", { name: "방 추첨 기록" });
		expect(
			within(history).getAllByRole("button", { name: / 상세 기록 열기$/ }),
		).toHaveLength(1);
		expect(
			within(history).getByRole("button", {
				name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
			}),
		).toBeTruthy();
		expect(
			within(history).queryByRole("button", {
				name: `${sampleLunchPlaces[0].name} 상세 기록 열기`,
			}),
		).toBeNull();
		expect(
			within(history).getByText(/2곳 중 추첨 · 출처: quantum/),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(
				within(history).getByRole("button", {
					name: `${sampleLunchPlaces[1].name} 기록 복사`,
				}),
			),
		);
		expect(writeText).toHaveBeenCalledTimes(1);
		expect(writeText.mock.calls[0][0]).toContain(
			`음식점: ${sampleLunchPlaces[1].name}\n분류: ${sampleLunchPlaces[1].category}`,
		);
		expect(writeText.mock.calls[0][0]).toContain(`추첨 ID: ${completed.id}`);
		expect(localStorage.getItem(lunchHistoryKey)).toBeNull();
	});

	it("keeps read-only guest candidates below both primary views without candidate or participant tabs", () => {
		render(<LunchRoomPage roomId={roomId} />);
		const navigation = screen.getByRole("navigation", { name: "추첨 도구" });
		expect(
			within(navigation)
				.getAllByRole("button")
				.map((button) => button.textContent?.trim()),
		).toEqual(["룰렛", "결과 0"]);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		const wheel = screen.getByRole("region", { name: "룰렛" });
		expect(
			within(wheel)
				.getByRole("button", { name: "방장이 추첨을 시작할 때까지 대기" })
				.matches(":disabled"),
		).toBe(true);
		expect(wheel.compareDocumentPosition(candidates)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING,
		);
		for (const place of sampleLunchPlaces.slice(0, 2))
			expect(within(candidates).getByText(place.name)).toBeTruthy();
		expect(within(candidates).queryByRole("checkbox")).toBeNull();
		expect(
			within(navigation).queryByRole("button", { name: /후보 설정|참가자 / }),
		).toBeNull();
		expect(screen.getByRole("button", { name: "참가자 2명" })).toBeTruthy();
		fireEvent.click(within(navigation).getByRole("button", { name: "결과" }));
		expect(screen.getByRole("region", { name: "추첨 후보" })).toBe(candidates);
		expect(
			screen
				.getByRole("region", { name: "방 추첨 기록" })
				.compareDocumentPosition(candidates),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("keeps the host editor in normal flow and sends its selection through the existing room action", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ candidates: [...sampleLunchPlaces] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		expect(within(candidates).getAllByRole("checkbox")).toHaveLength(
			sampleLunchPlaces.length,
		);
		fireEvent.click(
			within(candidates).getByRole("checkbox", {
				name: `${sampleLunchPlaces[2].name} 추첨 포함`,
			}),
		);
		fireEvent.click(
			within(candidates).getByRole("button", { name: "후보 적용" }),
		);
		expect(room.updateCandidates).toHaveBeenCalledExactlyOnceWith(
			sampleLunchPlaces
				.filter((_, index) => index !== 2)
				.map((place) => place.id),
		);
		updateRoom(view, { startPending: true });
		expect(
			within(candidates)
				.getAllByRole("checkbox")
				.every((input) => input.matches(":disabled")),
		).toBe(true);
	});

	it("preserves individual exclusions across category toggles and its matching apply acknowledgement", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ candidates: [...sampleLunchPlaces] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		const korean = sampleLunchPlaces.filter(
			(place) => place.category === "한식",
		);
		const excludedName = `${korean[0].name} 추첨 포함`;
		fireEvent.click(
			within(candidates).getByRole("checkbox", { name: excludedName }),
		);
		fireEvent.click(within(candidates).getByRole("button", { name: "한식" }));
		expect(
			within(candidates).queryByRole("checkbox", { name: excludedName }),
		).toBeNull();
		expect(
			within(candidates)
				.getByRole("button", { name: "편의점" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(room.updateCandidates).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		fireEvent.click(
			within(candidates).getByRole("button", { name: "후보 적용" }),
		);
		const applied = sampleLunchPlaces.filter(
			(place) => place.category !== "한식",
		);
		expect(room.updateCandidates).toHaveBeenCalledExactlyOnceWith(
			applied.map((place) => place.id),
		);
		updateRoom(view, { candidatesPending: true });
		expect(
			within(candidates).getByText("후보를 적용하고 있습니다."),
		).toBeTruthy();
		updateRoom(view, {
			candidatesPending: false,
			snapshot: snapshot({ listVersion: 2, candidates: applied }),
		});
		expect(
			screen.getByRole("button", { name: "결과" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(within(candidates).getByText("적용됨")).toBeTruthy();
		fireEvent.click(within(candidates).getByRole("button", { name: "한식" }));
		expect(
			(
				within(candidates).getByRole("checkbox", {
					name: excludedName,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(
			(
				within(candidates).getByRole("checkbox", {
					name: `${korean[1].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		fireEvent.click(within(candidates).getByRole("button", { name: "한식" }));
		fireEvent.click(within(candidates).getByRole("button", { name: "전체" }));
		for (const category of lunchCategories)
			expect(
				within(candidates)
					.getByRole("button", { name: category })
					.getAttribute("aria-pressed"),
			).toBe("true");
		expect(
			(
				within(candidates).getByRole("checkbox", {
					name: excludedName,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(room.updateCandidates).toHaveBeenCalledTimes(1);
	});

	it("keeps an unsaved draft through chat snapshots and resets only on undo or an external candidate version", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ candidates: [...sampleLunchPlaces] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		const name = `${sampleLunchPlaces[0].name} 추첨 포함`;
		fireEvent.click(within(candidates).getByRole("checkbox", { name }));
		updateRoom(view, {
			snapshot: snapshot({
				candidates: [...sampleLunchPlaces],
				messages: [
					{
						id: "new-chat",
						participantId: "guest-client",
						name: "참가자",
						text: "목록 편집 중에도 채팅",
						timestamp: baseTime,
					},
				],
			}),
		});
		expect(
			(within(candidates).getByRole("checkbox", { name }) as HTMLInputElement)
				.checked,
		).toBe(false);
		expect(within(candidates).getByText("변경사항 있음")).toBeTruthy();
		fireEvent.click(
			within(candidates).getByRole("button", { name: "변경 취소" }),
		);
		expect(
			(within(candidates).getByRole("checkbox", { name }) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(within(candidates).getByText("적용됨")).toBeTruthy();
		fireEvent.click(within(candidates).getByRole("checkbox", { name }));
		const external = sampleLunchPlaces.filter(
			(place) => place.category === "한식",
		);
		updateRoom(view, {
			snapshot: snapshot({ listVersion: 3, candidates: external }),
		});
		expect(within(candidates).getAllByRole("checkbox")).toHaveLength(
			external.length,
		);
		expect(
			within(candidates)
				.getAllByRole("checkbox")
				.every((input) => (input as HTMLInputElement).checked),
		).toBe(true);
		expect(within(candidates).getByText("적용됨")).toBeTruthy();
		expect(
			within(candidates)
				.getByRole("button", { name: "편의점" })
				.getAttribute("aria-pressed"),
		).toBe("false");
		expect(room.updateCandidates).not.toHaveBeenCalled();
	});

	it("validates an empty selection at the single top apply action and locks pending controls", () => {
		room.self = { id: "host-client", isHost: true };
		const view = render(<LunchRoomPage roomId={roomId} />);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		const apply = within(candidates).getByRole("button", { name: "후보 적용" });
		expect(
			within(candidates).getAllByRole("button", { name: "후보 적용" }),
		).toHaveLength(1);
		expect(
			apply.closest(".room-candidate-toolbar")?.parentElement?.tagName,
		).toBe("FORM");
		fireEvent.click(
			within(candidates).getByRole("button", { name: "선택 해제" }),
		);
		fireEvent.click(apply);
		expect(within(candidates).getByRole("alert").textContent).toBe(
			"음식점을 2곳 이상 선택해 주세요.",
		);
		expect(document.activeElement).toBe(
			within(candidates).getByRole("heading", { name: "추첨 후보" }),
		);
		expect(room.updateCandidates).not.toHaveBeenCalled();
		fireEvent.click(
			within(candidates).getByRole("button", { name: "모두 선택" }),
		);
		fireEvent.click(apply);
		expect(room.updateCandidates).toHaveBeenCalledExactlyOnceWith(
			sampleLunchPlaces.map((place) => place.id),
		);
		updateRoom(view, { candidatesPending: true });
		expect(within(candidates).getAllByRole("checkbox")).toHaveLength(
			sampleLunchPlaces.length,
		);
		for (const control of [
			...within(candidates).getAllByRole("checkbox"),
			...within(candidates).getAllByRole("button"),
		])
			expect(control.matches(":disabled")).toBe(true);
	});

	it("treats guest categories as a view filter while preserving every actual draw candidate", () => {
		const applied = [
			"편의점",
			"카페/베이커리/패스트푸드",
			"샐러드",
			"한식",
		].map((category) => {
			const place = sampleLunchPlaces.find(
				(item) => item.category === category,
			);
			if (!place)
				throw new Error(`Expected a source restaurant in ${category}`);
			return place;
		});
		room.snapshot = snapshot({ candidates: applied });
		render(<LunchRoomPage roomId={roomId} />);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		expect(
			within(candidates).getByText("표시 4곳 · 실제 추첨 4곳"),
		).toBeTruthy();
		fireEvent.click(within(candidates).getByRole("button", { name: "편의점" }));
		fireEvent.click(within(candidates).getByRole("button", { name: "샐러드" }));
		expect(
			within(candidates).getByText("표시 2곳 · 실제 추첨 4곳"),
		).toBeTruthy();
		expect(within(candidates).queryByText(applied[0].name)).toBeNull();
		expect(within(candidates).getByText(applied[1].name)).toBeTruthy();
		expect(
			document
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("4");
		for (const category of lunchCategories.filter(
			(category) => category !== "편의점" && category !== "샐러드",
		))
			fireEvent.click(
				within(candidates).getByRole("button", { name: category }),
			);
		expect(
			within(candidates).getByText(
				"선택한 분류의 후보가 없습니다. 다른 분류를 켜 보세요.",
			),
		).toBeTruthy();
		fireEvent.click(within(candidates).getByRole("button", { name: "전체" }));
		expect(
			within(candidates).getByText("표시 4곳 · 실제 추첨 4곳"),
		).toBeTruthy();
		expect(within(candidates).queryByRole("checkbox")).toBeNull();
		expect(
			within(candidates).queryByRole("button", { name: "후보 적용" }),
		).toBeNull();
		expect(room.updateCandidates).not.toHaveBeenCalled();
		expect(room.startDraw).not.toHaveBeenCalled();
	});

	it("clears a failed submission before accepting a later external version with the same candidate ids", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ candidates: [...sampleLunchPlaces] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const candidates = screen.getByRole("region", { name: "추첨 후보" });
		const korean = sampleLunchPlaces.find((place) => place.category === "한식");
		const name = `${korean?.name} 추첨 포함`;
		fireEvent.click(within(candidates).getByRole("checkbox", { name }));
		fireEvent.click(within(candidates).getByRole("button", { name: "한식" }));
		fireEvent.click(
			within(candidates).getByRole("button", { name: "후보 적용" }),
		);
		updateRoom(view, { candidatesPending: true });
		updateRoom(view, {
			candidatesPending: false,
			error: "후보를 적용하지 못했습니다.",
		});
		updateRoom(view, {
			error: "",
			snapshot: snapshot({
				listVersion: 2,
				candidates: sampleLunchPlaces.filter(
					(place) => place.category !== "한식",
				),
			}),
		});
		fireEvent.click(within(candidates).getByRole("button", { name: "한식" }));
		expect(
			(within(candidates).getByRole("checkbox", { name }) as HTMLInputElement)
				.checked,
		).toBe(true);
		expect(room.updateCandidates).toHaveBeenCalledTimes(1);
	});

	it("shows room lifetime, host-offline notice and a profile below the conversation", () => {
		room.snapshot = snapshot({
			participants: [{ id: "guest-client", name: "참가자", isHost: false }],
		});
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByText(/^방장이 오프라인입니다\. 채팅하며 기다릴 수 있고/),
		).toBeTruthy();
		expect(screen.getByText(/방장이 나가도 생성 후 24시간/)).toBeTruthy();
		const times = document.querySelectorAll(".room-lifetime time");
		expect(times).toHaveLength(2);
		expect(times[0].getAttribute("datetime")).toBe(
			new Date(room.snapshot?.createdAt ?? 0).toISOString(),
		);
		expect(times[1].getAttribute("datetime")).toBe(
			new Date(room.snapshot?.expiresAt ?? 0).toISOString(),
		);
		expect(
			screen
				.getByRole("log", { name: "방 채팅 메시지" })
				.compareDocumentPosition(
					screen.getByRole("button", { name: /^내 프로필:/ }),
				),
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("replaces a closed room with a clear new-room action and removes prior room content", () => {
		room.connection = "closed";
		room.error = "이 방의 이용 시간이 끝났습니다.";
		room.snapshot = snapshot({
			status: "closed",
			draw: draw(),
			messages: [
				{
					id: "old-chat",
					name: "방장",
					participantId: "host-client",
					text: "종료된 방의 이전 대화",
					timestamp: baseTime,
				},
			],
		});
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByRole("region", { name: "이 방의 이용이 끝났습니다" }),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "새 방 만들기" }).getAttribute("href"),
		).toBe("/create");
		expect(screen.queryByRole("log")).toBeNull();
		expect(animate).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByText("종료된 방의 이전 대화")).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "이 방의 이용이 끝났습니다" }),
		);
	});

	it("keeps nickname editing compact and restores focus after cancel without renaming", () => {
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("textbox", { name: "닉네임" })).toBeNull();
		const trigger = screen.getByRole("button", { name: /^내 프로필:/ });
		fireEvent.click(trigger);
		const field = screen.getByRole("textbox", {
			name: "닉네임",
		}) as HTMLInputElement;
		expect(document.activeElement).toBe(field);
		fireEvent.change(field, { target: { value: "저장하지 않은 이름" } });
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(screen.queryByRole("textbox", { name: "닉네임" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
		expect(trigger.getAttribute("aria-expanded")).toBe("false");
		expect(room.rename).not.toHaveBeenCalled();
		fireEvent.click(trigger);
		expect(
			(screen.getByRole("textbox", { name: "닉네임" }) as HTMLInputElement)
				.value,
		).toBe(room.nickname);
		fireEvent.keyDown(screen.getByRole("textbox", { name: "닉네임" }), {
			key: "Escape",
		});
		expect(screen.queryByRole("dialog", { name: "내 프로필" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
		fireEvent.click(trigger);
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole("dialog", { name: "내 프로필" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("distinguishes own/other/system messages and keeps old own messages after a reconnect", () => {
		room.snapshot = snapshot({
			messages: [
				{
					id: "mine",
					participantId: "guest-client",
					name: "참가자",
					text: "내 메시지",
					timestamp: baseTime,
				},
				{
					id: "other",
					participantId: "host-client",
					name: "방장",
					text: "다른 사람 메시지",
					timestamp: baseTime + 1,
				},
				{
					id: "system-joined",
					participantId: "system",
					name: "시스템",
					text: "새 참가자가 들어왔습니다.",
					timestamp: baseTime + 2,
					event: "joined",
				},
			],
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen
				.getByText("내 메시지")
				.closest("li")
				?.classList.contains("is-mine"),
		).toBe(true);
		expect(
			screen
				.getByText("다른 사람 메시지")
				.closest("li")
				?.classList.contains("is-other"),
		).toBe(true);
		expect(
			screen
				.getByText("새 참가자가 들어왔습니다.")
				.closest("li")
				?.classList.contains("room-chat-system"),
		).toBe(true);
		expect(document.querySelectorAll(".room-chat-system")).toHaveLength(1);
		updateRoom(view, { connection: "reconnecting", self: null });
		expect(
			screen
				.getByText("내 메시지")
				.closest("li")
				?.classList.contains("is-mine"),
		).toBe(true);
		expect(
			screen.getAllByText("연결이 끊겼습니다. 다시 연결하고 있습니다."),
		).toHaveLength(1);
		updateRoom(view, {
			connection: "connected",
			self: { id: "guest-new-connection", isHost: false },
		});
		expect(
			screen
				.getByText("내 메시지")
				.closest("li")
				?.classList.contains("is-mine"),
		).toBe(true);
		expect(screen.getAllByText("다시 연결되었습니다.")).toHaveLength(1);
		updateRoom(view, { nickname: "변경 후 이름" });
		expect(screen.getAllByText("다시 연결되었습니다.")).toHaveLength(1);
		expect(room.sendChat).not.toHaveBeenCalled();
		expect(room.startDraw).not.toHaveBeenCalled();
	});

	it("shows and copies the immutable detailed draw snapshot instead of current participants", async () => {
		const completed = {
			...draw(baseTime - 8000),
			candidates: sampleLunchPlaces.slice(0, 2).map((place) => ({ ...place })),
			requestedAt: baseTime - 11000,
			participants: [
				{ id: "past-host", name: "요청 당시 방장", isHost: true },
				{ id: "past-guest", name: "요청 당시 손님", isHost: false },
				{ id: "past-long", name: "가".repeat(20), isHost: false },
			],
			probabilities: [0.5, 0.5],
		};
		room.snapshot = snapshot({
			draw: completed,
			history: [completed],
			participants: [
				{ id: "present-user", name: "현재 새 참가자", isHost: false },
			],
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(
			within(
				screen.getByRole("region", { name: sampleLunchPlaces[1].name }),
			).queryByText("상세 기록"),
		).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		const history = screen.getByRole("region", { name: "방 추첨 기록" });
		fireEvent.click(
			within(history).getByRole("button", {
				name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
			}),
		);
		const details = screen.getByRole("dialog", {
			name: `${sampleLunchPlaces[1].name} 상세 기록`,
		});
		expect(within(details).getByText("요청 당시 방장")).toBeTruthy();
		expect(within(details).getByText("요청 당시 손님")).toBeTruthy();
		expect(within(details).getByText("가".repeat(20))).toBeTruthy();
		expect(within(details).queryByText("현재 새 참가자")).toBeNull();
		expect(within(details).getAllByText("1/2 · 약 50%")).toHaveLength(2);
		expect(
			Array.from(
				details.querySelectorAll("time"),
				(element) => element.dateTime,
			),
		).toEqual(
			[
				completed.requestedAt,
				completed.timestamp,
				completed.startedAt,
				completed.startedAt + completed.durationMs,
			].map((time) => new Date(time).toISOString()),
		);
		completed.candidates[0].name = "나중에 바뀐 후보";
		completed.participants[0].name = "나중에 바뀐 참가자";
		completed.probabilities[0] = 0.75;
		updateRoom(view, {
			snapshot: snapshot({
				history: [],
				draw: null,
				listVersion: 2,
				candidates: sampleLunchPlaces.slice(2, 4),
			}),
		});
		expect(within(details).getByText(sampleLunchPlaces[0].name)).toBeTruthy();
		expect(within(details).getByText("요청 당시 방장")).toBeTruthy();
		expect(within(details).getAllByText("1/2 · 약 50%")).toHaveLength(2);
		await act(async () =>
			fireEvent.click(
				within(details).getByRole("button", {
					name: "전체 기록 복사",
				}),
			),
		);
		const copied = writeText.mock.calls[0][0];
		for (const text of [
			completed.id,
			"요청 당시 방장 (방장)",
			"요청 당시 손님",
			"난수 결과 생성",
			"공개 예정 시각",
			new Date(completed.requestedAt).toISOString(),
			sampleLunchPlaces[0].name,
			sampleLunchPlaces[1].name,
			"1/2 · 약 50%",
			"출처: quantum",
		])
			expect(copied).toContain(text);
		expect(copied).not.toContain("현재 새 참가자");
		expect(copied).not.toContain("나중에 바뀐");
		fireEvent.keyDown(details, { key: "Escape" });
		await act(async () => vi.advanceTimersByTime(0));
		expect(screen.queryByRole("dialog", { name: / 상세 기록$/ })).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "방 추첨 기록" }),
		);
	});

	it("labels missing legacy participants and derived uniform probabilities honestly", async () => {
		room.snapshot = snapshot({
			history: [{ ...draw(baseTime - 8000), participants: undefined }],
			participants: [
				{ id: "present-user", name: "현재 사용자 이름", isHost: false },
			],
		});
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		const history = screen.getByRole("region", { name: "방 추첨 기록" });
		fireEvent.click(
			within(history).getByRole("button", {
				name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
			}),
		);
		const details = screen.getByRole("dialog", {
			name: `${sampleLunchPlaces[1].name} 상세 기록`,
		});
		expect(
			within(details).getByText("이전 기록에는 참가자 정보가 없습니다."),
		).toBeTruthy();
		expect(
			within(details).getByText(
				/후보 수에 따른 균등 추첨 기준으로 계산했습니다/,
			),
		).toBeTruthy();
		expect(within(details).getAllByText("1/2 · 약 50%")).toHaveLength(2);
		await act(async () =>
			fireEvent.click(
				within(details).getByRole("button", {
					name: "전체 기록 복사",
				}),
			),
		);
		expect(writeText.mock.calls[0][0]).toContain(
			"이전 기록에는 참가자 정보가 없습니다",
		);
		expect(writeText.mock.calls[0][0]).not.toContain("현재 사용자 이름");
	});

	it("shows online, away and offline roster members in a dismissible overlay with a legacy fallback", () => {
		room.snapshot = snapshot({
			members: [
				{
					id: "host-client",
					name: "온라인 방장",
					isHost: true,
					status: "online",
					lastActiveAt: baseTime,
					lastSeenAt: baseTime,
				},
				{
					id: "guest-client",
					name: "자리 비운 참가자",
					isHost: false,
					status: "away",
					lastActiveAt: baseTime - 300000,
					lastSeenAt: baseTime,
				},
				{
					id: "offline-client",
					name: "나간 참가자",
					isHost: false,
					status: "offline",
					lastActiveAt: baseTime - 600000,
					lastSeenAt: baseTime - 500000,
				},
			],
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		const trigger = screen.getByRole("button", { name: "참가자 3명" });
		fireEvent.click(trigger);
		const roster = screen.getByRole("dialog", { name: "참가자" });
		for (const [name, status] of [
			["온라인 방장", "온라인"],
			["자리 비운 참가자", "자리비움"],
			["나간 참가자", "오프라인"],
		]) {
			const row = within(roster).getByText(name).closest("li");
			expect(row).not.toBeNull();
			expect(within(row as HTMLElement).getByText(status)).toBeTruthy();
		}
		expect(within(roster).getByText(/5분 동안 활동이 없으면/)).toBeTruthy();
		fireEvent.keyDown(roster, { key: "Escape" });
		expect(screen.queryByRole("dialog", { name: "참가자" })).toBeNull();
		expect(document.activeElement).toBe(trigger);
		updateRoom(view, { snapshot: snapshot() });
		fireEvent.click(screen.getByRole("button", { name: "참가자 2명" }));
		expect(
			within(screen.getByRole("dialog", { name: "참가자" })).getAllByText(
				"온라인",
			),
		).toHaveLength(2);
		updateRoom(view, { connection: "reconnecting", self: null });
		expect(
			screen
				.getByRole("button", { name: /^내 프로필:/ })
				.getAttribute("aria-label"),
		).toContain("재연결 중");
	});

	it("sends with the icon or Enter while preserving IME composition and Shift+Enter", () => {
		render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", { name: "메시지" });
		expect(
			screen
				.getByRole("button", { name: "메시지 보내기" })
				.matches(":disabled"),
		).toBe(true);
		fireEvent.change(input, { target: { value: "한글 입력" } });
		fireEvent.compositionStart(input);
		fireEvent.keyDown(input, { key: "Enter" });
		expect(room.sendChat).not.toHaveBeenCalled();
		fireEvent.compositionEnd(input);
		fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
		fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
		expect(room.sendChat).not.toHaveBeenCalled();
		fireEvent.keyDown(input, { key: "Enter" });
		expect(room.sendChat).toHaveBeenCalledExactlyOnceWith("한글 입력");
		expect(
			screen
				.getByRole("button", { name: "메시지 보내기" })
				.matches(":disabled"),
		).toBe(true);
		fireEvent.change(input, { target: { value: "버튼으로 전송" } });
		fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
		expect(room.sendChat).toHaveBeenCalledTimes(2);
		expect(room.sendChat).toHaveBeenLastCalledWith("버튼으로 전송");
	});

	it("groups only consecutive messages from the same author and minute, stopping at system events", () => {
		room.snapshot = snapshot({
			messages: [
				{
					id: "first",
					participantId: "host-client",
					name: "방장",
					text: "첫 메시지",
					timestamp: baseTime + 1000,
				},
				{
					id: "second",
					participantId: "host-client",
					name: "방장",
					text: "같은 묶음",
					timestamp: baseTime + 2000,
				},
				{
					id: "next-minute",
					participantId: "host-client",
					name: "방장",
					text: "다음 분",
					timestamp: baseTime + 61000,
				},
				{
					id: "notice",
					participantId: "system",
					name: "시스템",
					event: "joined",
					text: "참가했습니다",
					timestamp: baseTime + 62000,
				},
				{
					id: "after-notice",
					participantId: "host-client",
					name: "방장",
					text: "알림 다음",
					timestamp: baseTime + 63000,
				},
				{
					id: "same-name",
					participantId: "another-client",
					name: "방장",
					text: "이름이 같은 다른 사람",
					timestamp: baseTime + 63001,
				},
			],
		});
		render(<LunchRoomPage roomId={roomId} />);
		const first = screen.getByText("첫 메시지").closest("li") as HTMLElement;
		const second = screen.getByText("같은 묶음").closest("li") as HTMLElement;
		expect(within(first).getByText("방장")).toBeTruthy();
		expect(first.querySelector("time")).toBeNull();
		expect(second.querySelector(".room-message-author")).toBeNull();
		expect(second.querySelectorAll("time")).toHaveLength(1);
		for (const text of ["다음 분", "알림 다음", "이름이 같은 다른 사람"])
			expect(
				within(screen.getByText(text).closest("li") as HTMLElement).getByText(
					"방장",
				),
			).toBeTruthy();
		expect(
			screen
				.getByText("참가했습니다")
				.closest("li")
				?.classList.contains("room-chat-system"),
		).toBe(true);
	});

	it("opens a native history action in a nonmodal dialog and keeps desktop chat keyboard-accessible", async () => {
		room.snapshot = snapshot({ history: [draw(baseTime - 8000)] });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		const trigger = screen.getByRole("button", {
			name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
		});
		expect(trigger.getAttribute("type")).toBe("button");
		expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
		expect(trigger.querySelector("button")).toBeNull();
		trigger.focus();
		fireEvent.click(trigger);
		const dialog = screen.getByRole("dialog", {
			name: `${sampleLunchPlaces[1].name} 상세 기록`,
		});
		expect(dialog.getAttribute("aria-modal")).toBeNull();
		expect(document.activeElement).toBe(
			within(dialog).getByRole("heading", {
				name: `${sampleLunchPlaces[1].name} 상세 기록`,
			}),
		);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "채팅으로 이동" }),
		);
		const chat = screen.getByRole("textbox", { name: "메시지" });
		expect(document.activeElement).toBe(chat);
		fireEvent.change(chat, { target: { value: "기록을 보며 채팅" } });
		fireEvent.keyDown(chat, { key: "Enter" });
		expect(room.sendChat).toHaveBeenCalledExactlyOnceWith("기록을 보며 채팅");
		expect(
			screen.getByRole("dialog", {
				name: `${sampleLunchPlaces[1].name} 상세 기록`,
			}),
		).toBe(dialog);
		fireEvent.keyDown(chat, { key: "Escape" });
		await act(async () => vi.advanceTimersByTime(0));
		expect(screen.queryByRole("dialog", { name: / 상세 기록$/ })).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("traps mobile dialog focus and keeps manual-copy help inside the dialog", async () => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(max-width: 900px)",
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		);
		writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
		room.snapshot = snapshot({ history: [draw(baseTime - 8000)] });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		const trigger = screen.getByRole("button", {
			name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
		});
		fireEvent.click(trigger);
		const dialog = screen.getByRole("dialog", {
			name: `${sampleLunchPlaces[1].name} 상세 기록`,
		});
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		const first = within(dialog).getByRole("button", {
			name: "상세 기록 닫기",
		});
		const last = within(dialog).getByRole("button", {
			name: "닫기",
		});
		last.focus();
		fireEvent.keyDown(last, { key: "Tab" });
		expect(document.activeElement).toBe(first);
		fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(last);
		const copyButton = within(dialog).getByRole("button", {
			name: "전체 기록 복사",
		});
		await act(async () => fireEvent.click(copyButton));
		const field = within(dialog).getByRole("textbox", { name: "복사할 결과" });
		expect(document.activeElement).toBe(field);
		expect(field.closest('[role="dialog"]')).toBe(dialog);
		fireEvent.click(
			within(dialog).getByRole("button", { name: "복사 도움말 닫기" }),
		);
		expect(document.activeElement).toBe(copyButton);
		fireEvent.click(first);
		await act(async () => vi.advanceTimersByTime(0));
		expect(document.activeElement).toBe(trigger);
	});

	it("removes an open record and ignores a late copy failure when the room closes", async () => {
		let rejectCopy: (error: Error) => void = () => {};
		writeText.mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectCopy = reject;
			}),
		);
		const completed = {
			...draw(baseTime - 8000),
			participants: [
				{ id: "old-user", name: "종료된 기록 속 이름", isHost: true },
			],
		};
		room.snapshot = snapshot({ history: [completed] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "결과" }));
		fireEvent.click(
			screen.getByRole("button", {
				name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
			}),
		);
		const dialog = screen.getByRole("dialog", {
			name: `${sampleLunchPlaces[1].name} 상세 기록`,
		});
		await act(async () =>
			fireEvent.click(
				within(dialog).getByRole("button", { name: "전체 기록 복사" }),
			),
		);
		updateRoom(view, {
			connection: "closed",
			snapshot: snapshot({ status: "closed", history: [completed] }),
			error: "방 이용이 끝났습니다.",
		});
		await act(async () => {
			rejectCopy(new Error("too late"));
			vi.advanceTimersByTime(0);
		});
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByRole("textbox", { name: "복사할 결과" })).toBeNull();
		expect(screen.queryByText("종료된 기록 속 이름")).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "이 방의 이용이 끝났습니다" }),
		);
	});
});
