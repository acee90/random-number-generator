// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLunchRoom } from "../src/hooks/useLunchRoom";
import { sampleLunchPlaces } from "../src/lib/lunch";
import type { RoomSnapshot } from "../src/lib/lunchRoom";

interface TestSocket extends EventTarget {
	readyState: number;
	options: Record<string, unknown>;
	send: ReturnType<typeof vi.fn<(raw: string) => boolean>>;
	close: ReturnType<typeof vi.fn>;
	reconnect: ReturnType<typeof vi.fn>;
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

describe("explicit lunch room admission", () => {
	it("does not connect or save a nickname before explicit entry, including a saved host through an old invite", () => {
		const { result } = renderHook(() =>
			useLunchRoom(roomId, true, { requireEntry: true }),
		);
		expect(result.current.waitingForEntry).toBe(true);
		expect(result.current.entryPending).toBe(false);
		act(() => vi.advanceTimersByTime(60000));
		expect(mocks.sockets).toHaveLength(0);
		expect(mocks.readHost).not.toHaveBeenCalled();
		expect(mocks.saveName).not.toHaveBeenCalled();
		act(() => expect(result.current.enter("  Ｅｒｉｃ  ")).toBe(true));
		expect(result.current.entryPending).toBe(true);
		opened();
		expect(sent("join")).toEqual([
			{ type: "join", name: "Eric", updateName: true, hostToken: token },
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
			{ type: "join", name: "지수", updateName: true, guestToken },
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
			{ type: "join", name: "민수", hostToken: token },
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
			{ type: "join", name: "민수", hostToken: token },
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
		expect(sent("join")).toEqual([{ type: "join", name: "민수", guestToken }]);
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
		expect(sent("join")).toEqual([{ type: "join", name: "민수", guestToken }]);
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
			{ type: "join", name: "민수", guestToken },
			{ type: "join", name: "새 손님", guestToken, updateName: true },
			{ type: "join", name: "민수", guestToken },
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
			{ type: "join", name: "다른 방에서 쓴 이름", guestToken },
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
			{ type: "join", name: "민수", guestToken: nextToken },
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
