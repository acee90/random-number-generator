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
import { useLunchRoom } from "../src/hooks/useLunchRoom";
import { candidateLibraryKey } from "../src/lib/candidateLibrary";
import {
	defaultCandidateListSourceId,
	readCandidateListUsage,
} from "../src/lib/candidateListUsage";
import { getWheelRotation, sampleLunchPlaces } from "../src/lib/lunch";
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

function candidateRows() {
	return within(
		screen.getByRole("list", { name: "후보 편집 목록" }),
	).getAllByRole("listitem");
}

function candidateName(index = 1): HTMLInputElement {
	const label = `${index}번 후보 이름`;
	const input = screen.queryByRole("textbox", { name: label });
	if (input) return input as HTMLInputElement;
	const row = candidateRows()[index - 1];
	fireEvent.click(within(row).getByRole("button", { name: /이름 수정$/ }));
	return screen.getByRole("textbox", { name: label }) as HTMLInputElement;
}

function filterButton() {
	return screen.getByRole("button", { name: "필터" });
}

function listAction(name: string) {
	fireEvent.keyDown(screen.getByRole("button", { name: "목록 작업" }), {
		key: "ArrowDown",
	});
	const action = screen.getByRole("menuitem", { name });
	fireEvent.click(action);
}

function setCandidateCategory(index: number, value: string) {
	fireEvent.click(
		within(candidateRows()[index - 1]).getByRole("button", {
			name: /분류 .* 변경$/,
		}),
	);
	const dialog = screen.getByRole("dialog", { name: "분류 변경" });
	fireEvent.change(
		within(dialog).getByRole("combobox", { name: "분류 (선택)" }),
		{ target: { value } },
	);
	fireEvent.click(within(dialog).getByRole("button", { name: "적용" }));
}

function removeCandidate(name: string) {
	fireEvent.keyDown(screen.getByRole("button", { name: `${name} 후보 관리` }), {
		key: "ArrowDown",
	});
	fireEvent.click(screen.getByRole("menuitem", { name: "후보 삭제" }));
}

function saveDraftBeforeStage() {
	fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" }));
}

describe("local chat delivery display", () => {
	function localChat(delivery: "sending" | "failed" | "unconfirmed") {
		return {
			id: "local-chat",
			roomId,
			participantId: "guest-client",
			name: "참가자",
			text: "곧 보이는 메시지",
			timestamp: baseTime,
			delivery,
		};
	}

	it("confirms host-only closure, preserves cancellation and allows retry after failure", async () => {
		room.self = { id: "host-client", isHost: true };
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		fireEvent.click(screen.getByRole("button", { name: "방 종료" }));
		let confirmation = screen.getByRole("alertdialog");
		expect(
			within(confirmation).getByText(/모든 참가자의 이용이 종료/),
		).toBeTruthy();
		fireEvent.click(within(confirmation).getByRole("button", { name: "취소" }));
		expect(room.closeRoom).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "방 종료" }));
		confirmation = screen.getByRole("alertdialog");
		vi.mocked(room.closeRoom).mockResolvedValueOnce(false);
		await act(async () =>
			fireEvent.click(
				within(confirmation).getByRole("button", { name: "방 종료" }),
			),
		);
		expect(within(confirmation).getByRole("alert").textContent).toContain(
			"다시 시도",
		);
		await act(async () =>
			fireEvent.click(
				within(confirmation).getByRole("button", { name: "방 종료" }),
			),
		);
		expect(room.closeRoom).toHaveBeenCalledTimes(2);
		expect(screen.queryByRole("alertdialog")).toBeNull();
	});

	it("does not offer closure to guests", () => {
		room.self = { id: "guest-client", isHost: false };
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		expect(screen.queryByRole("button", { name: "방 종료" })).toBeNull();
	});

	it("labels an immediate message as sending and shows one confirmed copy when the server acknowledges it", () => {
		const local = localChat("sending");
		room.localChatMessages = [local];
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.getAllByText(local.text)).toHaveLength(1);
		expect(screen.getByText("전송 중…")).toBeTruthy();
		updateRoom(view, {
			snapshot: snapshot({
				messages: [
					{
						id: local.id,
						participantId: local.participantId,
						name: local.name,
						text: local.text,
						timestamp: baseTime + 1000,
					},
				],
			}),
		});
		expect(screen.getAllByText(local.text)).toHaveLength(1);
		expect(screen.queryByText("전송 중…")).toBeNull();
	});

	it("retains failed text for manual editing without replacing an existing draft", () => {
		const failed = localChat("failed");
		room.localChatMessages = [failed];
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.getByText("전송 실패")).toBeTruthy();
		const input = screen.getByRole("textbox", { name: "메시지" });
		fireEvent.change(input, { target: { value: "새로 작성 중" } });
		const restore = screen.getByRole("button", { name: "다시 작성" });
		expect(restore.matches(":disabled")).toBe(true);
		fireEvent.click(restore);
		expect((input as HTMLTextAreaElement).value).toBe("새로 작성 중");
		expect(room.dismissLocalChat).not.toHaveBeenCalled();
		fireEvent.change(input, { target: { value: "" } });
		fireEvent.click(restore);
		expect((input as HTMLTextAreaElement).value).toBe(failed.text);
		expect(room.dismissLocalChat).toHaveBeenCalledExactlyOnceWith(failed.id);
		expect(document.activeElement).toBe(input);
	});

	it("distinguishes an unconfirmed send from a rejection and offers no automatic resend", () => {
		room.localChatMessages = [localChat("unconfirmed")];
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.getByText("전송 확인 안 됨")).toBeTruthy();
		expect(
			screen.getByText("같은 내용을 다시 보내기 전에 확인해 주세요."),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "다시 작성" })).toBeNull();
		expect(room.sendChat).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "표시 닫기" }));
		expect(room.dismissLocalChat).toHaveBeenCalledExactlyOnceWith("local-chat");
		expect(room.sendChat).not.toHaveBeenCalled();
	});

	it("keeps old unconfirmed text and its dismiss action accessible when the server history fills up", () => {
		room.localChatMessages = [
			{ ...localChat("unconfirmed"), timestamp: baseTime - 100000 },
		];
		room.snapshot = snapshot({
			messages: Array.from({ length: 100 }, (_, index) => ({
				id: `confirmed-${index}`,
				participantId: "host-client",
				name: "방장",
				text: `서버 메시지 ${index}`,
				timestamp: baseTime + index,
			})),
		});
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.getByText("곧 보이는 메시지")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "표시 닫기" }));
		expect(room.dismissLocalChat).toHaveBeenCalledExactlyOnceWith("local-chat");
	});
});

describe("current result feedback and frozen history", () => {
	it("lets the host cast one ballot and waits for its acknowledgement before closing the result", () => {
		room.self = { id: "host-client", isHost: true };
		const current = { ...draw(baseTime - 8000), votes: [] };
		room.snapshot = snapshot({ draw: current, status: "result" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const next = screen.getByRole("button", {
			name: "다음 게임",
		});
		expect(next.matches(":disabled")).toBe(false);
		expect(
			screen.getByRole("heading", { name: current.candidates[1].name }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(room.vote).toHaveBeenCalledExactlyOnceWith(current.id, "up");
		updateRoom(view, { votePendingDrawId: current.id });
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(room.vote).toHaveBeenCalledOnce();
		expect(next.matches(":disabled")).toBe(true);
		expect(
			screen.getByRole("button", { name: "후보 편집" }).matches(":disabled"),
		).toBe(true);
		fireEvent.click(next);
		expect(room.nextRound).not.toHaveBeenCalled();
		updateRoom(view, {
			votePendingDrawId: null,
			snapshot: snapshot({
				status: "result",
				draw: {
					...current,
					votes: [
						{
							participantId: "host-client",
							name: "방장",
							vote: "up",
							timestamp: baseTime,
							reactionMs: 800,
						},
					],
				},
			}),
		});
		expect(next.matches(":disabled")).toBe(false);
		expect(screen.getByText("1명 참여")).toBeTruthy();
		expect(
			within(
				screen.getByRole("list", { name: "좋아요 투표한 참가자" }),
			).getByText("방장"),
		).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		fireEvent.click(next);
		expect(room.nextRound).toHaveBeenCalledExactlyOnceWith(current.id);
		expect(room.vote).toHaveBeenCalledOnce();
	});

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
			screen
				.getByRole("button", { name: "싫어요 투표" })
				.getAttribute("aria-disabled") === "true",
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
			screen
				.getByRole("button", { name: "싫어요 투표" })
				.getAttribute("aria-disabled") === "true",
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
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-disabled") === "true",
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
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-disabled") === "true",
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
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-disabled") === "true",
		).toBe(true);
		expect(screen.getByText(/추첨 시작 후 입장해/)).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: /룰렛 다시 보기|다음 게임|한 번 더 추첨하기/,
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
		fireEvent.click(screen.getByRole("button", { name: "다음 게임" }));
		expect(room.nextRound).toHaveBeenCalledExactlyOnceWith(current.id);
		expect(room.startDraw).not.toHaveBeenCalled();
		updateRoom(view, { nextPending: true });
		expect(
			screen
				.getByRole("button", { name: "대기 화면으로 이동 중…" })
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
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
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
		.mockImplementation(async (url, options) => {
			if (String(url).endsWith("/entry-info"))
				return Response.json({ title: "오늘 점심 함께 골라요" });
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
		entryLoading: false,
		enter: vi.fn(() => true),
		error: "",
		startPending: false,
		nextPending: false,
		candidatesPending: false,
		mutationPending: null,
		votePendingDrawId: null,
		clockOffset: 0,
		serverNow: () => Date.now(),
		rename: vi.fn(() => true),
		sendChat: vi.fn(() => true),
		startDraw: vi.fn(() => true),
		nextRound: vi.fn(() => true),
		updateCandidates: vi.fn(() => true),
		enterEditing: vi.fn(async () => true),
		openIntake: vi.fn(async () => true),
		closeIntake: vi.fn(async () => true),
		finalizeIntake: vi.fn(async () => true),
		addCandidate: vi.fn(async () => true),
		removeCandidate: vi.fn(async () => true),
		editRoom: vi.fn(async () => true),
		closeRoom: vi.fn(async () => true),
		updateRoomOptions: vi.fn(async () => true),
		updateGameFilter: vi.fn(async () => true),
		resetExclusions: vi.fn(async () => true),
		vote: vi.fn(() => true),
		reconnect: vi.fn(),
		clearError: vi.fn(),
		localChatMessages: [],
		dismissLocalChat: vi.fn(),
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
	it("places independent room settings in the top-right and keeps candidate views read-only", async () => {
		room.self = { id: "host-client", isHost: true };
		const view = render(<LunchRoomPage roomId={roomId} />);
		const gear = screen.getByRole("button", { name: "방 설정" });
		expect(gear.closest(".room-heading-actions")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "옵션 보기" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		const candidates = screen.getByRole("dialog", { name: "후보 보기" });
		expect(within(candidates).queryByRole("textbox")).toBeNull();
		expect(within(candidates).queryByRole("checkbox")).toBeNull();
		expect(within(candidates).getAllByText("추첨 확률 50%")).toHaveLength(2);
		updateRoom(view, {
			snapshot: snapshot({ candidates: [...sampleLunchPlaces.slice(0, 3)] }),
		});
		expect(
			within(candidates).getByText(sampleLunchPlaces[2].name),
		).toBeTruthy();
		fireEvent.keyDown(candidates, { key: "Escape" });
		fireEvent.click(gear);
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		expect(
			(
				within(settings).getByRole("textbox", {
					name: "방 이름",
				}) as HTMLInputElement
			).value,
		).toBe("오늘 점심 함께 골라요");
		expect(within(settings).queryByText(sampleLunchPlaces[0].name)).toBeNull();
		expect(within(settings).queryByRole("checkbox")).toBeNull();
		expect(
			within(settings).queryByText("중복 없이 추첨 · 뽑힌 후보 제외"),
		).toBeNull();
		expect(room.enterEditing).not.toHaveBeenCalled();
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
	});

	it("refreshes readonly options when a candidate name changes with the same ID", () => {
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		const renamed = {
			...sampleLunchPlaces[0],
			name: "수정된 식당",
			category: "한식" as const,
		};
		updateRoom(view, {
			snapshot: snapshot({ candidates: [renamed, sampleLunchPlaces[1]] }),
		});
		const candidates = screen.getByRole("dialog");
		expect(candidates.textContent).toContain("수정된 식당");
		expect(candidates.textContent).toContain("한식");
		expect(candidates.textContent).not.toContain(sampleLunchPlaces[0].name);
	});

	it("closes candidate view when the shared list becomes empty and does not reopen on a later addition", async () => {
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		expect(screen.getByRole("dialog", { name: "후보 보기" })).toBeTruthy();
		updateRoom(view, {
			snapshot: snapshot({ status: "editing", candidates: [], listVersion: 2 }),
		});
		await act(async () => vi.advanceTimersByTime(0));
		expect(screen.queryByRole("dialog", { name: "후보 보기" })).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole("region", { name: "게임 진행" }),
		);
		updateRoom(view, {
			snapshot: snapshot({ status: "editing", listVersion: 3 }),
		});
		expect(screen.queryByRole("dialog", { name: "후보 보기" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		expect(screen.getByRole("dialog", { name: "후보 보기" })).toBeTruthy();
	});

	it("shows only entry preparation while resolving an automatic join, then opens the accepted room", async () => {
		localStorage.setItem("randomlab:lunch-room-name", "방 만든 사람");
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: true,
			entryLoading: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByRole("heading", { level: 1, name: "입장 준비 중…" }),
		).toBeTruthy();
		expect(screen.queryByRole("form", { name: "추첨방 입장" })).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350);
		});
		expect(fetchNicknameAvailability).not.toHaveBeenCalled();
		expect(room.enter).not.toHaveBeenCalled();
		updateRoom(view, { waitingForEntry: false, entryPending: true });
		expect(screen.getByRole("heading", { name: "입장 준비 중…" })).toBeTruthy();
		expect(screen.queryByRole("form")).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		updateRoom(view, {
			snapshot: snapshot(),
			self: { id: "host-client", isHost: true },
			connection: "connected",
			waitingForEntry: false,
			entryPending: false,
			entryLoading: false,
		});
		expect(screen.queryByRole("heading", { name: "입장 준비 중…" })).toBeNull();
		expect(screen.queryByRole("form", { name: "추첨방 입장" })).toBeNull();
		expect(screen.getByRole("heading", { name: "채팅" })).toBeTruthy();
		expect(room.enter).not.toHaveBeenCalled();
	});

	it("returns an automatically rejected nickname to the editable gate and allows another name", async () => {
		localStorage.setItem("randomlab:lunch-room-name", "방 만든 사람");
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: false,
			entryPending: true,
			entryLoading: true,
			connection: "connecting",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		const view = render(<LunchRoomPage roomId={roomId} />);
		updateRoom(view, {
			waitingForEntry: true,
			entryPending: false,
			entryLoading: false,
			error: "이미 사용 중인 닉네임입니다. 다른 이름을 입력해 주세요.",
		});
		const input = screen.getByRole("textbox", {
			name: "닉네임",
		}) as HTMLInputElement;
		expect(input.value).toBe("방 만든 사람");
		expect(input.disabled).toBe(false);
		expect(document.activeElement).toBe(input);
		expect(screen.getByRole("alert").textContent).toContain("이미 사용 중");
		expect(screen.queryByRole("heading", { name: "입장 준비 중…" })).toBeNull();
		fireEvent.change(input, { target: { value: "새 방장 이름" } });
		updateRoom(view, { error: "" });
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350);
		});
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		expect(room.enter).toHaveBeenCalledExactlyOnceWith("새 방장 이름");
	});

	it("offers a connection retry during automatic entry without opening or submitting a nickname form", () => {
		room = {
			...room,
			snapshot: null,
			self: null,
			waitingForEntry: false,
			entryPending: true,
			entryLoading: true,
			connection: "reconnecting",
			error: "연결하지 못했습니다. 다시 연결해 주세요.",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.getByRole("alert").textContent).toContain(
			"연결하지 못했습니다",
		);
		fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
		expect(room.reconnect).toHaveBeenCalledOnce();
		expect(screen.queryByRole("form")).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(room.enter).not.toHaveBeenCalled();
		updateRoom(view, { error: "", connection: "connecting" });
		expect(screen.getByRole("heading", { name: "입장 준비 중…" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "다시 연결" })).toBeNull();
		expect(screen.queryByRole("form")).toBeNull();
	});

	it.each([
		"expired",
		"missing",
	] as const)("prioritizes the %s terminal screen over automatic entry preparation", (kind) => {
		room = {
			...room,
			snapshot: kind === "expired" ? snapshot({ status: "closed" }) : null,
			self: null,
			waitingForEntry: true,
			entryPending: true,
			entryLoading: true,
			connection: "closed",
			error: "이 방에 입장할 수 없습니다.",
		};
		vi.mocked(useLunchRoom).mockReturnValue(room);
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByRole("heading", {
				name:
					kind === "expired"
						? "이 방의 이용이 끝났습니다"
						: "방에 참가할 수 없습니다",
			}),
		).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "입장 준비 중…" })).toBeNull();
		expect(screen.queryByRole("form")).toBeNull();
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(screen.queryByRole("button", { name: "다시 연결" })).toBeNull();
		expect(screen.getByRole("link", { name: "새 방 만들기" })).toBeTruthy();
		expect(room.enter).not.toHaveBeenCalled();
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
		expect(screen.getByRole("heading", { name: "점심 추첨방" })).toBeTruthy();
		expect(
			screen.getByRole("textbox", { name: "닉네임" }).getAttribute("maxlength"),
		).toBe("12");
		expect(screen.queryByRole("heading", { name: "채팅" })).toBeNull();
		expect(screen.queryByRole("button", { name: "룰렛 돌리기" })).toBeNull();
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
		expect(screen.queryByRole("heading", { name: "입장 준비 중…" })).toBeNull();
		expect(screen.getByRole("textbox", { name: "닉네임" })).toBe(input);
		expect(
			screen
				.getByRole("form", { name: "추첨방 입장" })
				.getAttribute("aria-busy"),
		).toBe("true");
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
			draw: null,
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
			screen.getByRole("button", { name: "룰렛 돌리기" }).matches(":disabled"),
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

	it("collapses the chat without unmounting its draft and restores the same controls with disclosure focus", () => {
		render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", {
			name: "메시지",
		}) as HTMLTextAreaElement;
		const log = screen.getByRole("log", { name: "방 채팅 메시지" });
		const profile = screen.getByRole("button", { name: /^내 프로필:/ });
		const toggle = screen.getByRole("button", { name: "채팅 접기" });
		const bodyId = toggle.getAttribute("aria-controls");
		expect(bodyId).toBeTruthy();
		const body = document.getElementById(bodyId ?? "");
		expect(body).not.toBeNull();
		expect(toggle.tagName).toBe("BUTTON");
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(body?.contains(log)).toBe(true);
		expect(body?.contains(input)).toBe(true);
		expect(profile.closest(".room-chat-header")).toBe(
			toggle.closest(".room-chat-header"),
		);
		expect(body?.contains(profile)).toBe(false);
		const draft = "이 메뉴 어때요?\n같이 먹어요.";
		fireEvent.change(input, { target: { value: draft } });
		fireEvent.click(screen.getByRole("button", { name: "참가자 2명" }));
		expect(screen.getByRole("dialog", { name: "참가자" })).toBeTruthy();
		toggle.focus();
		// Native button keyboard activation dispatches a click with detail 0.
		fireEvent.click(toggle, { detail: 0 });
		expect(screen.getByRole("button", { name: "채팅 펼치기" })).toBe(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("false");
		expect(toggle.getAttribute("aria-controls")).toBe(bodyId);
		expect(body?.hidden).toBe(true);
		expect(document.activeElement).toBe(toggle);
		expect(log.isConnected).toBe(true);
		expect(input.isConnected).toBe(true);
		expect(profile.isConnected).toBe(true);
		expect(input.value).toBe(draft);
		expect(screen.queryByRole("log", { name: "방 채팅 메시지" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: "메시지" })).toBeNull();
		expect(screen.getByRole("button", { name: /^내 프로필:/ })).toBe(profile);
		expect(screen.queryByRole("dialog", { name: "참가자" })).toBeNull();
		expect(room.sendChat).not.toHaveBeenCalled();
		fireEvent.click(toggle, { detail: 0 });
		expect(screen.getByRole("button", { name: "채팅 접기" })).toBe(toggle);
		expect(toggle.getAttribute("aria-expanded")).toBe("true");
		expect(body?.hidden).toBe(false);
		expect(document.activeElement).toBe(toggle);
		expect(screen.getByRole("log", { name: "방 채팅 메시지" })).toBe(log);
		expect(screen.getByRole("textbox", { name: "메시지" })).toBe(input);
		expect(screen.getByRole("button", { name: /^내 프로필:/ })).toBe(profile);
		expect(screen.queryByRole("dialog", { name: "참가자" })).toBeNull();
		expect(input.value).toBe(draft);
		fireEvent.keyDown(input, { key: "Enter" });
		expect(room.sendChat).toHaveBeenCalledExactlyOnceWith(draft);
	});

	it("keeps a single chat disclosure without a visible title and preserves the profile draft", () => {
		render(<LunchRoomPage roomId={roomId} />);
		const profile = screen.getByRole("button", { name: /^내 프로필:/ });
		expect(profile.querySelector("svg")).toBeNull();
		expect(profile.querySelector(".room-presence-dot")).toBeNull();
		expect(profile.textContent).not.toContain("온라인");
		const input = screen.getByRole("textbox", {
			name: "메시지",
		}) as HTMLTextAreaElement;
		fireEvent.change(input, { target: { value: "접어도 남는 초안" } });
		fireEvent.click(profile);
		expect(screen.getByRole("dialog", { name: "내 프로필" })).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "채팅 접기" })
				.getAttribute("aria-expanded"),
		).toBe("true");
		const header = screen.getByRole("button", { name: "채팅 접기" });
		fireEvent.click(header);
		expect(screen.queryByRole("dialog", { name: "내 프로필" })).toBeNull();
		expect(header.getAttribute("aria-expanded")).toBe("false");
		expect(
			screen.getByRole("button", { name: "채팅 펼치기" }).querySelector("svg"),
		).not.toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "채팅 펼치기" }));
		expect(input.value).toBe("접어도 남는 초안");
		expect(header.getAttribute("aria-expanded")).toBe("true");
	});

	it("keeps receiving messages while chat is collapsed and reports their unread count in the header", () => {
		const first = {
			id: "already-read-message",
			participantId: "host-client",
			name: "방장",
			text: "이전에 읽던 메시지",
			timestamp: baseTime,
		};
		room.snapshot = snapshot({ messages: [first] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const log = screen.getByRole("log", { name: "방 채팅 메시지" });
		const toggle = screen.getByRole("button", { name: "채팅 접기" });
		const header = toggle.closest(".room-chat-header") as HTMLElement;
		Object.defineProperties(log, {
			clientHeight: { configurable: true, value: 100 },
			scrollHeight: { configurable: true, value: 600 },
		});
		log.scrollTop = 100;
		fireEvent.scroll(log);
		const messages = [
			first,
			{
				...first,
				id: "unread-message-one",
				text: "아직 읽지 않은 메시지",
				timestamp: baseTime + 1000,
			},
		];
		updateRoom(view, { snapshot: snapshot({ messages }) });
		expect(
			screen.getByRole("button", { name: "새 메시지 1개 보기" }),
		).toBeTruthy();
		fireEvent.click(toggle);
		expect(log.isConnected).toBe(true);
		expect(within(log).getByText(messages[1].text)).toBeTruthy();
		expect(within(header).getByText(/새 메시지 1개/)).toBeTruthy();
		const latest = {
			...first,
			id: "collapsed-message-two",
			text: "접은 동안 도착한 메시지",
			timestamp: baseTime + 2000,
		};
		updateRoom(view, {
			snapshot: snapshot({ messages: [...messages, latest] }),
		});
		expect(within(header).getByText(/새 메시지 2개/)).toBeTruthy();
		expect(screen.queryByRole("log", { name: "방 채팅 메시지" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "채팅 펼치기" }));
		expect(screen.getByRole("log", { name: "방 채팅 메시지" })).toBe(log);
		expect(within(log).getByText(latest.text)).toBeTruthy();
		expect(log.scrollTop).toBe(100);
		fireEvent.click(screen.getByRole("button", { name: "새 메시지 2개 보기" }));
		expect(log.scrollTop).toBe(600);
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

	it("shows completed room history with details only and does not expose the active draw", async () => {
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
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		const history = screen.getByRole("region", { name: "추첨 기록" });
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
		expect(
			within(history).queryByRole("button", { name: /기록 복사/ }),
		).toBeNull();
		expect(writeText).not.toHaveBeenCalled();
		expect(localStorage.getItem(lunchHistoryKey)).toBeNull();
	});

	it("keeps the waiting roulette compact and opens candidate names from the header popup", () => {
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("navigation", { name: "추첨 도구" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: "새 후보 이름" })).toBeNull();
		expect(document.querySelector(".room-current-candidates")).toBeNull();
		expect(screen.queryByRole("switch", { name: "후보 추천받기" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		const popup = screen.getByRole("dialog", { name: "후보 보기" });
		for (const candidate of sampleLunchPlaces.slice(0, 2))
			expect(within(popup).getByText(candidate.name)).toBeTruthy();
		expect(within(popup).getAllByText("추첨 확률 50%")).toHaveLength(2);
		expect(within(popup).queryByRole("textbox")).toBeNull();
		fireEvent.click(within(popup).getAllByRole("button", { name: "닫기" })[0]);
		expect(
			screen
				.getByRole("button", { name: "방장이 추첨을 시작할 때까지 대기" })
				.matches(":disabled"),
		).toBe(true);
	});

	it("provides intake close and immediate finalization without a roulette on the list screen", async () => {
		const candidates = sampleLunchPlaces.slice(0, 12);
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "collecting",
			intakeId: "intake-one",
			candidates,
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("region", { name: "룰렛" })).toBeNull();
		const list = screen.getByRole("list", { name: "후보 편집 목록" });
		const actions = screen.getByRole("button", { name: "마감" })
			.parentElement as HTMLElement;
		const input = screen.getByRole("textbox", { name: "새 후보 이름" });
		expect(within(list).getAllByRole("listitem")).toHaveLength(
			candidates.length,
		);
		expect(
			input.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			list.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_PRECEDING,
		).toBeTruthy();
		expect(
			screen.getAllByRole("switch", { name: "후보 추천받기" }),
		).toHaveLength(1);
		expect(screen.getAllByRole("button", { name: "마감" })).toHaveLength(1);
		await act(async () =>
			fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" })),
		);
		expect(room.closeIntake).toHaveBeenCalledOnce();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		updateRoom(view, {
			snapshot: snapshot({
				status: "reviewing",
				intakeId: "intake-one",
				candidates,
			}),
		});
		expect(
			screen.getByRole("heading", { name: "접수 종료 · 목록 확인" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" })),
		);
		expect(room.openIntake).toHaveBeenCalledOnce();
		expect(screen.queryByRole("button", { name: "룰렛 돌리기" })).toBeNull();
	});

	it("keeps an unsent recommendation after rejection and while intake is closed", async () => {
		room.snapshot = snapshot({ status: "collecting", intakeId: "intake-one" });
		vi.mocked(room.addCandidate).mockResolvedValue(false);
		const view = render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", {
			name: "후보 추천",
		}) as HTMLInputElement;
		expect(
			(input.closest("form") as HTMLFormElement).compareDocumentPosition(
				document.querySelector(".room-intake-list") as HTMLElement,
			) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		const category = screen.getByRole("button", {
			name: "추천 후보 분류 변경",
		});
		fireEvent.change(input, { target: { value: "우동" } });
		fireEvent.click(category);
		const categoryDialog = screen.getByRole("dialog", {
			name: "추천 후보 분류",
		});
		fireEvent.change(within(categoryDialog).getByLabelText("추천 후보 분류"), {
			target: { value: "따뜻한 음식" },
		});
		fireEvent.click(
			within(categoryDialog).getByRole("button", { name: "적용" }),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "추천하기" })),
		);
		expect(input.value).toBe("우동");
		expect(category.textContent).toContain("따뜻한 음식");
		updateRoom(view, {
			snapshot: snapshot({ status: "reviewing", intakeId: "intake-one" }),
		});
		expect(input.value).toBe("우동");
		expect(input.disabled).toBe(true);
		expect(category.textContent).toContain("따뜻한 음식");
		expect(category.matches(":disabled")).toBe(true);
		updateRoom(view, {
			snapshot: snapshot({ status: "collecting", intakeId: "intake-two" }),
		});
		vi.mocked(room.addCandidate).mockResolvedValue(true);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "추천하기" })),
		);
		expect(input.value).toBe("");
		expect(category.textContent).toContain("미분류");
		expect(room.addCandidate).toHaveBeenNthCalledWith(1, "우동", "따뜻한 음식");
		expect(room.addCandidate).toHaveBeenNthCalledWith(2, "우동", "따뜻한 음식");
	});

	it("keeps names as compact rows and restores only the active name when Escape cancels editing", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		expect(candidateRows()).toHaveLength(2);
		expect(screen.queryByRole("textbox", { name: /번 후보 이름$/ })).toBeNull();
		expect(
			screen.queryByRole("combobox", { name: /번 후보 분류$/ }),
		).toBeNull();
		const input = candidateName(1);
		fireEvent.change(input, { target: { value: "취소할 이름" } });
		expect(
			screen.getAllByRole("textbox", { name: /번 후보 이름$/ }),
		).toHaveLength(1);
		fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.queryByRole("textbox", { name: /번 후보 이름$/ })).toBeNull();
		expect(
			screen.getByRole("button", {
				name: `${sampleLunchPlaces[0].name} 이름 수정`,
			}),
		).toBeTruthy();
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.openIntake).toHaveBeenCalledOnce();
	});

	it("separates per-row exclusion from deletion and restores the same owned candidate with Undo", async () => {
		const owned = {
			...sampleLunchPlaces[0],
			ownerId: "guest-client",
			ownerName: "참가자",
		};
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			candidates: [owned, sampleLunchPlaces[1]],
		});
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.keyDown(
			screen.getByRole("button", { name: `${owned.name} 후보 관리` }),
			{ key: "ArrowDown" },
		);
		expect(screen.getByRole("menu")).toBeTruthy();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByText(/등록자.*참가자/)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("menuitem", { name: "이번 추첨에서 제외" }),
		);
		expect(candidateRows()).toHaveLength(2);
		expect(within(candidateRows()[0]).getByText("제외")).toBeTruthy();
		removeCandidate(owned.name);
		expect(candidateRows()).toHaveLength(1);
		fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
		expect(candidateRows()).toHaveLength(2);
		expect(candidateRows()[0].getAttribute("data-candidate-id")).toBe(owned.id);
		expect(within(candidateRows()[0]).queryByText(/참가자 추천/)).toBeNull();
		fireEvent.keyDown(
			screen.getByRole("button", { name: `${owned.name} 후보 관리` }),
			{ key: "ArrowDown" },
		);
		const ownerMenu = screen.getByRole("menu");
		expect(within(ownerMenu).getByText(/등록자.*참가자/)).toBeTruthy();
		fireEvent.keyDown(ownerMenu, { key: "Escape" });
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.updateGameFilter).toHaveBeenCalledExactlyOnceWith({
			categories: null,
			excludedIds: [owned.id],
		});
		expect(room.snapshot?.candidates).toEqual([owned, sampleLunchPlaces[1]]);
	});

	it("saves a personal copy including an unfinished new name without consuming or sharing its draft", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.change(candidateName(1), { target: { value: "내 초안 이름" } });
		const input = screen.getByRole("textbox", {
			name: "새 후보 이름",
		}) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "아직 추가하지 않은 메뉴" } });
		listAction("내 목록에 저장");
		let dialog = screen.getByRole("dialog", { name: "내 목록에 저장" });
		expect(within(dialog).getByText(/후보 3개/)).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
		expect(input.value).toBe("아직 추가하지 않은 메뉴");
		expect(candidateRows()).toHaveLength(2);
		listAction("내 목록에 저장");
		dialog = screen.getByRole("dialog", { name: "내 목록에 저장" });
		fireEvent.change(
			within(dialog).getByRole("textbox", { name: "목록 이름" }),
			{ target: { value: "검증용 사본" } },
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "사본 저장" }));
		const stored = JSON.parse(
			localStorage.getItem(candidateLibraryKey) ?? "null",
		);
		expect(
			stored.lists[0].items.map((item: { name: string }) => item.name),
		).toEqual([
			"아직 추가하지 않은 메뉴",
			"내 초안 이름",
			sampleLunchPlaces[1].name,
		]);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.openIntake).not.toHaveBeenCalled();
		fireEvent.click(within(dialog).getAllByRole("button", { name: "닫기" })[0]);
		expect(input.value).toBe("아직 추가하지 않은 메뉴");
		expect(candidateRows()).toHaveLength(2);
	});

	it.each([
		"쌀\u200b국수",
		"만\u0000두",
		"김\ud800밥",
	])("keeps an invalid bulk paste editable without changing the candidate draft: %s", (invalid) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		listAction("여러 개 추가");
		const dialog = screen.getByRole("dialog", { name: "여러 개 추가" });
		const input = within(dialog).getByRole("textbox", {
			name: "후보 이름 목록",
		}) as HTMLTextAreaElement;
		const paste = `만두\n${invalid}`;
		fireEvent.change(input, { target: { value: paste } });
		fireEvent.click(within(dialog).getByRole("button", { name: "후보 추가" }));
		expect(input.value).toBe(paste);
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(document.activeElement).toBe(input);
		const errorId = input.getAttribute("aria-describedby");
		expect(errorId && document.getElementById(errorId)?.textContent).toContain(
			"2번째 줄",
		);
		expect(room.editRoom).not.toHaveBeenCalled();
		fireEvent.change(input, { target: { value: "만두\n쌀국수🍜" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "후보 추가" }));
		expect(screen.queryByRole("dialog", { name: "여러 개 추가" })).toBeNull();
		expect(candidateRows()).toHaveLength(4);
		expect(
			screen.getByRole("button", { name: "쌀국수🍜 이름 수정" }),
		).toBeTruthy();
	});

	it("appends multiple names without replacing existing IDs, ownership, categories or unfinished input", async () => {
		const owned = {
			...sampleLunchPlaces[0],
			ownerId: "guest-client",
			ownerName: "참가자",
			category: "우리 팀",
		};
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			candidates: [owned, sampleLunchPlaces[1]],
		});
		render(<LunchRoomPage roomId={roomId} />);
		const input = screen.getByRole("textbox", {
			name: "새 후보 이름",
		}) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "미추가 입력" } });
		fireEvent.keyDown(input, { key: "Enter", isComposing: true });
		expect(candidateRows()).toHaveLength(2);
		listAction("여러 개 추가");
		const dialog = screen.getByRole("dialog", { name: "여러 개 추가" });
		fireEvent.change(
			within(dialog).getByRole("textbox", { name: "후보 이름 목록" }),
			{ target: { value: "  만두  \n\n  쌀국수  " } },
		);
		fireEvent.click(within(dialog).getByRole("button", { name: "후보 추가" }));
		expect(candidateRows()).toHaveLength(4);
		expect(input.value).toBe("미추가 입력");
		expect(
			candidateRows()
				.slice(0, 2)
				.map((row) => row.getAttribute("data-candidate-id")),
		).toEqual([owned.id, sampleLunchPlaces[1].id]);
		await act(async () => saveDraftBeforeStage());
		const saved = vi.mocked(room.editRoom).mock.calls[0][0].candidates ?? [];
		expect(saved.map((candidate) => candidate.name)).toEqual([
			"미추가 입력",
			owned.name,
			sampleLunchPlaces[1].name,
			"만두",
			"쌀국수",
		]);
		expect(saved[1]).toEqual(owned);
		expect(new Set(saved.map((candidate) => candidate.id)).size).toBe(5);
		expect(
			saved
				.filter(
					(candidate) =>
						candidate.id !== owned.id &&
						candidate.id !== sampleLunchPlaces[1].id,
				)
				.every(
					(candidate) => candidate.category === "미분류" && !candidate.ownerId,
				),
		).toBe(true);
		expect(room.snapshot?.candidates).toEqual([owned, sampleLunchPlaces[1]]);
	});

	it("clears only the presentation search when the same-list filter disclosure closes", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(filterButton());
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		fireEvent.change(screen.getByRole("textbox", { name: "후보 검색" }), {
			target: { value: "없는 후보 이름" },
		});
		expect(
			within(
				screen.getByRole("list", { name: "후보 편집 목록" }),
			).queryAllByRole("listitem"),
		).toHaveLength(0);
		fireEvent.click(filterButton());
		expect(screen.queryByRole("textbox", { name: "후보 검색" })).toBeNull();
		expect(candidateRows()).toHaveLength(2);
		fireEvent.click(filterButton());
		expect(
			(screen.getByRole("textbox", { name: "후보 검색" }) as HTMLInputElement)
				.value,
		).toBe("");
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("keeps the active name input available when typing no longer matches the current search and restores it on Escape", () => {
		const original = { ...sampleLunchPlaces[0], name: "비빔밥" };
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			candidates: [original, sampleLunchPlaces[1]],
		});
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(filterButton());
		const search = screen.getByRole("textbox", {
			name: "후보 검색",
		}) as HTMLInputElement;
		fireEvent.change(search, { target: { value: "비빔밥" } });
		expect(candidateRows()).toHaveLength(1);
		const name = candidateName(1);
		fireEvent.change(name, { target: { value: "김" } });
		expect(name.isConnected).toBe(true);
		expect(screen.getByRole("textbox", { name: "1번 후보 이름" })).toBe(name);
		fireEvent.change(name, { target: { value: "김치찌개" } });
		expect(name.value).toBe("김치찌개");
		expect(candidateRows()).toHaveLength(1);
		fireEvent.keyDown(name, { key: "Escape" });
		expect(screen.queryByRole("textbox", { name: "1번 후보 이름" })).toBeNull();
		expect(
			screen.getByRole("button", { name: "비빔밥 이름 수정" }),
		).toBeTruthy();
		expect(search.value).toBe("비빔밥");
		expect(candidateRows()[0].getAttribute("data-candidate-id")).toBe(
			original.id,
		);
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it.each([
		"discard",
		"import",
	] as const)("clears a deleted draft candidate's Undo after %s replaces the editing context", (action) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		const existing = candidateName(1);
		fireEvent.change(existing, { target: { value: "버릴 이름 초안" } });
		fireEvent.keyDown(existing, { key: "Enter" });
		fireEvent.change(screen.getByRole("textbox", { name: "새 후보 이름" }), {
			target: { value: "버릴 추가 후보" },
		});
		fireEvent.click(screen.getByRole("button", { name: "후보 추가" }));
		removeCandidate("버릴 추가 후보");
		expect(screen.getByRole("button", { name: "되돌리기" })).toBeTruthy();
		if (action === "discard") {
			listAction("변경 취소");
			fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
			expect(candidateRows()).toHaveLength(2);
			expect(candidateRows()[0].getAttribute("data-candidate-id")).toBe(
				sampleLunchPlaces[0].id,
			);
		} else {
			listAction("목록 불러오기");
			const picker = screen.getByRole("dialog", { name: "목록 불러오기" });
			fireEvent.click(
				within(picker).getByRole("button", { name: /^기본 음식점 목록/ }),
			);
			fireEvent.click(screen.getByRole("button", { name: "목록 바꾸기" }));
			expect(candidateRows()).toHaveLength(sampleLunchPlaces.length);
		}
		expect(screen.queryByRole("button", { name: "되돌리기" })).toBeNull();
		expect(
			screen.queryByRole("button", { name: "버릴 추가 후보 이름 수정" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "버릴 이름 초안 이름 수정" }),
		).toBeNull();
		expect(
			screen.getByRole("button", {
				name: `${sampleLunchPlaces[0].name} 이름 수정`,
			}),
		).toBeTruthy();
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("does not offer a filter reset for an explicit whitelist covering every current category and only stale excluded IDs", async () => {
		const candidates = [
			{ ...sampleLunchPlaces[0], category: "한식" },
			{ ...sampleLunchPlaces[1], category: "일식" },
		];
		const whitelist = {
			categories: ["한식", "일식"],
			excludedIds: ["removed-candidate"],
		};
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			candidates,
			gameFilter: whitelist,
		});
		render(<LunchRoomPage roomId={roomId} />);
		expect(filterButton().getAttribute("aria-label")).toBe("필터");
		expect(within(filterButton()).getByText("2/2")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "필터 초기화" })).toBeNull();
		fireEvent.click(filterButton());
		expect(
			screen.getByRole("button", { name: "전체" }).getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.queryByRole("button", { name: "필터 초기화" })).toBeNull();
		fireEvent.change(candidateName(1), { target: { value: "이름만 수정" } });
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).toHaveBeenCalledExactlyOnceWith({
			baseVersion: 1,
			candidates: [{ ...candidates[0], name: "이름만 수정" }, candidates[1]],
		});
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.snapshot?.gameFilter).toEqual(whitelist);
	});

	it("places a new single candidate beside the add field at the top and reveals its excluded category without changing the filter", async () => {
		const candidates = [
			{ ...sampleLunchPlaces[0], name: "비빔밥", category: "한식" },
			{ ...sampleLunchPlaces[1], name: "돈가스", category: "일식" },
		];
		const filter = { categories: ["한식"], excludedIds: [] };
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			candidates,
			gameFilter: filter,
		});
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(filterButton());
		const search = screen.getByRole("textbox", {
			name: "후보 검색",
		}) as HTMLInputElement;
		fireEvent.change(search, { target: { value: "비빔밥" } });
		const input = screen.getByRole("textbox", {
			name: "새 후보 이름",
		}) as HTMLInputElement;
		const list = screen.getByRole("list", { name: "후보 편집 목록" });
		expect(input.parentElement?.nextElementSibling).toBe(list);
		fireEvent.change(input, { target: { value: "가장 최근 후보" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(input.value).toBe("");
		expect(search.value).toBe("");
		expect(candidateRows()).toHaveLength(2);
		const newest = candidateRows()[0];
		expect(
			within(newest).getByRole("button", { name: "가장 최근 후보 이름 수정" }),
		).toBeTruthy();
		expect(within(newest).getByText("추가됨")).toBeTruthy();
		expect(within(newest).getByText("분류 제외")).toBeTruthy();
		expect(newest.getAttribute("data-included")).toBe("false");
		expect(
			screen.queryByRole("button", { name: "돈가스 이름 수정" }),
		).toBeNull();
		expect(within(filterButton()).getByText("1/3")).toBeTruthy();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.snapshot?.gameFilter).toEqual(filter);
		await act(async () => saveDraftBeforeStage());
		const saved = vi.mocked(room.editRoom).mock.calls[0][0].candidates ?? [];
		expect(saved.map((candidate) => candidate.name)).toEqual([
			"가장 최근 후보",
			"비빔밥",
			"돈가스",
		]);
		expect(saved[0].category).toBe("미분류");
		expect(saved.slice(1)).toEqual(candidates);
		expect(room.updateGameFilter).not.toHaveBeenCalled();
	});

	it.each([
		"editing",
		"collecting",
	] as const)("keeps the recommendation switch tied to %s after its draft save fails", async (status) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status,
			intakeId: status === "collecting" ? "intake-one" : null,
		});
		let rejectSave!: (accepted: boolean) => void;
		vi.mocked(room.editRoom).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					rejectSave = resolve;
				}),
		);
		render(<LunchRoomPage roomId={roomId} />);
		const input = candidateName(1);
		fireEvent.change(input, {
			target: { value: "접수 변경 전에 보존할 초안" },
		});
		const intake = screen.getByRole("switch", { name: "후보 추천받기" });
		expect(intake.getAttribute("aria-checked")).toBe(
			String(status === "collecting"),
		);
		await act(async () => fireEvent.click(intake));
		expect(room.editRoom).toHaveBeenCalledOnce();
		expect(intake.matches(":disabled")).toBe(true);
		expect(intake.getAttribute("aria-checked")).toBe(
			String(status === "collecting"),
		);
		expect(room.openIntake).not.toHaveBeenCalled();
		expect(room.closeIntake).not.toHaveBeenCalled();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		await act(async () => rejectSave(false));
		expect(intake.matches(":disabled")).toBe(false);
		expect(intake.getAttribute("aria-checked")).toBe(
			String(status === "collecting"),
		);
		expect(
			screen.getByRole("button", {
				name: "접수 변경 전에 보존할 초안 이름 수정",
			}),
		).toBeTruthy();
		expect(room.snapshot?.status).toBe(status);
		expect(room.snapshot?.candidates).toEqual(sampleLunchPlaces.slice(0, 2));
		expect(room.openIntake).not.toHaveBeenCalled();
		expect(room.closeIntake).not.toHaveBeenCalled();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
	});

	it("preserves candidate IDs, ownership and game exclusions while editing the source list", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			gameFilter: { categories: null, excludedIds: [sampleLunchPlaces[1].id] },
			candidates: [
				{
					...sampleLunchPlaces[0],
					ownerId: "guest-client",
					ownerName: "참가자",
				},
				sampleLunchPlaces[1],
			],
		});
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.change(candidateName(1), {
			target: { value: "새 이름" },
		});
		expect(
			screen.getAllByRole("checkbox", { name: /추첨 포함$/ }),
		).toHaveLength(2);
		setCandidateCategory(1, "새로운 분류");
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).toHaveBeenCalledWith({
			baseVersion: 1,
			candidates: [
				{
					...sampleLunchPlaces[0],
					name: "새 이름",
					category: "새로운 분류",
					ownerId: "guest-client",
					ownerName: "참가자",
				},
				sampleLunchPlaces[1],
			],
		});
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.snapshot?.gameFilter?.excludedIds).toEqual([
			sampleLunchPlaces[1].id,
		]);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("preserves a name draft without restoring a legacy exclusion after the game filter is reset", async () => {
		room.self = { id: "host-client", isHost: true };
		const legacy = { ...sampleLunchPlaces[0], included: false };
		room.snapshot = snapshot({
			status: "editing",
			candidates: [legacy],
			revision: 1,
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		const name = candidateName(1) as HTMLInputElement;
		fireEvent.change(name, { target: { value: "보존할 이름 초안" } });
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				candidates: [{ ...legacy, included: true }],
				gameFilter: { categories: null, excludedIds: [] },
				listVersion: 1,
				revision: 2,
			}),
		});
		expect(name.value).toBe("보존할 이름 초안");
		expect(
			within(screen.getByRole("region", { name: "후보 편집" })).getByText(
				"추첨 1개",
			),
		).toBeTruthy();
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).toHaveBeenCalledExactlyOnceWith({
			baseVersion: 1,
			candidates: [{ ...legacy, name: "보존할 이름 초안", included: true }],
		});
		expect(room.snapshot?.gameFilter).toEqual({
			categories: null,
			excludedIds: [],
		});
	});

	it("keeps room-name saves separate from a conflicting candidate draft", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.change(candidateName(1), {
			target: { value: "초안 이름" },
		});
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		fireEvent.change(
			within(settings).getByRole("textbox", { name: "방 이름" }),
			{ target: { value: "제목 수정" } },
		);
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				listVersion: 2,
				candidates: [...sampleLunchPlaces.slice(0, 3)],
			}),
		});
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(room.editRoom).toHaveBeenCalledWith({
			baseVersion: 2,
			title: "제목 수정",
		});
		expect((candidateName(1) as HTMLInputElement).value).toBe("초안 이름");
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).toHaveBeenCalledTimes(1);
		expect(screen.getByText(/공유 후보가 바뀌었습니다/)).toBeTruthy();
	});

	it("asks before discarding inline changes and leaves sharing untouched", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.change(candidateName(1), {
			target: { value: "개인 초안" },
		});
		listAction("변경 취소");
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect((candidateName(1) as HTMLInputElement).value).toBe("개인 초안");
		listAction("변경 취소");
		fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("starts OFF without confirmation even with a legacy ledger and still rejects stale manual reset approval", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			revision: 2,
			excludeDrawn: false,
			excludedIds: [sampleLunchPlaces[0].id],
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "룰렛 돌리기" }));
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(room.startDraw).toHaveBeenCalledExactlyOnceWith({
			expectedRevision: 2,
		});
		updateRoom(view, {
			snapshot: snapshot({
				revision: 2,
				excludeDrawn: true,
				excludedIds: [sampleLunchPlaces[0].id],
			}),
		});
		fireEvent.click(screen.getByRole("button", { name: "제외 목록 초기화" }));
		updateRoom(view, {
			snapshot: snapshot({
				revision: 3,
				excludeDrawn: true,
				excludedIds: [sampleLunchPlaces[0].id],
			}),
		});
		fireEvent.click(screen.getByRole("button", { name: "초기화" }));
		expect(room.resetExclusions).not.toHaveBeenCalled();
		expect(screen.getByText(/게임 조건이 바뀌었어요/)).toBeTruthy();
	});

	it("keeps zero-eligible waiting recoverable through the compact exclusion controls", async () => {
		room.self = { id: "host-client", isHost: true };
		const excludedIds = sampleLunchPlaces
			.slice(0, 2)
			.map((candidate) => candidate.id);
		const before = snapshot({
			status: "waiting",
			revision: 4,
			excludeDrawn: true,
			excludedIds,
		});
		room.snapshot = before;
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(document.querySelector(".room-current-candidates")).toBeNull();
		expect(screen.queryByRole("switch", { name: "후보 추천받기" })).toBeNull();
		expect(
			screen.getByRole("button", { name: "후보 편집" }).matches(":disabled"),
		).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		const popup = screen.getByRole("dialog", { name: "후보 보기" });
		expect(within(popup).getAllByRole("listitem")).toHaveLength(2);
		expect(within(popup).getAllByText("추첨 확률 0%")).toHaveLength(2);
		fireEvent.click(within(popup).getAllByRole("button", { name: "닫기" })[0]);
		const exclusionPanel = screen.getByRole("complementary", {
			name: /후보 제외 목록|다음 게임 준비/,
		});
		expect(
			within(exclusionPanel).getByRole("heading", { name: "당첨 제외 내역" }),
		).toBeTruthy();
		const toggle = within(exclusionPanel).getByRole("switch", {
			name: "중복 없이 추첨 · 뽑힌 후보 제외",
		});
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		await act(async () => fireEvent.click(toggle));
		expect(room.updateRoomOptions).toHaveBeenCalledExactlyOnceWith(false, 4);
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		updateRoom(view, {
			snapshot: { ...before, excludeDrawn: false, revision: 5 },
		});
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		expect(
			within(exclusionPanel).queryByRole("heading", {
				name: "저장된 당첨 내역",
			}),
		).toBeNull();
		expect(
			document
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("2");
		expect(room.snapshot?.excludedIds).toEqual(excludedIds);
		expect(room.snapshot?.candidates).toEqual(before.candidates);
		expect(room.resetExclusions).not.toHaveBeenCalled();
		expect(room.startDraw).not.toHaveBeenCalled();
	});

	it("keeps candidate filtering in the candidate popup and lists only drawn winners with their round and time", () => {
		const candidates = sampleLunchPlaces.slice(0, 3);
		const firstDrawnAt = baseTime - 60000;
		const latestDrawnAt = baseTime - 30000;
		room.snapshot = snapshot({
			candidates,
			excludeDrawn: true,
			excludedIds: [candidates[1].id, candidates[2].id],
			gameFilter: { categories: null, excludedIds: [candidates[0].id] },
			exclusionRecords: [
				{
					candidateId: candidates[1].id,
					drawId: "round-two",
					roundNumber: 2,
					drawnAt: firstDrawnAt,
				},
				{
					candidateId: candidates[2].id,
					drawId: "round-three",
					roundNumber: 3,
					drawnAt: latestDrawnAt,
				},
			],
		});
		render(<LunchRoomPage roomId={roomId} />);
		const panel = screen.getByRole("complementary", {
			name: /후보 제외 목록|다음 게임 준비/,
		});
		expect(within(panel).queryByText(/직접 제외/)).toBeNull();
		expect(within(panel).queryByText(candidates[0].name)).toBeNull();
		const rows = within(
			within(panel).getByRole("list", { name: "당첨 제외 내역" }),
		).getAllByRole("listitem");
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain(candidates[2].name);
		expect(within(rows[0]).getByText("3회차 당첨")).toBeTruthy();
		expect(rows[0].querySelector("time")?.dateTime).toBe(
			new Date(latestDrawnAt).toISOString(),
		);
		expect(within(rows[1]).getByText("2회차 당첨")).toBeTruthy();
		expect(rows[1].querySelector("time")?.dateTime).toBe(
			new Date(firstDrawnAt).toISOString(),
		);
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		const popup = screen.getByRole("dialog", { name: "후보 보기" });
		const candidateRows = within(popup).getAllByRole("listitem");
		expect(
			within(candidateRows[0]).getByText("후보 필터에서 제외"),
		).toBeTruthy();
		expect(within(popup).getAllByText("당첨 제외")).toHaveLength(2);
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.resetExclusions).not.toHaveBeenCalled();
	});

	it.each([
		"editing",
		"collecting",
		"reviewing",
	] as const)("finalizes %s with drawn exclusions intact and recovers only in waiting", async (status) => {
		room.self = { id: "host-client", isHost: true };
		const excludedIds = sampleLunchPlaces
			.slice(0, 2)
			.map((candidate) => candidate.id);
		const before = snapshot({
			status,
			intakeId: status === "editing" ? null : "intake-one",
			revision: 2,
			excludeDrawn: true,
			excludedIds,
		});
		room.snapshot = before;
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("region", { name: /게임 옵션$/ })).toBeNull();
		expect(
			screen.queryByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" }),
		).toBeNull();
		expect(
			screen.queryByRole("checkbox", {
				name: "중복 없이 추첨 · 뽑힌 후보 제외",
			}),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "마감" }).matches(":disabled"),
		).toBe(false);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
		expect(room.resetExclusions).not.toHaveBeenCalled();
		updateRoom(view, {
			snapshot: { ...before, status: "waiting", intakeId: null, revision: 3 },
		});
		expect(
			screen.getByRole("heading", { name: "다음 추첨 대기" }),
		).toBeTruthy();
		expect(
			document
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("0");
		const options = screen.getByRole("complementary", {
			name: /후보 제외 목록|다음 게임 준비/,
		});
		const toggle = within(options).getByRole("switch", {
			name: "중복 없이 추첨 · 뽑힌 후보 제외",
		});
		await act(async () => fireEvent.click(toggle));
		expect(room.updateRoomOptions).toHaveBeenCalledExactlyOnceWith(false, 3);
		updateRoom(view, {
			snapshot: {
				...before,
				status: "waiting",
				intakeId: null,
				revision: 4,
				excludeDrawn: false,
			},
		});
		expect(
			document
				.querySelector(".lunch-wheel")
				?.getAttribute("data-candidate-count"),
		).toBe("2");
		expect(room.snapshot?.excludedIds).toEqual(excludedIds);
		expect(room.snapshot?.candidates).toEqual(before.candidates);
		expect(room.startDraw).not.toHaveBeenCalled();
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("confirms deleting only the participant’s own recommendation while intake is open", async () => {
		const candidates = [
			{ ...sampleLunchPlaces[0], ownerId: "guest-client", ownerName: "참가자" },
			{
				...sampleLunchPlaces[1],
				ownerId: "other-client",
				ownerName: "다른 참가자",
			},
		];
		room.snapshot = snapshot({
			status: "collecting",
			intakeId: "intake-one",
			candidates,
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(
			screen.getByRole("button", {
				name: `${candidates[0].name} 내 추천 삭제`,
			}),
		);
		expect(
			screen.getByRole("alertdialog", { name: "내 추천을 삭제할까요?" }),
		).toBeTruthy();
		expect(room.removeCandidate).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "취소" }));
		expect(room.removeCandidate).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", {
				name: `${candidates[0].name} 내 추천 삭제`,
			}),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "추천 삭제" })),
		);
		expect(room.removeCandidate).toHaveBeenCalledExactlyOnceWith(
			candidates[0].id,
		);
		expect(
			screen.queryByRole("button", {
				name: `${candidates[1].name} 내 추천 삭제`,
			}),
		).toBeNull();
		updateRoom(view, {
			snapshot: snapshot({
				status: "reviewing",
				intakeId: "intake-one",
				candidates,
			}),
		});
		expect(screen.queryByRole("button", { name: /내 추천 삭제$/ })).toBeNull();
	});

	it("allows one remaining candidate and blocks every edit while a mutation is pending", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ candidates: sampleLunchPlaces.slice(0, 1) });
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen
				.getByRole("button", { name: "마지막 후보 확정" })
				.matches(":disabled"),
		).toBe(false);
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				candidates: sampleLunchPlaces.slice(0, 1),
			}),
		});
		updateRoom(view, { mutationPending: "options" });
		expect(
			screen
				.getByRole("button", { name: `${sampleLunchPlaces[0].name} 이름 수정` })
				.matches(":disabled"),
		).toBe(true);

		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
	});

	it("enters shared editing only after approval and finalizes the new-room editing screen before drawing", async () => {
		room.self = { id: "host-client", isHost: true };
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(document.querySelector(".room-game-filter")).toBeNull();
		expect(screen.queryByRole("button", { name: "게임 필터" })).toBeNull();
		expect(screen.queryByRole("checkbox", { name: /추첨 포함$/ })).toBeNull();
		expect(screen.queryByRole("textbox", { name: /번 후보 이름$/ })).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" })
				.matches(":disabled"),
		).toBe(false);
		expect(screen.queryByRole("switch", { name: "후보 추천받기" })).toBeNull();
		const edit = screen.getByRole("button", { name: "후보 편집" });
		expect(edit.closest(".room-lifecycle-tools")).not.toBeNull();
		expect(
			within(edit.parentElement as HTMLElement).getByRole("button", {
				name: "후보 보기",
			}),
		).toBeTruthy();
		expect(document.querySelector(".room-waiting-actions")).toBeNull();
		fireEvent.click(edit);
		expect(room.enterEditing).toHaveBeenCalledOnce();
		expect(screen.queryByRole("button", { name: "게임 필터" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByRole("button", { name: "룰렛 돌리기" })).toBeTruthy();
		updateRoom(view, {
			snapshot: snapshot({ status: "editing", revision: 2 }),
		});
		expect(screen.queryByRole("region", { name: "룰렛" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: "후보 추천" })).toBeNull();
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "마감" })
				.closest(".room-simple-heading"),
		).not.toBeNull();
		expect(screen.getByRole("switch", { name: "후보 추천받기" })).toBeTruthy();
		expect(filterButton().getAttribute("aria-expanded")).toBe("false");
		expect(screen.queryByRole("button", { name: "목록 편집" })).toBeNull();
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: /번 후보 이름$/ })).toBeNull();
		fireEvent.change(candidateName(1), {
			target: { value: "준비한 방" },
		});
		await act(async () => saveDraftBeforeStage());
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(room.startDraw).not.toHaveBeenCalled();
		updateRoom(view, {
			snapshot: snapshot({ status: "waiting", revision: 3 }),
		});
		expect(screen.getByRole("button", { name: "룰렛 돌리기" })).toBeTruthy();
	});

	it("keeps guests informed and read-only in the initial editing stage", () => {
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByText(/방장이 후보 목록을 편집하고 있습니다/),
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "편집하기" })).toBeNull();
		expect(screen.queryByRole("button", { name: "마감" })).toBeNull();
		expect(screen.queryByRole("textbox", { name: "후보 추천" })).toBeNull();
		expect(screen.queryByRole("region", { name: "룰렛" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		expect(screen.getByRole("dialog", { name: "후보 보기" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
	});

	it("retains a private draft but locks applying after a remote stage change", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "collecting", intakeId: "intake-one" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const title = candidateName(1) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "내 초안" } });
		expect(screen.getByRole("button", { name: "마감" })).toBeTruthy();
		updateRoom(view, {
			snapshot: snapshot({
				status: "reviewing",
				revision: 2,
				intakeId: "intake-one",
			}),
		});
		expect(
			screen
				.getByRole("button", { name: "내 초안 이름 수정" })
				.matches(":disabled"),
		).toBe(true);
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
		expect(
			screen.getByText(/게임 단계가 바뀌어 적용을 잠갔습니다/),
		).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "최신 목록으로 다시 편집" }),
		);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect(
			screen
				.getByRole("button", { name: "내 초안 이름 수정" })
				.matches(":disabled"),
		).toBe(true);
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("keeps the candidate viewer read-only on the result screen", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "result", draw: draw(baseTime - 8000) });
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("button", { name: "편집하기" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		expect(
			within(screen.getByRole("dialog")).queryByRole("button", {
				name: "후보 편집",
			}),
		).toBeNull();
		expect(screen.queryByRole("textbox", { name: "방 이름" })).toBeNull();
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
		expect(room.enterEditing).not.toHaveBeenCalled();
	});

	it("edits one inline candidate list without opening or duplicating an editor dialog", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		expect(screen.queryByRole("button", { name: "편집하기" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(candidateRows()).toHaveLength(2);
		fireEvent.change(screen.getByRole("textbox", { name: "새 후보 이름" }), {
			target: { value: "우동" },
		});
		fireEvent.click(screen.getByRole("button", { name: "후보 추가" }));
		expect((candidateName(1) as HTMLInputElement).value).toBe("우동");
		removeCandidate(sampleLunchPlaces[1].name);
		await act(async () => saveDraftBeforeStage());
		const edit = vi.mocked(room.editRoom).mock.calls[0][0];
		expect(edit.candidates?.map((item) => item.name)).toEqual([
			"우동",
			sampleLunchPlaces[0].name,
		]);
		expect(edit.candidates?.[1].id).toBe(sampleLunchPlaces[0].id);
		expect(edit.candidates?.[0].id).not.toBe(sampleLunchPlaces[0].id);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("refreshes untouched candidates while a separate room-name draft is open", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "collecting", intakeId: "intake-one" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		const title = within(settings).getByRole("textbox", {
			name: "방 이름",
		}) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "내 방 이름" } });
		updateRoom(view, {
			snapshot: snapshot({
				status: "collecting",
				intakeId: "intake-one",
				listVersion: 2,
				candidates: [...sampleLunchPlaces.slice(0, 3)],
			}),
		});
		expect(title.value).toBe("내 방 이름");
		fireEvent.click(
			within(settings).getAllByRole("button", { name: "닫기" })[0],
		);
		fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
		expect(candidateRows()).toHaveLength(3);
		expect((candidateName(3) as HTMLInputElement).value).toBe(
			sampleLunchPlaces[2].name,
		);
		expect(screen.queryByText(/공유 후보가 바뀌었습니다/)).toBeNull();
	});

	it("saves inline changes before finalization and keeps the stage and draft if saving fails", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		vi.mocked(room.editRoom).mockResolvedValue(false);
		render(<LunchRoomPage roomId={roomId} />);
		const title = candidateName(1) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "마감 전 편집" } });
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.editRoom).toHaveBeenCalledWith({
			baseVersion: 1,
			candidates: [
				{ ...sampleLunchPlaces[0], name: "마감 전 편집" },
				sampleLunchPlaces[1],
			],
		});
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		expect(title.value).toBe("마감 전 편집");
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		vi.mocked(room.editRoom).mockResolvedValue(true);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(vi.mocked(room.editRoom).mock.invocationCallOrder[1]).toBeLessThan(
			vi.mocked(room.finalizeIntake).mock.invocationCallOrder[0],
		);
	});

	it("starts an empty room with a creation choice and finalizes a custom-category candidate only after saving", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing", candidates: [] });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const choice = screen.getByRole("region", { name: "후보 만들기" });
		expect(screen.getByRole("heading", { name: "후보 만들기" })).toBeTruthy();
		expect(
			within(choice).getByRole("button", { name: /^목록 불러오기/ }),
		).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "새 후보 이름" })).toBeNull();
		expect(screen.queryByRole("button", { name: "마감" })).toBeNull();
		expect(screen.queryByRole("region", { name: "룰렛" })).toBeNull();
		fireEvent.click(within(choice).getByRole("button", { name: /^새로 작성/ }));
		expect(screen.queryByRole("region", { name: "후보 만들기" })).toBeNull();
		expect(
			screen.getByRole("button", { name: "마감" }).matches(":disabled"),
		).toBe(true);
		fireEvent.change(screen.getByRole("textbox", { name: "새 후보 이름" }), {
			target: { value: "마지막 후보" },
		});
		fireEvent.keyDown(screen.getByRole("textbox", { name: "새 후보 이름" }), {
			key: "Enter",
		});
		setCandidateCategory(1, "우리 팀 취향");
		let acknowledge!: (accepted: boolean) => void;
		vi.mocked(room.editRoom).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					acknowledge = resolve;
				}),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		const saved = vi.mocked(room.editRoom).mock.calls[0][0];
		expect(saved.baseVersion).toBe(1);
		expect(saved.candidates).toEqual([
			expect.objectContaining({
				name: "마지막 후보",
				category: "우리 팀 취향",
				included: true,
			}),
		]);
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				candidates: saved.candidates,
				listVersion: 2,
				revision: 2,
			}),
		});
		await act(async () => acknowledge(true));
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(vi.mocked(room.editRoom).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(room.finalizeIntake).mock.invocationCallOrder[0],
		);
		expect(room.startDraw).not.toHaveBeenCalled();
		updateRoom(view, {
			snapshot: snapshot({
				status: "waiting",
				candidates: saved.candidates,
				listVersion: 2,
				revision: 3,
			}),
		});
		expect(
			screen.getByRole("button", { name: "마지막 후보 확정" }),
		).toBeTruthy();
		expect(screen.queryByRole("region", { name: "후보 편집" })).toBeNull();
	});

	it("cancels loading a list without replacing row edits or an unfinished candidate", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		const existing = candidateName(1) as HTMLInputElement;
		const name = screen.getByRole("textbox", {
			name: "새 후보 이름",
		}) as HTMLInputElement;
		fireEvent.change(existing, { target: { value: "수정 중인 후보" } });
		setCandidateCategory(1, "새로운 분류");
		fireEvent.change(name, { target: { value: "추가 중인 후보" } });
		const trigger = screen.getByRole("button", { name: "목록 작업" });
		listAction("목록 불러오기");
		const picker = screen.getByRole("dialog", { name: "목록 불러오기" });
		expect(
			within(picker).getByText(
				`회사 주변 음식점 · 후보 ${sampleLunchPlaces.length}개`,
				{ exact: false },
			),
		).toBeTruthy();
		expect(within(picker).getByText(/저장한 목록이 없어요/)).toBeTruthy();
		fireEvent.click(within(picker).getByRole("button", { name: "취소" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(existing.value).toBe("수정 중인 후보");
		expect(name.value).toBe("추가 중인 후보");
		expect(
			within(candidateRows()[0]).getByRole("button", {
				name: "수정 중인 후보 분류 새로운 분류 변경",
			}),
		).toBeTruthy();
		act(() => vi.advanceTimersByTime(0));
		expect(document.activeElement).toBe(trigger);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
	});

	it("returns to list selection when replacement is canceled and replaces only after approval", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		const first = candidateName(1) as HTMLInputElement;
		const unfinished = screen.getByRole("textbox", {
			name: "새 후보 이름",
		}) as HTMLInputElement;
		fireEvent.change(first, { target: { value: "보존할 초안" } });
		fireEvent.change(unfinished, { target: { value: "작성 중 후보" } });
		listAction("목록 불러오기");
		let picker = screen.getByRole("dialog", { name: "목록 불러오기" });
		fireEvent.click(
			within(picker).getByRole("button", { name: /^기본 음식점 목록/ }),
		);
		const confirmation = screen.getByRole("alertdialog", {
			name: "현재 후보 목록을 바꿀까요?",
		});
		expect(first.value).toBe("보존할 초안");
		expect(unfinished.value).toBe("작성 중 후보");
		expect(room.editRoom).not.toHaveBeenCalled();
		fireEvent.click(
			within(confirmation).getByRole("button", {
				name: "목록 선택으로 돌아가기",
			}),
		);
		picker = screen.getByRole("dialog", { name: "목록 불러오기" });
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(readCandidateListUsage().recentId).toBeNull();
		expect(first.value).toBe("보존할 초안");
		fireEvent.click(
			within(picker).getByRole("button", { name: /^기본 음식점 목록/ }),
		);
		fireEvent.click(screen.getByRole("button", { name: "목록 바꾸기" }));
		expect(readCandidateListUsage()).toEqual({
			recentId: defaultCandidateListSourceId,
			loadedAt: { [defaultCandidateListSourceId]: baseTime },
		});
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect((candidateName(1) as HTMLInputElement).value).toBe(
			sampleLunchPlaces[0].name,
		);
		expect(
			(
				screen.getByRole("textbox", {
					name: "새 후보 이름",
				}) as HTMLInputElement
			).value,
		).toBe("");
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("loads the complete default list as an editable room copy with fresh candidate IDs", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing", candidates: [] });
		const original = structuredClone(sampleLunchPlaces);
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: /^목록 불러오기/ }));
		const picker = screen.getByRole("dialog", { name: "목록 불러오기" });
		fireEvent.click(
			within(picker).getByRole("button", { name: /^기본 음식점 목록/ }),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(candidateRows()).toHaveLength(sampleLunchPlaces.length);
		fireEvent.change(candidateName(1), {
			target: { value: "방에서만 바꾼 이름" },
		});
		await act(async () => saveDraftBeforeStage());
		const copy = vi.mocked(room.editRoom).mock.calls[0][0].candidates ?? [];
		expect(copy).toHaveLength(sampleLunchPlaces.length);
		expect(new Set(copy.map((candidate) => candidate.id)).size).toBe(
			copy.length,
		);
		const originalIds = new Set(
			sampleLunchPlaces.map((candidate) => candidate.id),
		);
		expect(
			copy.every(
				(candidate) =>
					!originalIds.has(candidate.id) && candidate.included === true,
			),
		).toBe(true);
		expect(copy[0].name).toBe("방에서만 바꾼 이름");
		expect(sampleLunchPlaces).toEqual(original);
		expect(room.snapshot?.candidates).toEqual([]);
		expect(room.finalizeIntake).not.toHaveBeenCalled();
	});

	it("loads a saved service list as a fresh copy without modifying the saved original", async () => {
		const stored = {
			version: 1,
			lists: [
				{
					id: "personal-list",
					name: "우리 팀 단골",
					updatedAt: baseTime,
					items: [
						{
							id: "personal-item",
							name: "우리 팀 메뉴",
							category: "팀 전용 분류",
							included: false,
						},
					],
				},
			],
		};
		localStorage.setItem(candidateLibraryKey, JSON.stringify(stored));
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing", candidates: [] });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: /^목록 불러오기/ }));
		const picker = screen.getByRole("dialog", { name: "목록 불러오기" });
		fireEvent.click(
			within(picker).getByRole("button", { name: /^우리 팀 단골.*후보 1개/ }),
		);
		expect(
			within(candidateRows()[0]).getByRole("button", {
				name: "우리 팀 메뉴 분류 팀 전용 분류 변경",
			}),
		).toBeTruthy();
		await act(async () => saveDraftBeforeStage());
		const saved = vi.mocked(room.editRoom).mock.calls[0][0].candidates;
		expect(saved).toEqual([
			expect.objectContaining({
				name: "우리 팀 메뉴",
				category: "팀 전용 분류",
				included: true,
			}),
		]);
		expect(saved?.[0].id).not.toBe("personal-item");
		expect(
			JSON.parse(localStorage.getItem(candidateLibraryKey) ?? "null"),
		).toEqual(stored);
	});

	it.each([
		"editing",
		"collecting",
		"reviewing",
	] as const)("applies a local game filter in %s without changing source candidates or room settings", async (status) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status,
			candidates: sampleLunchPlaces.slice(0, 3),
			revision: 4,
			excludedIds: [sampleLunchPlaces[0].id],
			excludeDrawn: false,
		});
		const before = structuredClone(room.snapshot);
		const view = render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getAllByRole("checkbox", { name: /추첨 포함$/ }).length,
		).toBeGreaterThan(0);
		fireEvent.click(filterButton());
		expect(filterButton().getAttribute("aria-expanded")).toBe("true");
		expect(screen.queryByRole("textbox", { name: /번 후보 이름$/ })).toBeNull();
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: `${sampleLunchPlaces[0].category} 분류 포함`,
			}),
		);
		expect(
			screen.queryByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		).toBeNull();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		fireEvent.click(filterButton());
		expect(candidateRows()).toHaveLength(1);
		expect(screen.getByText("전체 후보 3개")).toBeTruthy();
		expect(
			screen.getAllByRole("checkbox", { name: /추첨 포함$/ }).length,
		).toBeGreaterThan(0);
		fireEvent.click(filterButton());
		expect(
			screen
				.getByRole("button", {
					name: `${sampleLunchPlaces[0].category} 분류 포함`,
				})
				.getAttribute("aria-pressed"),
		).toBe("false");
		await act(async () => saveDraftBeforeStage());
		const filter = {
			categories: [sampleLunchPlaces[2].category],
			excludedIds: [sampleLunchPlaces[0].id],
		};
		expect(room.updateGameFilter).toHaveBeenCalledExactlyOnceWith(filter);
		updateRoom(view, {
			snapshot: { ...before, gameFilter: filter, revision: 5 },
		});
		expect(room.snapshot?.candidates).toEqual(before.candidates);
		expect(room.snapshot?.listVersion).toBe(before.listVersion);
		expect(room.snapshot?.title).toBe(before.title);
		expect(room.snapshot?.excludedIds).toEqual(before.excludedIds);
		expect(room.snapshot?.draw).toBe(before.draw);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
		expect(room.updateGameFilter).toHaveBeenCalledTimes(1);
		await act(async () => saveDraftBeforeStage());
		expect(room.updateGameFilter).toHaveBeenLastCalledWith({
			categories: null,
			excludedIds: [],
		});
	});

	it("waits for candidate and filter acknowledgments in order before finalizing the editing stage", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing", revision: 4 });
		const view = render(<LunchRoomPage roomId={roomId} />);
		let acknowledgeCandidates!: (accepted: boolean) => void;
		let acknowledgeFilter!: (accepted: boolean) => void;
		vi.mocked(room.editRoom).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					acknowledgeCandidates = resolve;
				}),
		);
		vi.mocked(room.updateGameFilter).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					acknowledgeFilter = resolve;
				}),
		);
		fireEvent.change(candidateName(1), {
			target: { value: "보존할 후보 초안" },
		});
		fireEvent.click(filterButton());
		fireEvent.click(
			screen.getByRole("checkbox", { name: "보존할 후보 초안 추첨 포함" }),
		);
		fireEvent.click(filterButton());
		expect((candidateName(1) as HTMLInputElement).value).toBe(
			"보존할 후보 초안",
		);
		fireEvent.click(filterButton());
		expect(
			(
				screen.getByRole("checkbox", {
					name: "보존할 후보 초안 추첨 포함",
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.editRoom).toHaveBeenCalledOnce();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		const candidates = vi.mocked(room.editRoom).mock.calls[0][0].candidates;
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				candidates,
				listVersion: 2,
				revision: 5,
			}),
		});
		await act(async () => acknowledgeCandidates(true));
		const filter = { categories: null, excludedIds: [sampleLunchPlaces[0].id] };
		expect(room.updateGameFilter).toHaveBeenCalledExactlyOnceWith(filter);
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				candidates,
				listVersion: 2,
				revision: 6,
				gameFilter: filter,
			}),
		});
		await act(async () => acknowledgeFilter(true));
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(vi.mocked(room.editRoom).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(room.updateGameFilter).mock.invocationCallOrder[0],
		);
		expect(
			vi.mocked(room.updateGameFilter).mock.invocationCallOrder[0],
		).toBeLessThan(vi.mocked(room.finalizeIntake).mock.invocationCallOrder[0]);
		expect(room.startDraw).not.toHaveBeenCalled();
	});

	it("preserves a rejected filter draft and stays in editing until the filter is saved", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		vi.mocked(room.updateGameFilter).mockResolvedValue(false);
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(filterButton());
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.updateGameFilter).toHaveBeenCalledOnce();
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		vi.mocked(room.updateGameFilter).mockResolvedValue(true);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.updateGameFilter).toHaveBeenCalledTimes(2);
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
	});

	it("finalizes without resending a filter that reached the snapshot before its acknowledgment timed out", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing", revision: 4 });
		const view = render(<LunchRoomPage roomId={roomId} />);
		let timeOut!: (accepted: boolean) => void;
		vi.mocked(room.updateGameFilter).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					timeOut = resolve;
				}),
		);
		fireEvent.click(filterButton());
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		const filter = { categories: null, excludedIds: [sampleLunchPlaces[0].id] };
		expect(room.updateGameFilter).toHaveBeenCalledExactlyOnceWith(filter);
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				revision: 5,
				gameFilter: filter,
				candidates: sampleLunchPlaces
					.slice(0, 2)
					.map((candidate) => ({ ...candidate, included: true })),
			}),
		});
		await act(async () => timeOut(false));
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.updateGameFilter).toHaveBeenCalledTimes(1);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
	});

	it("preserves a local filter and blocks finalization when a different shared filter arrives", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing", revision: 4 });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(filterButton());
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		);
		const remoteFilter = {
			categories: null,
			excludedIds: [sampleLunchPlaces[1].id],
		};
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				revision: 5,
				gameFilter: remoteFilter,
			}),
		});
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(
			within(screen.getByRole("region", { name: "후보 편집" })).getByRole(
				"alert",
			).textContent,
		).toContain("공유 필터가 바뀌었습니다");
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[1].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "최신 조건 불러오기" }));
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "최신 조건 불러오기" }));
		fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[0].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(true);
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${sampleLunchPlaces[1].name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
		expect(room.snapshot?.gameFilter).toEqual(remoteFilter);
		expect(room.updateGameFilter).not.toHaveBeenCalled();
	});

	it("retries a filter reset after saving a legacy candidate edit without resaving the source or reporting a conflict", async () => {
		room.self = { id: "host-client", isHost: true };
		const legacy = { ...sampleLunchPlaces[0], included: false };
		room.snapshot = snapshot({
			status: "editing",
			revision: 4,
			candidates: [legacy, sampleLunchPlaces[1]],
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		let acknowledgeCandidates!: (accepted: boolean) => void;
		const filterAcknowledgments: ((accepted: boolean) => void)[] = [];
		vi.mocked(room.editRoom).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					acknowledgeCandidates = resolve;
				}),
		);
		vi.mocked(room.updateGameFilter).mockImplementation(
			() =>
				new Promise((resolve) => {
					filterAcknowledgments.push(resolve);
				}),
		);
		fireEvent.change(candidateName(1), {
			target: { value: "수정한 기존 후보" },
		});
		fireEvent.click(filterButton());
		fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		const savedCandidates = vi.mocked(room.editRoom).mock.calls[0][0]
			.candidates;
		expect(savedCandidates?.[0]).toEqual({
			...legacy,
			name: "수정한 기존 후보",
		});
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				revision: 5,
				listVersion: 2,
				candidates: savedCandidates,
			}),
		});
		await act(async () => acknowledgeCandidates(true));
		expect(room.updateGameFilter).toHaveBeenCalledExactlyOnceWith({
			categories: null,
			excludedIds: [],
		});
		await act(async () => filterAcknowledgments[0](false));
		expect(room.finalizeIntake).not.toHaveBeenCalled();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.editRoom).toHaveBeenCalledOnce();
		expect(room.updateGameFilter).toHaveBeenCalledTimes(2);
		expect(room.updateGameFilter).toHaveBeenLastCalledWith({
			categories: null,
			excludedIds: [],
		});
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				revision: 6,
				listVersion: 2,
				candidates: savedCandidates?.map((candidate) => ({
					...candidate,
					included: true,
				})),
				gameFilter: { categories: null, excludedIds: [] },
			}),
		});
		await act(async () => filterAcknowledgments[1](true));
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(room.snapshot?.candidates[0]).toEqual({
			...legacy,
			name: "수정한 기존 후보",
			included: true,
		});
	});

	it("clears deleted candidate IDs from the filter draft after a source-only save", async () => {
		room.self = { id: "host-client", isHost: true };
		const candidates = sampleLunchPlaces
			.slice(0, 2)
			.map((candidate) => ({ ...candidate, included: true }));
		room.snapshot = snapshot({
			status: "editing",
			revision: 4,
			candidates,
			gameFilter: { categories: null, excludedIds: [candidates[0].id] },
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		let acknowledgeCandidates!: (accepted: boolean) => void;
		vi.mocked(room.editRoom).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					acknowledgeCandidates = resolve;
				}),
		);
		removeCandidate(candidates[0].name);
		await act(async () => saveDraftBeforeStage());
		expect(room.editRoom).toHaveBeenCalledExactlyOnceWith({
			baseVersion: 1,
			candidates: [candidates[1]],
		});
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				revision: 5,
				listVersion: 2,
				candidates: [candidates[1]],
				gameFilter: { categories: null, excludedIds: [] },
			}),
		});
		await act(async () => acknowledgeCandidates(true));
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
		expect(screen.queryByText(/미적용 변경 있음/)).toBeNull();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(room.finalizeIntake).toHaveBeenCalledOnce();
		expect(room.editRoom).toHaveBeenCalledOnce();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
	});

	it("groups intake with finalize and allows direct exclusion, removal and undo", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status: "editing",
			candidates: sampleLunchPlaces.slice(0, 3),
		});
		const original = structuredClone(room.snapshot);
		render(<LunchRoomPage roomId={roomId} />);
		const header = document.querySelector(
			".room-simple-header-actions",
		) as HTMLElement;
		expect(
			within(header).getByRole("switch", { name: "후보 추천받기" }),
		).toBeTruthy();
		expect(within(header).getByRole("button", { name: "마감" })).toBeTruthy();
		const name = sampleLunchPlaces[0].name;
		const included = screen.getByRole("checkbox", {
			name: `${name} 추첨 포함`,
		}) as HTMLInputElement;
		fireEvent.click(included);
		expect(included.checked).toBe(false);
		expect(
			screen.getByRole("button", { name: `${name} 이름 수정` }).textContent,
		).toContain("제외");
		fireEvent.click(screen.getByRole("button", { name: `${name} 후보 삭제` }));
		expect(candidateRows()).toHaveLength(2);
		expect(document.activeElement).toBe(
			screen.getByRole("textbox", { name: "새 후보 이름" }),
		);
		fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
		expect(candidateRows()).toHaveLength(3);
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(room.snapshot).toEqual(original);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
	});

	it("keeps the waiting view free of candidate and filter editing controls for participants", () => {
		render(<LunchRoomPage roomId={roomId} />);
		expect(document.querySelector(".room-game-filter")).toBeNull();
		expect(screen.queryByRole("button", { name: "게임 필터" })).toBeNull();
		expect(screen.queryByRole("checkbox", { name: /추첨 포함$/ })).toBeNull();
		expect(screen.queryByRole("button", { name: "필터 초기화" })).toBeNull();
		expect(screen.queryByRole("button", { name: "후보 편집" })).toBeNull();
		expect(screen.queryByRole("button", { name: "목록 불러오기" })).toBeNull();
		expect(screen.queryByRole("button", { name: "새로 작성" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "후보 보기" }));
		const view = screen.getByRole("dialog", { name: "후보 보기" });
		expect(within(view).queryByRole("textbox")).toBeNull();
		expect(within(view).queryByRole("checkbox")).toBeNull();
		expect(room.updateGameFilter).not.toHaveBeenCalled();
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("applies a dirty inline list before opening recommendations instead of dropping changes", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.change(candidateName(1), {
			target: { value: "추천 전 수정" },
		});
		await act(async () =>
			fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" })),
		);
		expect(room.editRoom).toHaveBeenCalledOnce();
		expect(room.openIntake).toHaveBeenCalledOnce();
		expect(vi.mocked(room.editRoom).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(room.openIntake).mock.invocationCallOrder[0],
		);
	});

	it("keeps candidate changes while opening candidate views and independent settings", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "editing" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const editor = screen.getByRole("region", { name: "후보 편집" });
		expect(
			within(editor).queryByRole("textbox", { name: "방 이름" }),
		).toBeNull();
		expect(
			within(editor).queryByRole("checkbox", {
				name: "중복 없이 추첨 · 뽑힌 후보 제외",
			}),
		).toBeNull();
		fireEvent.change(candidateName(1), {
			target: { value: "보기 중에도 보존" },
		});
		expect(screen.queryByRole("button", { name: "후보 보기" })).toBeNull();
		updateRoom(view, {
			snapshot: snapshot({
				status: "editing",
				listVersion: 2,
				candidates: sampleLunchPlaces.slice(0, 3),
			}),
		});
		for (const [trigger, name] of [
			["공유 후보 보기", "후보 보기"],
			["방 설정", "방 설정"],
		]) {
			fireEvent.click(screen.getByRole("button", { name: trigger }));
			const dialog = screen.getByRole("dialog", { name });
			expect(
				within(dialog).queryByRole("button", { name: "변경 적용" }),
			).toBeNull();
			fireEvent.click(
				within(dialog).getAllByRole("button", { name: "닫기" })[0],
			);
			expect((candidateName(1) as HTMLInputElement).value).toBe(
				"보기 중에도 보존",
			);
		}
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("shows same-name recommendations and their authors while retaining the host's inline draft", () => {
		room.self = { id: "host-client", isHost: true };
		const candidates = sampleLunchPlaces.slice(0, 2);
		room.snapshot = snapshot({
			status: "collecting",
			intakeId: "intake-one",
			candidates,
		});
		const view = render(<LunchRoomPage roomId={roomId} />);
		const name = candidateName(1);
		fireEvent.change(name, { target: { value: "방장 초안" } });
		updateRoom(view, {
			snapshot: snapshot({
				status: "collecting",
				intakeId: "intake-one",
				listVersion: 3,
				candidates: [
					...candidates,
					{
						id: "r-a",
						name: "라면",
						category: "미분류",
						ownerId: "a",
						ownerName: "참가자 A",
					},
					{
						id: "r-b",
						name: "라면",
						category: "미분류",
						ownerId: "b",
						ownerName: "참가자 B",
					},
				],
			}),
		});
		expect(candidateName(1)).toBe(name);
		expect(name.value).toBe("방장 초안");
		expect(
			screen.getAllByRole("button", { name: "라면 이름 수정" }),
		).toHaveLength(2);
		expect(within(candidateRows()[2]).getByText("참가자 A")).toBeTruthy();
		expect(within(candidateRows()[3]).getByText("참가자 B")).toBeTruthy();
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it("submits a host addition during intake as a shared recommendation", async () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "collecting", intakeId: "intake-one" });
		vi.mocked(room.addCandidate).mockResolvedValue(true);
		render(<LunchRoomPage roomId={roomId} />);
		const name = screen.getByRole("textbox", {
			name: "새 후보 이름",
		}) as HTMLInputElement;
		fireEvent.change(name, { target: { value: "라면" } });
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보 추가" })),
		);
		expect(room.addCandidate).toHaveBeenCalledExactlyOnceWith("라면");
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(name.value).toBe("");
	});

	it("requires confirmation before replacing a conflicting inline candidate draft with the shared list", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "collecting", intakeId: "intake-one" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.change(candidateName(1), {
			target: { value: "보존할 후보 초안" },
		});
		updateRoom(view, {
			snapshot: snapshot({
				status: "collecting",
				intakeId: "intake-one",
				listVersion: 2,
				candidates: [...sampleLunchPlaces.slice(0, 3)],
			}),
		});
		fireEvent.click(screen.getByRole("button", { name: "최신 후보 불러오기" }));
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect((candidateName(1) as HTMLInputElement).value).toBe(
			"보존할 후보 초안",
		);
		fireEvent.click(screen.getByRole("button", { name: "최신 후보 불러오기" }));
		fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
		expect((candidateName(1) as HTMLInputElement).value).toBe(
			sampleLunchPlaces[0].name,
		);
		expect(candidateRows()).toHaveLength(3);
		expect(room.editRoom).not.toHaveBeenCalled();
	});

	it.each([
		"waiting",
		"result",
	] as const)("saves only the room name through settings during %s without touching candidates or the current round", async (status) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status,
			draw: status === "result" ? draw(baseTime - 8000) : null,
			excludedIds: [sampleLunchPlaces[0].id],
		});
		const before = structuredClone(room.snapshot);
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		fireEvent.change(
			within(settings).getByRole("textbox", { name: "방 이름" }),
			{ target: { value: "별도 방 이름" } },
		);
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(room.editRoom).toHaveBeenCalledExactlyOnceWith({
			baseVersion: 1,
			title: "별도 방 이름",
		});
		expect(room.snapshot).toEqual(before);
		expect(room.enterEditing).not.toHaveBeenCalled();
		expect(room.nextRound).not.toHaveBeenCalled();
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
	});

	it("groups the next game with exclusion settings and keeps one host action", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "result", draw: draw(baseTime - 8000) });
		render(<LunchRoomPage roomId={roomId} />);
		const preparation = screen.getByRole("complementary", {
			name: "다음 게임 준비",
		});
		expect(
			within(preparation).getByRole("switch", {
				name: "중복 없이 추첨 · 뽑힌 후보 제외",
			}),
		).toBeTruthy();
		const next = within(preparation).getByRole("button", { name: "다음 게임" });
		expect(screen.getAllByRole("button", { name: "다음 게임" })).toHaveLength(
			1,
		);
		fireEvent.click(next);
		expect(room.nextRound).toHaveBeenCalledOnce();
	});

	it("takes the host from the result to candidate editing and moves keyboard focus into the editor", () => {
		const current = draw(baseTime - 8000);
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "result", draw: current });
		const view = render(<LunchRoomPage roomId={roomId} />);
		const edit = screen.getByRole("button", { name: "후보 편집" });
		fireEvent.click(edit);
		expect(room.nextRound).toHaveBeenCalledExactlyOnceWith(current.id, true);
		updateRoom(view, { nextPending: true });
		expect(edit).toHaveProperty("disabled", true);
		expect(edit.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("button", { name: "다음 게임" })).toHaveProperty(
			"disabled",
			true,
		);
		updateRoom(view, {
			nextPending: false,
			snapshot: snapshot({ status: "editing", history: [current] }),
		});
		expect(document.activeElement).toBe(
			screen.getByRole("heading", { name: "후보 편집" }),
		);
		expect(room.enterEditing).not.toHaveBeenCalled();
		expect(room.startDraw).not.toHaveBeenCalled();
	});

	it.each([
		"waiting",
		"result",
	] as const)("changes only the upcoming game option during %s", async (status) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status,
			draw: status === "result" ? draw(baseTime - 8000) : null,
			excludedIds: [sampleLunchPlaces[0].id],
			revision: 4,
			excludeDrawn: false,
		});
		const before = structuredClone(room.snapshot);
		const view = render(<LunchRoomPage roomId={roomId} />);
		const options = screen.getByRole("complementary", {
			name: /후보 제외 목록|다음 게임 준비/,
		});
		expect(document.querySelector(".room-next-options")).toBeNull();
		await act(async () =>
			fireEvent.click(
				within(options).getByRole("switch", {
					name: "중복 없이 추첨 · 뽑힌 후보 제외",
				}),
			),
		);
		expect(room.updateRoomOptions).toHaveBeenCalledExactlyOnceWith(true, 4);
		updateRoom(view, {
			snapshot: { ...before, excludeDrawn: true, revision: 5 },
		});
		expect(room.snapshot?.title).toBe(before.title);
		expect(room.snapshot?.candidates).toEqual(before.candidates);
		expect(room.snapshot?.excludedIds).toEqual(before.excludedIds);
		expect(room.snapshot?.draw).toEqual(before.draw);
		expect(room.snapshot?.status).toBe(status);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.enterEditing).not.toHaveBeenCalled();
		expect(room.nextRound).not.toHaveBeenCalled();
	});

	it("keeps the game option read-only for participants", () => {
		render(<LunchRoomPage roomId={roomId} />);
		const options = screen.getByRole("complementary", {
			name: /후보 제외 목록|다음 게임 준비/,
		});
		const toggle = within(options).getByRole("switch", {
			name: "중복 없이 추첨 · 뽑힌 후보 제외",
		});
		expect(toggle.matches(":disabled")).toBe(true);
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
	});

	it.each([
		{ label: "fetching", status: "fetching", current: null },
		{ label: "drawing", status: "drawing", current: draw() },
		{
			label: "drawing after the reveal timeline has ended",
			status: "drawing",
			current: draw(baseTime - 8000),
		},
	] as const)("locks the game option during $label", ({ status, current }) => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({
			status,
			draw: current,
		});
		render(<LunchRoomPage roomId={roomId} />);
		const options = screen.getByRole("complementary", {
			name: /후보 제외 목록|다음 게임 준비/,
		});
		expect(
			within(options)
				.getByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" })
				.matches(":disabled"),
		).toBe(true);
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
	});

	it("shows participants read-only settings without room management controls", () => {
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		expect(within(settings).getByText("오늘 점심 함께 골라요")).toBeTruthy();
		expect(within(settings).queryByRole("textbox")).toBeNull();
		expect(within(settings).queryByRole("checkbox")).toBeNull();
		expect(
			within(settings).queryByRole("button", { name: "변경 저장" }),
		).toBeNull();
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
	});

	it("locks host setting changes while entropy is fetching or the roulette is drawing", () => {
		room.self = { id: "host-client", isHost: true };
		room.snapshot = snapshot({ status: "fetching" });
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		expect(
			within(settings)
				.getByRole("textbox", { name: "방 이름" })
				.matches(":disabled"),
		).toBe(true);
		expect(within(settings).queryByRole("checkbox")).toBeNull();
		updateRoom(view, {
			snapshot: snapshot({ status: "drawing", draw: draw() }),
		});
		expect(
			within(settings)
				.getByRole("textbox", { name: "방 이름" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			within(settings)
				.getByRole("button", { name: "변경 저장" })
				.matches(":disabled"),
		).toBe(true);
		expect(room.editRoom).not.toHaveBeenCalled();
		expect(room.updateRoomOptions).not.toHaveBeenCalled();
	});

	it("preserves a rejected settings name and confirms before discarding it", async () => {
		room.self = { id: "host-client", isHost: true };
		vi.mocked(room.editRoom).mockResolvedValue(false);
		render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		const title = within(settings).getByRole("textbox", {
			name: "방 이름",
		}) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "보존할 설정 초안" } });
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(screen.getByRole("dialog", { name: "방 설정" })).toBeTruthy();
		expect(title.value).toBe("보존할 설정 초안");
		fireEvent.click(
			within(settings).getAllByRole("button", { name: "닫기" })[0],
		);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
		expect(title.value).toBe("보존할 설정 초안");
		fireEvent.click(
			within(settings).getAllByRole("button", { name: "닫기" })[0],
		);
		fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
		expect(screen.queryByRole("dialog", { name: "방 설정" })).toBeNull();
	});

	it("keeps a local settings name when another host changes the shared name and confirms reloading it", async () => {
		room.self = { id: "host-client", isHost: true };
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		const title = within(settings).getByRole("textbox", {
			name: "방 이름",
		}) as HTMLInputElement;
		fireEvent.change(title, { target: { value: "내 설정 초안" } });
		updateRoom(view, {
			snapshot: snapshot({ title: "다른 방장이 바꾼 이름" }),
		});
		expect(title.value).toBe("내 설정 초안");
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(room.editRoom).not.toHaveBeenCalled();
		fireEvent.click(
			within(settings).getByRole("button", { name: "최신 방 이름 불러오기" }),
		);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
		expect(title.value).toBe("다른 방장이 바꾼 이름");
		expect(screen.getByRole("dialog", { name: "방 설정" })).toBeTruthy();
	});

	it("retries a room-name save with the original candidate version after an unknown acknowledgment and a remote recommendation", async () => {
		room.self = { id: "host-client", isHost: true };
		vi.mocked(room.editRoom)
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		const view = render(<LunchRoomPage roomId={roomId} />);
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		fireEvent.change(
			within(settings).getByRole("textbox", { name: "방 이름" }),
			{ target: { value: "응답 유실 재시도" } },
		);
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(room.editRoom).toHaveBeenNthCalledWith(1, {
			baseVersion: 1,
			title: "응답 유실 재시도",
		});
		updateRoom(view, {
			snapshot: snapshot({
				title: "응답 유실 재시도",
				listVersion: 2,
				candidates: [...sampleLunchPlaces.slice(0, 3)],
			}),
		});
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(room.editRoom).toHaveBeenNthCalledWith(2, {
			baseVersion: 1,
			title: "응답 유실 재시도",
		});
		expect(vi.mocked(room.editRoom).mock.calls[1][0]).not.toHaveProperty(
			"candidates",
		);
	});

	it("keeps connection information by the title and room lifetime behind its disclosure", () => {
		room.snapshot = snapshot({
			participants: [{ id: "guest-client", name: "참가자", isHost: false }],
		});
		render(<LunchRoomPage roomId={roomId} />);
		expect(
			screen.getByText(/^방장이 오프라인입니다\. 채팅하며 기다릴 수 있고/),
		).toBeTruthy();
		const titleBlock = screen
			.getByRole("heading", { level: 1, name: "오늘 점심 함께 골라요" })
			.closest(".room-title-block") as HTMLElement;
		expect(titleBlock).not.toBeNull();
		expect(within(titleBlock).getByText("연결됨")).toBeTruthy();
		expect(within(titleBlock).getByText("참가 1명")).toBeTruthy();
		expect(screen.queryByText("실시간 연결됨")).toBeNull();
		const infoToggle = screen
			.getByText("방 정보")
			.closest("summary") as HTMLElement;
		expect(infoToggle).not.toBeNull();
		const details = infoToggle.closest("details") as HTMLDetailsElement;
		expect(details.open).toBe(false);
		expect(details.querySelectorAll(".room-lifetime time")).toHaveLength(2);
		fireEvent.click(infoToggle);
		expect(details.open).toBe(true);
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
		).toBe(Node.DOCUMENT_POSITION_PRECEDING);
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
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		const history = screen.getByRole("region", { name: "추첨 기록" });
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
			screen.getByRole("heading", { name: "추첨 기록" }),
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
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
		const history = screen.getByRole("region", { name: "추첨 기록" });
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
		).not.toContain("재연결 중");
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

	it("opens a nonmodal history dialog and expands collapsed desktop chat before moving keyboard focus", async () => {
		room.snapshot = snapshot({ history: [draw(baseTime - 8000)] });
		render(<LunchRoomPage roomId={roomId} />);
		const chat = screen.getByRole("textbox", { name: "메시지" });
		fireEvent.click(screen.getByRole("button", { name: "채팅 접기" }));
		expect(screen.queryByRole("textbox", { name: "메시지" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
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
		expect(screen.getByRole("textbox", { name: "메시지" })).toBe(chat);
		expect(
			screen
				.getByRole("button", { name: "채팅 접기" })
				.getAttribute("aria-expanded"),
		).toBe("true");
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
		expect(document.activeElement).toBe(
			screen.getByRole("button", { name: "지난 기록" }),
		);
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
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
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
		expect(document.activeElement).toBe(
			screen.getByRole("button", {
				name: `${sampleLunchPlaces[1].name} 상세 기록 열기`,
			}),
		);
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
		fireEvent.click(screen.getByRole("button", { name: "지난 기록" }));
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
