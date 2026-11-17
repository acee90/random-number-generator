// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLunchRoom } from "../src/hooks/useLunchRoom";
import { getWheelRotation, sampleLunchPlaces } from "../src/lib/lunch";
import type { RoomDraw, RoomSnapshot } from "../src/lib/lunchRoom";

interface TestSocket extends EventTarget {
	readyState: number;
	options: Record<string, unknown>;
	send: ReturnType<typeof vi.fn<(raw: string) => boolean>>;
	close: ReturnType<typeof vi.fn<() => void>>;
	reconnect: ReturnType<typeof vi.fn<() => void>>;
}
const mocks = vi.hoisted(() => ({
	sockets: [] as TestSocket[],
	readHost: vi.fn(),
	readName: vi.fn(),
	readGuestToken: vi.fn(),
	saveName: vi.fn(),
	consumeEntry: vi.fn(),
}));
vi.mock("../src/lib/lunchRoomClient", () => ({
	readLunchRoomHost: mocks.readHost,
	readLunchRoomName: mocks.readName,
	readOrCreateLunchRoomGuestToken: mocks.readGuestToken,
	saveLunchRoomName: mocks.saveName,
	consumeLunchRoomEntry: mocks.consumeEntry,
}));
vi.mock("partysocket", () => ({
	default: class extends EventTarget {
		readyState = 0;
		options: Record<string, unknown>;
		send = vi.fn((_raw: string) => this.readyState === 1);
		close = vi.fn(() => {
			this.readyState = 3;
			this.dispatchEvent(new Event("close"));
		});
		reconnect = vi.fn();
		constructor(options: Record<string, unknown>) {
			super();
			this.options = options;
			mocks.sockets.push(this);
		}
	},
}));

const roomId = "9b8c4944-5841-462d-b5a4-a701044be6b2";
const token = "a".repeat(64);
const guestToken = "b".repeat(64);
function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return {
		roomId,
		title: "함께 점심",
		createdAt: Date.now() - 1000,
		expiresAt: Date.now() - 1000 + 86400000,
		listVersion: 1,
		candidates: [...sampleLunchPlaces.slice(0, 2)],
		participants: [{ id: "host-client", name: "민수", isHost: true }],
		messages: [],
		draw: null,
		history: [],
		status: "waiting",
		...overrides,
	};
}
function socket() {
	return mocks.sockets[mocks.sockets.length - 1];
}
function opened() {
	act(() => {
		socket().readyState = 1;
		socket().dispatchEvent(new Event("open"));
	});
}
function receive(data: unknown) {
	act(() => {
		socket().dispatchEvent(
			new MessageEvent("message", {
				data: typeof data === "string" ? data : JSON.stringify(data),
			}),
		);
	});
}
function joined(isHost = true, current = snapshot()) {
	opened();
	receive({
		type: "snapshot",
		snapshot: current,
		serverTime: Date.now(),
		self: { id: isHost ? "host-client" : "guest-client", isHost },
	});
}
function sent(type: string) {
	return socket()
		.send.mock.calls.map(([raw]) => JSON.parse(raw))
		.filter((entry) => entry.type === type);
}

function interact(type: string) {
	act(() => window.dispatchEvent(new Event(type)));
}

function feedbackDraw(): RoomDraw {
	return {
		id: "feedback-draw",
		candidates: [...sampleLunchPlaces.slice(0, 2)],
		winnerIndex: 0,
		source: "quantum",
		timestamp: Date.now() - 11500,
		startedAt: Date.now() - 10000,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: getWheelRotation(0, 0, 2),
		listVersion: 1,
		participants: [{ id: "guest-client", name: "참가자", isHost: false }],
		votes: [],
	};
}

describe("irreversible current-result feedback", () => {
	it("acknowledges host closure and stops reconnection on the terminal snapshot", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.closeRoom();
		});
		expect(sent("room-close")).toHaveLength(1);
		expect(result.current.mutationPending).toBe("close");
		await act(async () => {
			receive({ type: "ack", requestId: sent("room-close")[0].id });
			expect(await request).toBe(true);
		});
		receive({
			type: "snapshot",
			snapshot: snapshot({ status: "closed" }),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		expect(result.current.connection).toBe("closed");
		expect(result.current.error).toContain("방장이 방을 종료");
		act(() => {
			vi.advanceTimersByTime(60000);
		});
		expect(socket().reconnect).not.toHaveBeenCalled();
	});

	it("does not send closure commands from a guest", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false);
		expect(await result.current.closeRoom()).toBe(false);
		expect(sent("room-close")).toHaveLength(0);
	});

	it("does not send a ballot for a late join even when the result is revealed", () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, snapshot({ draw: { ...feedbackDraw(), participants: [] } }));
		act(() => expect(result.current.vote("feedback-draw", "up")).toBe(false));
		expect(sent("vote")).toHaveLength(0);
	});
	it("closes only the current completed result, waits for acknowledgement, and does not start another draw", () => {
		const draw = feedbackDraw();
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ draw }));
		act(() => {
			expect(result.current.nextRound(draw.id)).toBe(true);
			expect(result.current.nextRound(draw.id)).toBe(false);
			expect(result.current.startDraw()).toBe(false);
		});
		expect(result.current.nextPending).toBe(true);
		expect(sent("next")).toEqual([
			{ type: "next", id: expect.any(String), drawId: draw.id },
		]);
		receive({
			type: "error",
			code: "CHAT_RATE",
			message: "잠시 후 전송해 주세요.",
			requestId: "unrelated-chat",
		});
		expect(result.current.nextPending).toBe(true);
		receive({
			type: "snapshot",
			snapshot: snapshot({ draw }),
			serverTime: Date.now(),
		});
		expect(result.current.nextPending).toBe(true);
		receive({
			type: "snapshot",
			snapshot: snapshot({ draw: null, history: [draw] }),
			serverTime: Date.now(),
		});
		expect(result.current.nextPending).toBe(false);
		expect(sent("start")).toHaveLength(0);
		act(() => expect(result.current.startDraw()).toBe(true));
	});
	it("allows the host to close at reveal even while the last snapshot still says drawing", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		const draw = feedbackDraw();
		joined(true, snapshot({ draw, status: "drawing" }));
		act(() => expect(result.current.nextRound(draw.id)).toBe(true));
		expect(sent("next")).toHaveLength(1);
	});

	it("clears an unconfirmed close on timeout and on matching rejection", () => {
		const draw = feedbackDraw();
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ draw }));
		act(() => result.current.nextRound(draw.id));
		receive({
			type: "error",
			code: "VOTE_NOT_READY",
			message: "추첨 종료 후 다시 시도해 주세요.",
			requestId: sent("next")[0].id,
		});
		expect(result.current.nextPending).toBe(false);
		act(() => result.current.nextRound(draw.id));
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.nextPending).toBe(false);
		expect(sent("next")).toHaveLength(2);
	});

	it("sends one vote and waits for its own authoritative ballot despite unrelated updates", () => {
		mocks.readHost.mockReturnValue(undefined);
		const current = snapshot({ draw: feedbackDraw() });
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, current);
		act(() => {
			expect(result.current.vote("feedback-draw", "up")).toBe(true);
			expect(result.current.vote("feedback-draw", "down")).toBe(false);
		});
		expect(sent("vote")).toEqual([
			{
				type: "vote",
				id: expect.any(String),
				drawId: "feedback-draw",
				vote: "up",
			},
		]);
		expect(result.current.votePendingDrawId).toBe("feedback-draw");
		receive({ type: "snapshot", snapshot: current, serverTime: Date.now() });
		receive({
			type: "error",
			code: "CHAT_TOO_FAST",
			message: "채팅 대기",
			requestId: "another-request",
		});
		expect(result.current.votePendingDrawId).toBe("feedback-draw");
		const vote = {
			participantId: "guest-client",
			name: "민수",
			vote: "up" as const,
			timestamp: Date.now(),
			reactionMs: 2800,
		};
		receive({
			type: "snapshot",
			snapshot: { ...current, draw: { ...current.draw, votes: [vote] } },
			serverTime: Date.now(),
		});
		expect(result.current.votePendingDrawId).toBeNull();
		act(() => expect(result.current.vote("feedback-draw", "down")).toBe(false));
		expect(sent("vote")).toHaveLength(1);
	});

	it("refuses identities outside the draw roster, unfinished and archived results but has no short voting deadline", () => {
		const draw = feedbackDraw();
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ draw }));
		act(() => expect(result.current.vote(draw.id, "up")).toBe(false));
		receive({
			type: "snapshot",
			snapshot: snapshot({
				draw: { ...draw, startedAt: Date.now(), timestamp: Date.now() - 1500 },
				status: "drawing",
			}),
			serverTime: Date.now(),
			self: { id: "guest-client", isHost: false },
		});
		act(() => expect(result.current.vote(draw.id, "up")).toBe(false));
		receive({
			type: "snapshot",
			snapshot: snapshot({ draw, history: [draw] }),
			serverTime: Date.now(),
		});
		act(() => expect(result.current.vote(draw.id, "up")).toBe(false));
		act(() => vi.advanceTimersByTime(120000));
		receive({
			type: "snapshot",
			snapshot: snapshot({ draw }),
			serverTime: Date.now(),
		});
		act(() => expect(result.current.vote(draw.id, "down")).toBe(true));
		expect(sent("vote")).toHaveLength(1);
	});

	it("lets an eligible host vote once and reconciles its authoritative ballot without replaying on reconnect", () => {
		const draw = {
			...feedbackDraw(),
			participants: [{ id: "host-client", name: "민수", isHost: true }],
		};
		const current = snapshot({ draw, status: "result" });
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, current);
		act(() => {
			expect(result.current.vote(draw.id, "up")).toBe(true);
			expect(result.current.vote(draw.id, "down")).toBe(false);
		});
		expect(sent("vote")).toHaveLength(1);
		expect(result.current.votePendingDrawId).toBe(draw.id);
		const confirmed = {
			...current,
			draw: {
				...draw,
				votes: [
					{
						participantId: "host-client",
						name: "민수",
						vote: "up" as const,
						timestamp: Date.now(),
						reactionMs: 2800,
					},
				],
			},
		};
		receive({ type: "snapshot", snapshot: confirmed, serverTime: Date.now() });
		expect(result.current.votePendingDrawId).toBeNull();
		act(() => expect(result.current.vote(draw.id, "down")).toBe(false));
		act(() => socket().close());
		opened();
		receive({
			type: "snapshot",
			snapshot: confirmed,
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		act(() => expect(result.current.vote(draw.id, "down")).toBe(false));
		expect(sent("vote")).toHaveLength(1);
	});

	it("clears only a matching vote rejection and closes pending feedback when next draw starts", () => {
		mocks.readHost.mockReturnValue(undefined);
		const draw = feedbackDraw();
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, snapshot({ draw }));
		act(() => result.current.vote(draw.id, "up"));
		const requestId = sent("vote")[0].id;
		receive({
			type: "error",
			code: "VOTE_REJECTED",
			message: "투표 확인 실패",
			requestId,
		});
		expect(result.current.votePendingDrawId).toBeNull();
		act(() => expect(result.current.vote(draw.id, "up")).toBe(true));
		receive({
			type: "snapshot",
			snapshot: snapshot({ draw: null, history: [draw], status: "fetching" }),
			serverTime: Date.now(),
		});
		expect(result.current.votePendingDrawId).toBeNull();
		act(() => expect(result.current.vote(draw.id, "down")).toBe(false));
		expect(sent("vote")).toHaveLength(2);
	});

	it("does not replay votes after disconnect and respects the restored immutable choice", () => {
		mocks.readHost.mockReturnValue(undefined);
		const draw = feedbackDraw();
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, snapshot({ draw }));
		act(() => result.current.vote(draw.id, "down"));
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		expect(result.current.votePendingDrawId).toBeNull();
		act(() => expect(result.current.vote(draw.id, "up")).toBe(false));
		joined(
			false,
			snapshot({
				draw: {
					...draw,
					votes: [
						{
							participantId: "guest-client",
							name: "민수",
							vote: "down",
							timestamp: Date.now(),
							reactionMs: 2800,
						},
					],
				},
			}),
		);
		act(() => expect(result.current.vote(draw.id, "up")).toBe(false));
		expect(sent("vote")).toHaveLength(1);
	});

	it("handles an unconfirmed request without auto-submitting another vote", () => {
		mocks.readHost.mockReturnValue(undefined);
		const draw = feedbackDraw();
		const { result, unmount } = renderHook(() => useLunchRoom(roomId));
		joined(false, snapshot({ draw }));
		act(() => result.current.vote(draw.id, "up"));
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.votePendingDrawId).toBeNull();
		expect(result.current.error).toContain("투표 확인이 지연");
		expect(sent("vote")).toHaveLength(1);
		act(() => result.current.vote(draw.id, "up"));
		unmount();
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("vote")).toHaveLength(2);
	});
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-13T05:00:00.000Z"));
	mocks.sockets.length = 0;
	mocks.readHost.mockReset().mockReturnValue(token);
	mocks.readName.mockReset().mockReturnValue("민수");
	mocks.readGuestToken.mockReset().mockReturnValue(guestToken);
	mocks.saveName.mockReset();
	mocks.consumeEntry.mockReset();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("room lifecycle commands", () => {
	const collecting = () =>
		snapshot({ status: "collecting", intakeId: "intake-1", revision: 7 });
	function broadcast(current: RoomSnapshot) {
		receive({ type: "snapshot", snapshot: current, serverTime: Date.now() });
	}
	function acknowledge(type: string) {
		receive({ type: "ack", requestId: sent(type).at(-1).id });
	}
	it("sends an optional recommendation category and reuses its exact request after an unconfirmed ACK", async () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, collecting());
		let first!: Promise<boolean>;
		act(() => {
			first = result.current.addCandidate("  카레  ", "  팀 추천  ");
		});
		const original = sent("recommend")[0];
		expect(original).toMatchObject({
			name: "카레",
			category: "팀 추천",
			intakeId: "intake-1",
		});
		act(() => vi.advanceTimersByTime(15000));
		expect(await first).toBe(false);
		broadcast({ ...collecting(), listVersion: 2, revision: 8 });
		let retry!: Promise<boolean>;
		act(() => {
			retry = result.current.addCandidate("카레", "팀 추천");
		});
		expect(sent("recommend")[1]).toEqual(original);
		await act(async () => {
			acknowledge("recommend");
			expect(await retry).toBe(true);
		});
	});
	it("normalizes a blank optional recommendation category to unclassified", async () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, collecting());
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.addCandidate("새 후보", "  ");
		});
		expect(sent("recommend")[0]).toMatchObject({ category: "미분류" });
		await act(async () => {
			acknowledge("recommend");
			expect(await request).toBe(true);
		});
	});
	it.each([
		"editing",
		"collecting",
		"reviewing",
	] as const)("applies game filters independently in %s only after a matching ACK", async (status) => {
		const current = snapshot({
			status,
			revision: 7,
			listVersion: 3,
			draw: null,
			intakeId: status === "editing" ? null : "intake-1",
			excludedIds: [sampleLunchPlaces[0].id],
		});
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, current);
		const before = structuredClone(result.current.snapshot);
		const filter = {
			categories: [sampleLunchPlaces[0].category],
			excludedIds: [sampleLunchPlaces[1].id],
		};
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.updateGameFilter(filter, 6);
		});
		expect(sent("game-filter")[0]).toMatchObject({
			expectedRevision: 6,
			filter,
		});
		filter.categories.push("바뀐 호출자 배열");
		filter.excludedIds.length = 0;
		expect(sent("game-filter")[0].filter).toEqual({
			categories: [sampleLunchPlaces[0].category],
			excludedIds: [sampleLunchPlaces[1].id],
		});
		expect(result.current.mutationPending).toBe("filter");
		const completion = vi.fn();
		void request.then(completion);
		receive({ type: "ack", requestId: "unrelated" });
		expect(completion).not.toHaveBeenCalled();
		await act(async () => {
			expect(
				await result.current.updateGameFilter({
					categories: null,
					excludedIds: [],
				}),
			).toBe(false);
		});
		await act(async () => {
			acknowledge("game-filter");
			expect(await request).toBe(true);
		});
		expect(result.current.mutationPending).toBeNull();
		expect(result.current.snapshot).toEqual(before);
		expect(sent("room-edit")).toHaveLength(0);
		expect(sent("intake")).toHaveLength(0);
	});
	it("reuses a game-filter request ID with its confirmed revision after an ACK timeout", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ status: "editing", revision: 7 }));
		const filter = { categories: null, excludedIds: [] };
		let first!: Promise<boolean>;
		act(() => {
			first = result.current.updateGameFilter(filter, 7);
		});
		const original = sent("game-filter")[0];
		act(() => vi.advanceTimersByTime(15000));
		expect(await first).toBe(false);
		broadcast(snapshot({ status: "editing", revision: 8, gameFilter: filter }));
		let retry!: Promise<boolean>;
		act(() => {
			retry = result.current.updateGameFilter(filter, 7);
		});
		expect(sent("game-filter")[1]).toEqual(original);
		await act(async () => {
			acknowledge("game-filter");
			expect(await retry).toBe(true);
		});
	});
	it.each([
		"waiting",
		"result",
		"fetching",
		"drawing",
		"closed",
	] as const)("blocks game-filter changes during %s", async (status) => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(
			true,
			snapshot({
				status,
				draw:
					status === "drawing" || status === "result" ? feedbackDraw() : null,
			}),
		);
		await act(async () => {
			expect(
				await result.current.updateGameFilter({
					categories: null,
					excludedIds: [],
				}),
			).toBe(false);
		});
		expect(sent("game-filter")).toHaveLength(0);
	});
	it("uses the latest snapshot revision for a filter immediately after the candidate ACK even through an older callback", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ status: "editing", revision: 7 }));
		const updateFilter = result.current.updateGameFilter;
		const candidates = sampleLunchPlaces
			.slice(0, 2)
			.map((candidate) => ({ ...candidate, category: "새 분류" }));
		let edit!: Promise<boolean>;
		let applyFilter!: Promise<boolean>;
		act(() => {
			edit = result.current.editRoom({ baseVersion: 1, candidates });
		});
		await act(async () => {
			broadcast(
				snapshot({
					status: "editing",
					revision: 8,
					listVersion: 2,
					candidates,
				}),
			);
			acknowledge("room-edit");
			expect(await edit).toBe(true);
			applyFilter = updateFilter({ categories: ["새 분류"], excludedIds: [] });
		});
		expect(sent("game-filter")[0]).toMatchObject({
			expectedRevision: 8,
			filter: { categories: ["새 분류"], excludedIds: [] },
		});
		await act(async () => {
			acknowledge("game-filter");
			expect(await applyFilter).toBe(true);
		});
	});
	it("keeps game-filter changes host-only", async () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, snapshot({ status: "editing" }));
		await act(async () => {
			expect(
				await result.current.updateGameFilter({
					categories: null,
					excludedIds: [],
				}),
			).toBe(false);
		});
		expect(sent("game-filter")).toHaveLength(0);
	});
	it("unlocks a rejected legacy candidate action and shows the upgrade instruction", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => {
			expect(
				result.current.updateCandidates(
					sampleLunchPlaces.slice(0, 2).map((candidate) => candidate.id),
				),
			).toBe(true);
		});
		expect(result.current.candidatesPending).toBe(true);
		receive({
			type: "error",
			code: "CLIENT_UPGRADE_REQUIRED",
			message: "새 화면으로 다시 연결해 후보를 편집해 주세요.",
		});
		expect(result.current.candidatesPending).toBe(false);
		expect(result.current.error).toContain("새 화면으로 다시 연결");
	});
	it("preserves a submitted recommendation until its own ACK despite unrelated activity", async () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, collecting());
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.addCandidate("  우동  ");
		});
		const completion = vi.fn();
		void request.then(completion);
		expect(sent("recommend")).toEqual([
			{
				type: "recommend",
				id: expect.any(String),
				name: "우동",
				intakeId: "intake-1",
			},
		]);
		expect(result.current.mutationPending).toBe("candidate");
		broadcast({ ...collecting(), listVersion: 2, revision: 8 });
		receive({ type: "ack", requestId: "another-request" });
		receive({
			type: "error",
			code: "CHAT_RATE",
			message: "잠시 후 보내 주세요.",
			requestId: "unrelated-chat",
		});
		await act(async () => {
			expect(await result.current.addCandidate("중복 전송")).toBe(false);
		});
		expect(completion).not.toHaveBeenCalled();
		expect(result.current.mutationPending).toBe("candidate");
		await act(async () => {
			acknowledge("recommend");
			expect(await request).toBe(true);
		});
		expect(result.current.mutationPending).toBeNull();
		expect(sent("recommend")).toHaveLength(1);
	});
	it("rejects a late intake request and uses the new intake ID only on an explicit retry", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, collecting());
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.addCandidate("우동");
		});
		const previousId = sent("recommend")[0].id;
		broadcast({ ...collecting(), status: "reviewing", revision: 8 });
		await act(async () => {
			receive({
				type: "error",
				code: "INTAKE_CLOSED",
				message: "추천 접수가 종료되었습니다. 입력은 보관됩니다.",
				requestId: previousId,
			});
			expect(await request).toBe(false);
			expect(await result.current.addCandidate("우동")).toBe(false);
		});
		broadcast({ ...collecting(), intakeId: "intake-2", revision: 9 });
		expect(sent("recommend")).toHaveLength(1);
		act(() => {
			request = result.current.addCandidate("우동");
		});
		expect(sent("recommend")[1]).toMatchObject({ intakeId: "intake-2" });
		expect(sent("recommend")[1].id).not.toBe(previousId);
		await act(async () => {
			acknowledge("recommend");
			expect(await request).toBe(true);
		});
	});
	it("resolves an unconfirmed recommendation as failed on disconnect and never replays it", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, collecting());
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.addCandidate("보관할 입력");
		});
		await act(async () => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
			expect(await request).toBe(false);
		});
		expect(result.current.mutationPending).toBeNull();
		joined(true, collecting());
		expect(sent("recommend")).toHaveLength(1);
	});
	it("times out a command and ignores its delayed ACK while a new command is pending", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, collecting());
		let first!: Promise<boolean>;
		act(() => {
			first = result.current.addCandidate("우동");
		});
		const staleId = sent("recommend")[0].id;
		await act(async () => {
			vi.advanceTimersByTime(15000);
			expect(await first).toBe(false);
		});
		expect(result.current.error).toContain("입력 내용은 유지");
		let retry!: Promise<boolean>;
		act(() => {
			retry = result.current.addCandidate("새 후보");
		});
		expect(sent("recommend")[1].id).not.toBe(staleId);
		receive({ type: "ack", requestId: staleId });
		expect(result.current.mutationPending).toBe("candidate");
		await act(async () => {
			acknowledge("recommend");
			expect(await retry).toBe(true);
		});
	});
	it("reuses an uncertain request ID on an explicit identical retry after reconnecting", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, collecting());
		let original!: Promise<boolean>;
		act(() => {
			original = result.current.addCandidate("우동");
		});
		const originalId = sent("recommend")[0].id;
		await act(async () => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
			expect(await original).toBe(false);
		});
		joined(true, collecting());
		expect(sent("recommend")).toHaveLength(1);
		let retry!: Promise<boolean>;
		act(() => {
			retry = result.current.addCandidate("우동");
		});
		expect(sent("recommend")[1].id).toBe(originalId);
		await act(async () => {
			acknowledge("recommend");
			expect(await retry).toBe(true);
		});
		let another!: Promise<boolean>;
		act(() => {
			another = result.current.addCandidate("우동");
		});
		expect(sent("recommend")[2].id).not.toBe(originalId);
		await act(async () => {
			acknowledge("recommend");
			expect(await another).toBe(true);
		});
	});
	it("sends title-only edits in editing without a stale candidate list", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ status: "editing", listVersion: 4, revision: 8 }));
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.editRoom({
				baseVersion: 1,
				title: "새 방 제목",
			});
		});
		expect(sent("room-edit")).toEqual([
			{
				type: "room-edit",
				id: expect.any(String),
				baseListVersion: 1,
				title: "새 방 제목",
			},
		]);
		await act(async () => {
			acknowledge("room-edit");
			expect(await request).toBe(true);
		});
		expect(result.current.snapshot?.draw).toBeNull();
		expect(result.current.snapshot?.status).toBe("editing");
		expect(sent("next")).toHaveLength(0);
		expect(result.current.startDraw()).toBe(false);
	});
	it("requires an explicit editing stage for candidate edits while keeping result options available", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ revision: 3 }));
		await act(async () => {
			expect(
				await result.current.editRoom({
					baseVersion: 1,
					candidates: [...sampleLunchPlaces.slice(0, 2)],
				}),
			).toBe(false);
		});
		let enter!: Promise<boolean>;
		act(() => {
			enter = result.current.enterEditing(3);
		});
		expect(sent("intake")[0]).toMatchObject({
			action: "edit",
			expectedRevision: 3,
		});
		broadcast(snapshot({ status: "editing", revision: 4, intakeId: null }));
		await act(async () => {
			acknowledge("intake");
			expect(await enter).toBe(true);
			expect(await result.current.enterEditing()).toBe(false);
		});
		let finish!: Promise<boolean>;
		act(() => {
			finish = result.current.finalizeIntake();
		});
		expect(sent("intake")[1]).toMatchObject({
			action: "finalize",
			expectedRevision: 4,
		});
		await act(async () => {
			acknowledge("intake");
			expect(await finish).toBe(true);
		});
		broadcast(
			snapshot({ status: "result", draw: feedbackDraw(), revision: 5 }),
		);
		await act(async () => {
			expect(await result.current.enterEditing()).toBe(false);
			expect(
				await result.current.editRoom({
					baseVersion: 1,
					candidates: [...sampleLunchPlaces.slice(0, 2)],
				}),
			).toBe(false);
		});
		let option!: Promise<boolean>;
		act(() => {
			option = result.current.updateRoomOptions(true);
		});
		await act(async () => {
			acknowledge("options");
			expect(await option).toBe(true);
		});
		expect(sent("room-edit")).toHaveLength(0);
		expect(result.current.snapshot?.status).toBe("result");
		expect(result.current.snapshot?.draw?.id).toBe("feedback-draw");
	});
	it.each([
		"waiting",
		"result",
	] as const)("allows independent title settings in %s without sending candidates or changing the phase", async (status) => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		const current = snapshot({
			status,
			listVersion: 4,
			revision: 8,
			draw: status === "result" ? feedbackDraw() : null,
			excludedIds: [sampleLunchPlaces[0].id],
		});
		joined(true, current);
		const before = structuredClone(result.current.snapshot);
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.editRoom({
				baseVersion: 1,
				title: "별도 방 설정",
			});
		});
		expect(sent("room-edit")).toEqual([
			{
				type: "room-edit",
				id: expect.any(String),
				baseListVersion: 1,
				title: "별도 방 설정",
			},
		]);
		await act(async () => {
			acknowledge("room-edit");
			expect(await request).toBe(true);
		});
		expect(result.current.snapshot).toEqual(before);
		await act(async () => {
			expect(
				await result.current.editRoom({ baseVersion: 4, candidates: [] }),
			).toBe(false);
		});
		expect(sent("room-edit")).toHaveLength(1);
		expect(sent("intake")).toHaveLength(0);
		expect(sent("next")).toHaveLength(0);
	});
	it.each([
		"fetching",
		"drawing",
		"closed",
	] as const)("blocks room-title settings during %s", async (status) => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(
			true,
			snapshot({ status, draw: status === "drawing" ? feedbackDraw() : null }),
		);
		await act(async () => {
			expect(
				await result.current.editRoom({ baseVersion: 1, title: "차단해야 함" }),
			).toBe(false);
		});
		expect(sent("room-edit")).toHaveLength(0);
	});
	it("limits guest candidate removal to their own candidate during intake", async () => {
		mocks.readHost.mockReturnValue(undefined);
		const current = collecting();
		current.candidates[0] = {
			...current.candidates[0],
			ownerId: "guest-client",
		};
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false, current);
		await act(async () => {
			expect(await result.current.enterEditing()).toBe(false);
			expect(await result.current.openIntake()).toBe(false);
			expect(await result.current.updateRoomOptions(true)).toBe(false);
			expect(
				await result.current.editRoom({ baseVersion: 1, title: "안 됨" }),
			).toBe(false);
			expect(
				await result.current.removeCandidate(current.candidates[1].id),
			).toBe(false);
		});
		let request!: Promise<boolean>;
		act(() => {
			request = result.current.removeCandidate(current.candidates[0].id);
		});
		expect(sent("remove-candidate")[0]).toMatchObject({
			candidateId: current.candidates[0].id,
			intakeId: "intake-1",
		});
		await act(async () => {
			acknowledge("remove-candidate");
			expect(await request).toBe(true);
		});
		broadcast({ ...current, status: "reviewing" });
		await act(async () => {
			expect(
				await result.current.removeCandidate(current.candidates[0].id),
			).toBe(false);
		});
	});
	it("keeps confirmation revisions fixed for reset and start requests", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(
			true,
			snapshot({ revision: 9, excludedIds: [sampleLunchPlaces[0].id] }),
		);
		let reset!: Promise<boolean>;
		act(() => {
			reset = result.current.resetExclusions(7);
		});
		expect(sent("reset-exclusions")[0]).toMatchObject({ expectedRevision: 7 });
		await act(async () => {
			receive({
				type: "error",
				code: "REVISION_CONFLICT",
				message: "조건이 변경되었습니다.",
				requestId: sent("reset-exclusions")[0].id,
			});
			expect(await reset).toBe(false);
		});
		act(() =>
			expect(
				result.current.startDraw({ confirmReset: true, expectedRevision: 7 }),
			).toBe(true),
		);
		expect(sent("start")[0]).toMatchObject({
			expectedRevision: 7,
			confirmReset: true,
		});
	});
	it("waits for a matching intake ACK and finalizes without starting a draw", async () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ revision: 3 }));
		let open!: Promise<boolean>;
		act(() => {
			open = result.current.openIntake();
		});
		expect(sent("intake")[0]).toMatchObject({
			action: "open",
			expectedRevision: 3,
		});
		broadcast(collecting());
		expect(result.current.mutationPending).toBe("intake");
		await act(async () => {
			acknowledge("intake");
			expect(await open).toBe(true);
		});
		let finalize!: Promise<boolean>;
		act(() => {
			finalize = result.current.finalizeIntake(7);
		});
		expect(sent("intake")[1]).toMatchObject({
			action: "finalize",
			expectedRevision: 7,
		});
		await act(async () => {
			acknowledge("intake");
			expect(await finalize).toBe(true);
		});
		expect(sent("start")).toHaveLength(0);
	});
});

describe("immediate own-chat display and acknowledgement", () => {
	function acknowledgeChat(id: string, text = "김밥 어때요?") {
		return snapshot({
			messages: [
				{
					id,
					participantId: "host-client",
					name: "민수",
					text,
					timestamp: Date.now(),
				},
			],
		});
	}
	function publish(current: RoomSnapshot) {
		receive({ type: "snapshot", snapshot: current, serverTime: Date.now() });
	}

	it("finishes debug traces from the small ACK with sync timing and wire payload size", () => {
		window.history.replaceState(null, "", "?debugRoom=1");
		try {
			const info = vi.spyOn(console, "info").mockImplementation(() => {});
			const { result } = renderHook(() => useLunchRoom(roomId));
			joined();
			act(() => result.current.sendChat("김밥 어때요?"));
			const { id, diagnosticId } = sent("chat")[0];
			expect(diagnosticId).toEqual(expect.any(String));
			const chatTrace = {
				diagnosticId,
				serverReceivedAt: Date.now(),
				serverSendAt: Date.now(),
				queueMs: 0,
				prepareMs: 0,
				saveMs: 0,
				alarmMs: 0,
				syncMs: 7,
				serverTotalMs: 7,
			};
			const raw = JSON.stringify({
				type: "chat-ack",
				roomId,
				message: acknowledgeChat(id).messages[0],
				serverTime: Date.now(),
				chatTrace,
			});
			receive(raw);
			const log = info.mock.calls
				.map(([value]) => String(value))
				.find((value) => value.startsWith("[room chat trace] "));
			if (!log) throw new Error("Missing chat trace");
			const trace = JSON.parse(log.slice("[room chat trace] ".length));
			expect(trace.server.syncMs).toBe(7);
			expect(trace.responseBytes).toBe(
				new TextEncoder().encode(raw).byteLength,
			);
			expect(result.current.localChatMessages).toEqual([]);
		} finally {
			window.history.replaceState(null, "", "/");
		}
	});

	it("reconciles a small durable ACK and peer delta without replacing room state", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		const candidates = result.current.snapshot?.candidates;
		act(() => result.current.sendChat("김밥 어때요?"));
		const id = sent("chat")[0].id;
		const own = acknowledgeChat(id).messages[0];
		const ack = {
			type: "chat-ack",
			roomId,
			message: own,
			serverTime: Date.now(),
		};
		receive(ack);
		expect(result.current.localChatMessages).toEqual([]);
		expect(result.current.snapshot?.messages).toEqual([own]);
		receive(ack);
		const peer = {
			...own,
			id: "peer-chat",
			participantId: "guest-client",
			text: "좋아요",
		};
		receive({
			type: "chat-message",
			roomId,
			message: peer,
			serverTime: Date.now(),
		});
		expect(result.current.snapshot?.messages).toEqual([own, peer]);
		expect(result.current.snapshot?.candidates).toBe(candidates);
		// Reconnect/full snapshots remain authoritative and do not duplicate deltas.
		publish(snapshot({ messages: [own, peer] }));
		expect(result.current.snapshot?.messages).toEqual([own, peer]);
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.error).toBe("");
	});

	it("does not confirm a different participant's message or another room's delta", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => result.current.sendChat("김밥 어때요?"));
		const id = sent("chat")[0].id;
		const entry = acknowledgeChat(id).messages[0];
		receive({
			type: "chat-ack",
			roomId,
			message: { ...entry, participantId: "other" },
			serverTime: Date.now(),
		});
		expect(result.current.localChatMessages).toHaveLength(1);
		receive({
			type: "chat-ack",
			roomId: "fc76a783-253a-47c7-95cd-5a7c9851d675",
			message: entry,
			serverTime: Date.now(),
		});
		expect(result.current.localChatMessages).toHaveLength(1);
		expect(result.current.error).toContain("방에서 받은 정보를");
	});

	it("bounds delta history and ignores deltas before admission", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		const entry = acknowledgeChat("new").messages[0];
		receive({
			type: "chat-message",
			roomId,
			message: entry,
			serverTime: Date.now(),
		});
		expect(result.current.snapshot).toBeNull();
		joined(
			true,
			snapshot({
				messages: Array.from({ length: 100 }, (_, i) => ({
					...entry,
					id: `old-${i}`,
				})),
			}),
		);
		receive({
			type: "chat-message",
			roomId,
			message: entry,
			serverTime: Date.now(),
		});
		expect(result.current.snapshot?.messages).toHaveLength(100);
		expect(result.current.snapshot?.messages[0].id).toBe("old-1");
		expect(result.current.snapshot?.messages.at(-1)).toEqual(entry);
	});

	it("shows the sent text immediately without changing authoritative room data, then reconciles by message ID", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		const authoritative = result.current.snapshot;
		act(() => expect(result.current.sendChat(" 김밥 어때요? ")).toBe(true));
		const id = sent("chat")[0].id;
		expect(result.current.snapshot).toBe(authoritative);
		expect(result.current.snapshot?.messages).toEqual([]);
		expect(result.current.localChatMessages).toEqual([
			expect.objectContaining({
				id,
				roomId,
				participantId: "host-client",
				name: "민수",
				text: "김밥 어때요?",
				delivery: "sending",
			}),
		]);
		publish(snapshot({ listVersion: 2 }));
		expect(result.current.localChatMessages).toHaveLength(1);
		publish(acknowledgeChat(id));
		expect(result.current.localChatMessages).toEqual([]);
		expect(result.current.snapshot?.messages).toHaveLength(1);
		publish(acknowledgeChat(id));
		expect(result.current.localChatMessages).toEqual([]);
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.error).toBe("");
		expect(sent("chat")).toHaveLength(1);
	});

	it("marks only the rejected chat as failed and keeps another pending action intact", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => {
			result.current.sendChat("첫 메시지");
			result.current.sendChat("두 번째 메시지");
			result.current.startDraw();
		});
		const chats = sent("chat");
		receive({
			type: "error",
			code: "CHAT_RATE_LIMIT",
			message: "메시지를 조금 천천히 보내 주세요.",
			requestId: chats[1].id,
		});
		expect(
			result.current.localChatMessages.map((entry) => entry.delivery),
		).toEqual(["sending", "failed"]);
		expect(result.current.localChatMessages[1].reason).toContain("천천히");
		expect(result.current.startPending).toBe(true);
		act(() => result.current.dismissLocalChat(chats[0].id));
		expect(result.current.localChatMessages).toHaveLength(2);
		act(() => result.current.dismissLocalChat(chats[1].id));
		expect(result.current.localChatMessages.map((entry) => entry.id)).toEqual([
			chats[0].id,
		]);
	});

	it("keeps timed-out text visibly unconfirmed and replaces it with a late authoritative acknowledgement", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => result.current.sendChat("김밥 어때요?"));
		const id = sent("chat")[0].id;
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.localChatMessages[0]).toMatchObject({
			id,
			delivery: "unconfirmed",
			text: "김밥 어때요?",
		});
		publish(acknowledgeChat(id));
		expect(result.current.localChatMessages).toEqual([]);
		expect(result.current.snapshot?.messages.map((entry) => entry.id)).toEqual([
			id,
		]);
		expect(sent("chat")).toHaveLength(1);
	});

	it("does not replay unconfirmed chat on reconnect and accepts its acknowledgement after rejoining", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => result.current.sendChat("김밥 어때요?"));
		const id = sent("chat")[0].id;
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		expect(result.current.localChatMessages[0].delivery).toBe("unconfirmed");
		joined(true, acknowledgeChat(id));
		expect(result.current.localChatMessages).toEqual([]);
		expect(sent("chat")).toHaveLength(1);
	});

	it("does not create local messages when transport fails, and clears room-scoped work on navigation and expiry", () => {
		const { result, rerender } = renderHook(({ id }) => useLunchRoom(id), {
			initialProps: { id: roomId },
		});
		joined();
		socket().send.mockReturnValueOnce(false);
		act(() => expect(result.current.sendChat("보내지 못함")).toBe(false));
		expect(result.current.localChatMessages).toEqual([]);
		act(() => result.current.sendChat("이전 방 메시지"));
		expect(result.current.localChatMessages).toHaveLength(1);
		const nextId = "00000000-0000-0000-0000-000000000001";
		rerender({ id: nextId });
		expect(result.current.localChatMessages).toEqual([]);
		joined(true, snapshot({ roomId: nextId, expiresAt: Date.now() + 1000 }));
		act(() => result.current.sendChat("만료 전 메시지"));
		expect(result.current.localChatMessages).toHaveLength(1);
		act(() => vi.advanceTimersByTime(1000));
		expect(result.current.connection).toBe("closed");
		expect(result.current.localChatMessages).toEqual([]);
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.localChatMessages).toEqual([]);
	});

	it("bounds unacknowledged local messages and does not send more while the limit is reached", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => {
			for (let index = 0; index < 20; index++)
				expect(result.current.sendChat(`메시지 ${index}`)).toBe(true);
			expect(result.current.sendChat("한도 초과")).toBe(false);
		});
		expect(result.current.localChatMessages).toHaveLength(20);
		expect(sent("chat")).toHaveLength(20);
		expect(result.current.error).toContain("미확인 메시지가 많습니다");
		const hiddenId = sent("chat")[0].id;
		act(() => vi.advanceTimersByTime(15000));
		act(() => result.current.dismissLocalChat(hiddenId));
		expect(result.current.localChatMessages).toHaveLength(19);
		act(() => expect(result.current.sendChat("이어서 보내기")).toBe(true));
		expect(sent("chat")).toHaveLength(21);
		publish(acknowledgeChat(hiddenId, "메시지 0"));
		expect(result.current.snapshot?.messages[0].id).toBe(hiddenId);
		expect(
			result.current.localChatMessages.some((entry) => entry.id === hiddenId),
		).toBe(false);
	});
});

describe("explicit lunch room admission", () => {
	it("renders the same initial loading state on the server and first client commit without consuming admission during render", () => {
		mocks.consumeEntry.mockReturnValueOnce("새방장");
		type AdmissionState = {
			entryLoading: boolean;
			entryPending: boolean;
			waitingForEntry: boolean;
		};
		let serverState: AdmissionState | undefined;
		function ServerAdmission() {
			const room = useLunchRoom(roomId, false, { requireEntry: true });
			serverState = {
				entryLoading: room.entryLoading,
				entryPending: room.entryPending,
				waitingForEntry: room.waitingForEntry,
			};
			return (
				<output>{room.entryLoading ? "입장 준비 중" : "닉네임 입력"}</output>
			);
		}
		try {
			vi.stubGlobal("window", undefined);
			expect(renderToString(<ServerAdmission />)).toContain("입장 준비 중");
		} finally {
			vi.unstubAllGlobals();
		}
		expect(serverState).toEqual({
			entryLoading: true,
			entryPending: false,
			waitingForEntry: true,
		});
		expect(mocks.consumeEntry).not.toHaveBeenCalled();
		expect(mocks.readName).not.toHaveBeenCalled();
		expect(mocks.readHost).not.toHaveBeenCalled();
		expect(mocks.sockets).toHaveLength(0);
		const commits: AdmissionState[] = [];
		const { result } = renderHook(() => {
			const room = useLunchRoom(roomId, false, { requireEntry: true });
			useLayoutEffect(() => {
				commits.push({
					entryLoading: room.entryLoading,
					entryPending: room.entryPending,
					waitingForEntry: room.waitingForEntry,
				});
			});
			return room;
		});
		expect(commits[0]).toEqual(serverState);
		expect(commits.every((state) => state.entryLoading)).toBe(true);
		expect(result.current.entryPending).toBe(true);
	});

	it("keeps creator admission loading through connection and unrelated snapshots until its participant is confirmed", () => {
		mocks.consumeEntry.mockReturnValueOnce("새방장");
		const loadingCommits: boolean[] = [];
		const { result } = renderHook(() => {
			const room = useLunchRoom(roomId, false, { requireEntry: true });
			useLayoutEffect(() => {
				loadingCommits.push(room.entryLoading);
			});
			return room;
		});
		expect(result.current.entryLoading).toBe(true);
		opened();
		expect(result.current.self).toBeNull();
		receive({ type: "snapshot", snapshot: snapshot(), serverTime: Date.now() });
		expect(result.current.entryLoading).toBe(true);
		expect(loadingCommits.every(Boolean)).toBe(true);
		expect(mocks.saveName).not.toHaveBeenCalled();
		receive({
			type: "snapshot",
			snapshot: snapshot({
				participants: [{ id: "host-client", name: "새방장", isHost: true }],
			}),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		expect(result.current.entryLoading).toBe(false);
		expect(result.current.waitingForEntry).toBe(false);
		expect(result.current.entryPending).toBe(false);
		expect(result.current.self?.isHost).toBe(true);
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		expect(result.current.connection).toBe("reconnecting");
		expect(result.current.entryLoading).toBe(false);
	});

	it("keeps a one-use creation intent active through StrictMode effect replay", () => {
		mocks.consumeEntry.mockReturnValueOnce("Strict 방장");
		const loadingCommits: boolean[] = [];
		const { result } = renderHook(
			() => {
				const room = useLunchRoom(roomId, false, { requireEntry: true });
				useLayoutEffect(() => {
					loadingCommits.push(room.entryLoading);
				});
				return room;
			},
			{ wrapper: StrictMode },
		);
		expect(result.current.entryLoading).toBe(true);
		expect(result.current.entryPending).toBe(true);
		expect(loadingCommits.every(Boolean)).toBe(true);
		opened();
		expect(sent("join")[0]).toEqual({
			type: "join",
			chatProtocol: "delta-v1",
			name: "Strict 방장",
			updateName: true,
			hostToken: token,
		});
		receive({
			type: "snapshot",
			snapshot: snapshot({
				participants: [
					{ id: "host-client", name: "Strict 방장", isHost: true },
				],
			}),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		expect(result.current.entryLoading).toBe(false);
		expect(result.current.waitingForEntry).toBe(false);
	});

	it.each([
		"NICKNAME_TAKEN",
		"INVALID_NICKNAME",
	])("returns rejected automatic admission (%s) to manual entry and allows an explicit retry", (code) => {
		mocks.consumeEntry.mockReturnValueOnce("새방장");
		const { result } = renderHook(() =>
			useLunchRoom(roomId, false, { requireEntry: true }),
		);
		opened();
		receive({ type: "error", code, message: "다른 닉네임을 입력해 주세요." });
		expect(result.current.entryLoading).toBe(false);
		expect(result.current.waitingForEntry).toBe(true);
		expect(result.current.entryPending).toBe(false);
		expect(result.current.error).toBe("다른 닉네임을 입력해 주세요.");
		expect(result.current.self).toBeNull();
		expect(mocks.saveName).not.toHaveBeenCalled();
		const rejectedSocket = socket();
		expect(rejectedSocket.close).toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(60000));
		expect(socket()).toBe(rejectedSocket);
		expect(rejectedSocket.reconnect).not.toHaveBeenCalled();
		act(() => expect(result.current.enter("다른 방장")).toBe(true));
		expect(result.current.entryLoading).toBe(false);
		expect(result.current.entryPending).toBe(true);
		opened();
		expect(sent("join")[0]).toEqual({
			type: "join",
			chatProtocol: "delta-v1",
			name: "다른 방장",
			updateName: true,
			hostToken: token,
		});
	});

	it("clears pending automatic admission when switching rooms and does not reuse it on return", () => {
		const otherId = "12345678-abcd-4abc-8abc-123456789012";
		mocks.consumeEntry.mockReturnValueOnce("새방장");
		const commits: { roomId: string; entryLoading: boolean }[] = [];
		const view = renderHook(
			({ id }) => {
				const room = useLunchRoom(id, false, { requireEntry: true });
				useLayoutEffect(() => {
					commits.push({ roomId: id, entryLoading: room.entryLoading });
				});
				return room;
			},
			{ initialProps: { id: roomId } },
		);
		expect(view.result.current.entryLoading).toBe(true);
		const creatorSocket = socket();
		view.rerender({ id: otherId });
		expect(
			commits.find((state) => state.roomId === otherId)?.entryLoading,
		).toBe(true);
		expect(view.result.current.entryLoading).toBe(false);
		expect(view.result.current.waitingForEntry).toBe(true);
		expect(view.result.current.entryPending).toBe(false);
		expect(creatorSocket.close).toHaveBeenCalled();
		const connectionCount = mocks.sockets.length;
		act(() => expect(view.result.current.enter("다른 방 참가자")).toBe(true));
		expect(view.result.current.entryLoading).toBe(false);
		expect(view.result.current.entryPending).toBe(true);
		expect(mocks.sockets).toHaveLength(connectionCount + 1);
		view.rerender({ id: roomId });
		expect(view.result.current.entryLoading).toBe(false);
		expect(view.result.current.waitingForEntry).toBe(true);
		expect(view.result.current.entryPending).toBe(false);
		expect(mocks.sockets).toHaveLength(connectionCount + 1);
	});

	it("does not connect or save a nickname before explicit entry, including a saved host through an old invite", () => {
		const { result } = renderHook(() =>
			useLunchRoom(roomId, true, { requireEntry: true }),
		);
		expect(result.current.waitingForEntry).toBe(true);
		expect(result.current.entryPending).toBe(false);
		expect(result.current.entryLoading).toBe(false);
		act(() => vi.advanceTimersByTime(60000));
		expect(mocks.sockets).toHaveLength(0);
		expect(mocks.readHost).not.toHaveBeenCalled();
		expect(mocks.saveName).not.toHaveBeenCalled();
		act(() => expect(result.current.enter("  Ｅｒｉｃ  ")).toBe(true));
		expect(result.current.entryPending).toBe(true);
		expect(result.current.entryLoading).toBe(false);
		opened();
		expect(sent("join")).toEqual([
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "Eric",
				updateName: true,
				hostToken: token,
			},
		]);
		expect(result.current.self).toBeNull();
		expect(mocks.saveName).not.toHaveBeenCalled();
		receive({
			type: "snapshot",
			snapshot: snapshot({
				participants: [{ id: "host-client", name: "Eric", isHost: true }],
			}),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		expect(result.current.waitingForEntry).toBe(false);
		expect(result.current.entryPending).toBe(false);
		expect(result.current.self?.isHost).toBe(true);
		expect(mocks.saveName).toHaveBeenLastCalledWith("Eric");
	});

	it("returns a refused nickname to entry without saving it and retries as the same private guest", () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() =>
			useLunchRoom(roomId, false, { requireEntry: true }),
		);
		act(() => expect(result.current.enter("민수")).toBe(true));
		opened();
		const rejected = socket();
		receive({
			type: "error",
			code: "NICKNAME_TAKEN",
			message: "이미 사용 중인 닉네임입니다.",
		});
		expect(result.current.waitingForEntry).toBe(true);
		expect(result.current.entryPending).toBe(false);
		expect(result.current.self).toBeNull();
		expect(result.current.error).toContain("이미 사용 중");
		expect(rejected.close).toHaveBeenCalled();
		expect(mocks.saveName).not.toHaveBeenCalled();
		act(() => vi.advanceTimersByTime(60000));
		expect(rejected.reconnect).not.toHaveBeenCalled();
		act(() => expect(result.current.enter("지수")).toBe(true));
		opened();
		expect(sent("join")).toEqual([
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "지수",
				updateName: true,
				guestToken,
			},
		]);
		joined(
			false,
			snapshot({
				participants: [{ id: "guest-client", name: "지수", isHost: false }],
			}),
		);
		expect(result.current.waitingForEntry).toBe(false);
		expect(result.current.nickname).toBe("지수");
	});

	it("keeps an admitted room on reconnect and does not rename the participant again", () => {
		const { result } = renderHook(() =>
			useLunchRoom(roomId, false, { requireEntry: true }),
		);
		act(() => result.current.enter("민수"));
		joined();
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		expect(result.current.waitingForEntry).toBe(false);
		expect(result.current.connection).toBe("reconnecting");
		opened();
		expect(sent("join").at(-1)).toEqual({
			type: "join",
			chatProtocol: "delta-v1",
			name: "민수",
			hostToken: token,
		});
	});

	it("keeps the confirmed nickname and stored value after a rename collision", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => result.current.rename("점심동료"));
		receive({
			type: "error",
			code: "NICKNAME_TAKEN",
			message: "이미 사용 중인 닉네임입니다.",
		});
		expect(result.current.nickname).toBe("민수");
		expect(result.current.connection).toBe("connected");
		expect(mocks.saveName).toHaveBeenLastCalledWith("민수");
		expect(result.current.error).toContain("이미 사용 중");
	});

	it("uses a just-submitted creation intent once without consulting an invite URL", () => {
		mocks.consumeEntry.mockReturnValueOnce("새방장");
		const view = renderHook(() =>
			useLunchRoom(roomId, false, { requireEntry: true }),
		);
		opened();
		expect(sent("join")[0]).toMatchObject({
			name: "새방장",
			updateName: true,
			hostToken: token,
		});
		view.unmount();
		const count = mocks.sockets.length;
		const again = renderHook(() =>
			useLunchRoom(roomId, false, { requireEntry: true }),
		);
		expect(again.result.current.waitingForEntry).toBe(true);
		expect(mocks.sockets).toHaveLength(count);
	});

	it("requires new entry when navigating away to another room and back", () => {
		const otherId = "12345678-abcd-4abc-8abc-123456789012";
		const view = renderHook(
			({ id }) => useLunchRoom(id, false, { requireEntry: true }),
			{ initialProps: { id: roomId } },
		);
		act(() => view.result.current.enter("민수"));
		joined();
		view.rerender({ id: otherId });
		expect(view.result.current.waitingForEntry).toBe(true);
		const count = mocks.sockets.length;
		view.rerender({ id: roomId });
		expect(view.result.current.waitingForEntry).toBe(true);
		expect(mocks.sockets).toHaveLength(count);
	});

	it("rejects empty and overlong entry names before creating a connection", () => {
		const { result } = renderHook(() =>
			useLunchRoom(roomId, false, { requireEntry: true }),
		);
		for (const name of [" ", "가".repeat(13), "\u200b"])
			act(() => expect(result.current.enter(name)).toBe(false));
		expect(mocks.sockets).toHaveLength(0);
		expect(result.current.error).toContain("1~12자");
	});
});

describe("lunch room connection lifecycle", () => {
	it("clamps a legacy saved name for joining and rejects new overlong renames before sending", () => {
		mocks.readName.mockReturnValue(`${"가".repeat(11)}😀옛이름`);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(
			true,
			snapshot({
				participants: [
					{ id: "host-client", name: "가".repeat(20), isHost: true },
				],
			}),
		);
		expect(sent("join")[0].name).toBe("가".repeat(11));
		expect(result.current.nickname).toBe("가".repeat(12));
		act(() => expect(result.current.rename("가".repeat(13))).toBe(false));
		expect(result.current.error).toContain("1~12자");
		expect(sent("join")).toHaveLength(1);
		act(() => expect(result.current.rename("😀".repeat(6))).toBe(true));
		expect(sent("join").at(-1)?.name).toBe("😀".repeat(6));
	});
	it("automatically joins using a private credential and renames on the same connection", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		expect(socket().options).toMatchObject({
			host: window.location.host,
			party: "lunch-rooms",
			room: roomId,
			maxEnqueuedMessages: 0,
		});
		expect(socket().options).not.toHaveProperty("query");
		expect(mocks.readGuestToken).not.toHaveBeenCalled();
		opened();
		expect(sent("join")).toEqual([
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "민수",
				hostToken: token,
			},
		]);
		expect(sent("ping")).toHaveLength(1);
		expect(result.current.connection).toBe("connecting");
		receive({
			type: "snapshot",
			snapshot: snapshot(),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		expect(result.current.connection).toBe("connected");
		expect(result.current.self).toEqual({ id: "host-client", isHost: true });
		act(() => {
			expect(result.current.rename(" 새 이름 ")).toBe(true);
		});
		expect(mocks.sockets).toHaveLength(1);
		expect(sent("join").at(-1)).toEqual({
			type: "join",
			chatProtocol: "delta-v1",
			name: "새 이름",
			updateName: true,
			hostToken: token,
		});
		expect(result.current.nickname).toBe("민수");
		expect(mocks.saveName).toHaveBeenLastCalledWith("민수");
		receive({
			type: "snapshot",
			snapshot: snapshot({
				participants: [{ id: "host-client", name: "새 이름", isHost: true }],
			}),
			serverTime: Date.now(),
		});
		expect(result.current.nickname).toBe("새 이름");
		expect(JSON.stringify(result.current)).not.toContain(token);
	});

	it("restores the saved host proof through legacy invitations after leaving and remounting", () => {
		const first = renderHook(() => useLunchRoom(roomId));
		joined(true);
		first.unmount();
		const restored = renderHook(() => useLunchRoom(roomId, true));
		opened();
		expect(sent("join")).toEqual([
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "민수",
				hostToken: token,
			},
		]);
		expect(restored.result.current.self).toBeNull();
		expect(restored.result.current.connection).toBe("connecting");
		receive({
			type: "snapshot",
			snapshot: snapshot(),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		expect(restored.result.current.self).toEqual({
			id: "host-client",
			isHost: true,
		});
		act(() => expect(restored.result.current.startDraw()).toBe(true));
		expect(sent("start")).toHaveLength(1);
	});

	it("keeps a browser without a host proof as a guest through a legacy invitation", () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId, true));
		joined(false);
		expect(mocks.readHost).toHaveBeenCalledWith(roomId);
		expect(sent("join")).toEqual([
			{ type: "join", chatProtocol: "delta-v1", name: "민수", guestToken },
		]);
		expect(mocks.readGuestToken).toHaveBeenCalledExactlyOnceWith(roomId);
		expect(result.current.self?.isHost).toBe(false);
		act(() => {
			expect(result.current.startDraw()).toBe(false);
			expect(
				result.current.updateCandidates(
					sampleLunchPlaces.slice(0, 2).map((place) => place.id),
				),
			).toBe(false);
		});
		expect(sent("start")).toEqual([]);
		expect(sent("candidates")).toEqual([]);
	});

	it("waits for the server to confirm a saved host proof before enabling host actions", () => {
		const { result } = renderHook(() => useLunchRoom(roomId, true));
		opened();
		expect(sent("join")[0]).toMatchObject({ hostToken: token });
		act(() => {
			expect(result.current.startDraw()).toBe(false);
			expect(
				result.current.updateCandidates(
					sampleLunchPlaces.slice(0, 2).map((place) => place.id),
				),
			).toBe(false);
		});
		receive({
			type: "error",
			code: "HOST_AUTH_FAILED",
			message: "방장 인증을 확인해 주세요.",
		});
		expect(result.current.connection).toBe("closed");
		expect(result.current.self).toBeNull();
		expect(sent("start")).toEqual([]);
		expect(sent("candidates")).toEqual([]);
	});

	it("keeps the same private guest identity through nickname changes and reconnecting", () => {
		mocks.readHost.mockReturnValue(undefined);
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(false);
		expect(sent("join")).toEqual([
			{ type: "join", chatProtocol: "delta-v1", name: "민수", guestToken },
		]);
		expect(socket().options).not.toHaveProperty("query");
		expect(JSON.stringify(socket().options)).not.toContain(guestToken);
		act(() => {
			expect(result.current.rename(" 새 손님 ")).toBe(true);
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		joined(false);
		expect(mocks.readGuestToken).toHaveBeenCalledExactlyOnceWith(roomId);
		expect(sent("join")).toEqual([
			{ type: "join", chatProtocol: "delta-v1", name: "민수", guestToken },
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "새 손님",
				guestToken,
				updateName: true,
			},
			{ type: "join", chatProtocol: "delta-v1", name: "민수", guestToken },
		]);
		expect(JSON.stringify(result.current)).not.toContain(guestToken);
	});

	it("restores the server-confirmed name and follows later renames without sending a join loop", () => {
		mocks.readHost.mockReturnValue(undefined);
		mocks.readName.mockReturnValue("다른 방에서 쓴 이름");
		const { result } = renderHook(() => useLunchRoom(roomId));
		const current = snapshot({
			participants: [
				{ id: "guest-client", name: "이 방의 저장 이름", isHost: false },
			],
		});
		joined(false, current);
		expect(sent("join")).toEqual([
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "다른 방에서 쓴 이름",
				guestToken,
			},
		]);
		expect(result.current.nickname).toBe("이 방의 저장 이름");
		expect(mocks.saveName).toHaveBeenLastCalledWith("이 방의 저장 이름");
		const renamed = snapshot({
			participants: [
				{ id: "guest-client", name: "서버에서 바꾼 이름", isHost: false },
			],
		});
		receive({ type: "snapshot", snapshot: renamed, serverTime: Date.now() });
		expect(result.current.nickname).toBe("서버에서 바꾼 이름");
		expect(mocks.saveName).toHaveBeenLastCalledWith("서버에서 바꾼 이름");
		const writes = mocks.saveName.mock.calls.length;
		receive({ type: "snapshot", snapshot: renamed, serverTime: Date.now() });
		expect(mocks.saveName).toHaveBeenCalledTimes(writes);
		expect(sent("join")).toHaveLength(1);
		act(() => expect(result.current.rename(" 직접 고른 이름 ")).toBe(true));
		expect(sent("join").at(-1)).toEqual({
			type: "join",
			chatProtocol: "delta-v1",
			name: "직접 고른 이름",
			updateName: true,
			guestToken,
		});
	});

	it("does not queue or replay explicit start/chat actions when reconnecting", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		act(() => {
			expect(result.current.startDraw()).toBe(true);
			expect(result.current.startDraw()).toBe(false);
			expect(result.current.sendChat("김밥 어때요?")).toBe(true);
		});
		expect(sent("start")).toHaveLength(1);
		expect(sent("chat")).toHaveLength(1);
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		expect(result.current.connection).toBe("reconnecting");
		expect(result.current.self).toBeNull();
		act(() => {
			expect(result.current.sendChat("이 메시지는 보내지지 않음")).toBe(false);
		});
		joined();
		expect(sent("join")).toHaveLength(2);
		expect(sent("start")).toHaveLength(1);
		expect(sent("chat")).toHaveLength(1);
		expect(result.current.startPending).toBe(false);
	});

	it("corrects the clock from a matching ping midpoint and ignores unsolicited pongs", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		opened();
		const clientTime = sent("ping")[0].clientTime as number;
		receive({
			type: "snapshot",
			snapshot: snapshot(),
			serverTime: Date.now() + 500,
			self: { id: "host-client", isHost: true },
		});
		act(() => vi.advanceTimersByTime(100));
		receive({ type: "pong", clientTime, serverTime: clientTime + 50 + 1000 });
		expect(result.current.clockOffset).toBe(1000);
		expect(result.current.serverNow()).toBe(Date.now() + 1000);
		receive({
			type: "pong",
			clientTime: Date.now() - 1,
			serverTime: Date.now() + 999999,
		});
		expect(result.current.clockOffset).toBe(1000);
	});

	it("uses the fresh server clock after reconnecting before deciding that a valid room expired", () => {
		const initialTime = Date.now();
		const current = snapshot({ expiresAt: initialTime + 10 * 60 * 1000 });
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, current);
		receive({
			type: "pong",
			clientTime: sent("ping")[0].clientTime,
			serverTime: initialTime,
		});
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
			vi.setSystemTime(initialTime + 15 * 60 * 1000);
		});
		opened();
		receive({
			type: "snapshot",
			snapshot: current,
			serverTime: initialTime + 60 * 1000,
			self: { id: "host-client", isHost: true },
		});
		expect(result.current.connection).toBe("connected");
		expect(result.current.serverNow()).toBe(initialTime + 60 * 1000);
		expect(result.current.error).toBe("");
		expect(socket().close).not.toHaveBeenCalled();
		interact("keydown");
		expect(sent("activity")).toHaveLength(1);
	});

	it("keeps the last validated snapshot when malformed or oversized data arrives", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined();
		const previous = result.current.snapshot;
		receive("{".repeat(512 * 1024 + 1));
		expect(result.current.snapshot).toBe(previous);
		expect(result.current.error).toContain("확인하지 못했습니다");
		receive({
			type: "snapshot",
			snapshot: snapshot({ roomId: "00000000-0000-0000-0000-000000000000" }),
			serverTime: Date.now(),
		});
		expect(result.current.snapshot).toBe(previous);
	});

	it.each([
		"ROOM_NOT_FOUND",
		"ROOM_EXPIRED",
		"ROOM_FULL",
		"HOST_AUTH_FAILED",
	])("stops reconnecting for terminal %s errors", (code) => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		opened();
		receive({ type: "error", code, message: "방에 참가할 수 없습니다." });
		expect(result.current.connection).toBe("closed");
		expect(socket().close).toHaveBeenCalledTimes(1);
		act(() => {
			result.current.reconnect();
			expect(result.current.sendChat("보내지 않음")).toBe(false);
		});
		expect(socket().reconnect).not.toHaveBeenCalled();
		expect(result.current.error).toBe("방에 참가할 수 없습니다.");
	});

	it("rejects blank messages and expires the room without any local redraw", () => {
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ expiresAt: Date.now() + 1000 }));
		act(() => {
			expect(result.current.sendChat("   ")).toBe(false);
			expect(result.current.sendChat("가".repeat(501))).toBe(false);
		});
		expect(sent("chat")).toEqual([]);
		act(() => vi.advanceTimersByTime(1000));
		expect(result.current.connection).toBe("closed");
		expect(sent("start")).toEqual([]);
	});

	it("closes the connection and removes timers/listeners when unmounted", () => {
		const removeListener = vi.spyOn(window, "removeEventListener");
		const view = renderHook(() => useLunchRoom(roomId));
		joined();
		interact("keydown");
		interact("pointerdown");
		view.unmount();
		expect(socket().close).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
		const calls = socket().send.mock.calls.length;
		for (const type of [
			"keydown",
			"pointerdown",
			"pointermove",
			"wheel",
			"touchmove",
			"scroll",
		])
			expect(
				removeListener.mock.calls.some(([eventType]) => eventType === type),
			).toBe(true);
		interact("keydown");
		interact("scroll");
		opened();
		receive({ type: "snapshot", snapshot: snapshot(), serverTime: Date.now() });
		expect(socket().send).toHaveBeenCalledTimes(calls);
	});
});

describe("actual user activity and server presence", () => {
	it("sends leading activity immediately and the final burst within15seconds without an endless timer", () => {
		renderHook(() => useLunchRoom(roomId));
		joined();
		expect(sent("activity")).toEqual([]);
		interact("pointermove");
		expect(sent("activity")).toEqual([{ type: "activity" }]);
		act(() => vi.advanceTimersByTime(5000));
		interact("pointerdown");
		interact("pointermove");
		interact("wheel");
		act(() => vi.advanceTimersByTime(9999));
		expect(sent("activity")).toHaveLength(1);
		act(() => vi.advanceTimersByTime(1));
		expect(sent("activity")).toHaveLength(2);
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("activity")).toHaveLength(2);
		interact("touchmove");
		expect(sent("activity")).toHaveLength(3);
	});

	it("does not treat heartbeat or hidden/visible transitions as activity during five idle minutes", () => {
		renderHook(() => useLunchRoom(roomId));
		joined();
		const visibility = vi.spyOn(document, "visibilityState", "get");
		visibility.mockReturnValue("hidden");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		act(() => vi.advanceTimersByTime(5 * 60 * 1000));
		expect(sent("ping").length).toBeGreaterThan(10);
		expect(sent("activity")).toEqual([]);
		visibility.mockReturnValue("visible");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		expect(sent("activity")).toEqual([]);
	});

	it.each([
		60000, -60000,
	])("discards stale trailing activity after a %ims clock jump and accepts fresh input", (jump) => {
		renderHook(() => useLunchRoom(roomId));
		joined();
		interact("keydown");
		act(() => vi.advanceTimersByTime(1000));
		interact("pointerdown");
		act(() => {
			vi.setSystemTime(Date.now() + jump);
			vi.advanceTimersByTime(14000);
		});
		expect(sent("activity")).toHaveLength(1);
		interact("scroll");
		expect(sent("activity")).toHaveLength(1);
		interact("keydown");
		expect(sent("activity")).toHaveLength(2);
	});

	it("ignores automatic scrolling but follows scrolling caused by recent real input", () => {
		renderHook(() => useLunchRoom(roomId));
		joined();
		interact("scroll");
		expect(sent("activity")).toEqual([]);
		interact("wheel");
		act(() => vi.advanceTimersByTime(1000));
		interact("scroll");
		act(() => vi.advanceTimersByTime(14000));
		expect(sent("activity")).toHaveLength(2);
		interact("scroll");
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("activity")).toHaveLength(2);
	});

	it("drops pending activity when hidden and waits for new input after becoming visible", () => {
		renderHook(() => useLunchRoom(roomId));
		joined();
		interact("keydown");
		interact("pointerdown");
		const visibility = vi.spyOn(document, "visibilityState", "get");
		visibility.mockReturnValue("hidden");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		interact("keydown");
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("activity")).toHaveLength(1);
		visibility.mockReturnValue("visible");
		act(() => document.dispatchEvent(new Event("visibilitychange")));
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("activity")).toHaveLength(1);
		interact("pointerdown");
		expect(sent("activity")).toHaveLength(2);
	});

	it("ignores input before joining and never replays pending activity across a disconnect", () => {
		renderHook(() => useLunchRoom(roomId));
		opened();
		interact("pointerdown");
		expect(sent("activity")).toEqual([]);
		receive({
			type: "snapshot",
			snapshot: snapshot(),
			serverTime: Date.now(),
			self: { id: "host-client", isHost: true },
		});
		interact("keydown");
		interact("pointerdown");
		act(() => {
			socket().readyState = 3;
			socket().dispatchEvent(new Event("close"));
		});
		act(() => vi.advanceTimersByTime(15000));
		interact("keydown");
		expect(sent("activity")).toHaveLength(1);
		joined();
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("activity")).toHaveLength(1);
		interact("pointerdown");
		expect(sent("activity")).toHaveLength(2);
	});

	it("replaces room-specific guest identity and activity timers when switching rooms", () => {
		const nextId = "bd0177a8-e1bc-4c2c-8ad9-d3fa3afc43f1";
		const nextToken = "c".repeat(64);
		mocks.readHost.mockReturnValue(undefined);
		mocks.readGuestToken.mockImplementation((id) =>
			id === roomId ? guestToken : nextToken,
		);
		const view = renderHook(({ id }) => useLunchRoom(id), {
			initialProps: { id: roomId },
		});
		joined(false);
		interact("keydown");
		interact("pointerdown");
		const previous = socket();
		view.rerender({ id: nextId });
		expect(previous.close).toHaveBeenCalledTimes(1);
		joined(false, snapshot({ roomId: nextId }));
		expect(mocks.readGuestToken.mock.calls).toEqual([[roomId], [nextId]]);
		expect(sent("join")).toEqual([
			{
				type: "join",
				chatProtocol: "delta-v1",
				name: "민수",
				guestToken: nextToken,
			},
		]);
		act(() => vi.advanceTimersByTime(15000));
		expect(sent("activity")).toEqual([]);
		interact("keydown");
		expect(sent("activity")).toHaveLength(1);
		expect(
			previous.send.mock.calls
				.map(([raw]) => JSON.parse(raw))
				.filter((message) => message.type === "activity"),
		).toHaveLength(1);
	});

	it("preserves server online, away and offline members instead of deriving presence from heartbeat", () => {
		const lastActiveAt = Date.now() - 5 * 60 * 1000;
		const members = [
			{
				id: "host-client",
				name: "민수",
				isHost: true,
				status: "away" as const,
				lastActiveAt,
				lastSeenAt: Date.now(),
			},
			{
				id: "guest-online",
				name: "손님",
				isHost: false,
				status: "online" as const,
				lastActiveAt: Date.now(),
				lastSeenAt: Date.now(),
			},
			{
				id: "guest-offline",
				name: "나간 손님",
				isHost: false,
				status: "offline" as const,
				lastActiveAt,
				lastSeenAt: Date.now() - 1000,
			},
		];
		const { result } = renderHook(() => useLunchRoom(roomId));
		joined(true, snapshot({ members }));
		expect(result.current.snapshot?.members).toEqual(members);
		act(() => vi.advanceTimersByTime(15000));
		expect(result.current.snapshot?.members?.[0].status).toBe("away");
		expect(result.current.snapshot?.participants).toHaveLength(1);
		expect(sent("activity")).toEqual([]);
	});
});
