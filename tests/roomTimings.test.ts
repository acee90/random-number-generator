// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import { sampleLunchPlaces } from "../src/lib/lunch";
import type { RoomSnapshot } from "../src/lib/lunchRoom";

interface TimingSocket extends EventTarget {
	readyState: number;
	send: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	reconnect: ReturnType<typeof vi.fn>;
}
const socketMocks = vi.hoisted(() => ({ sockets: [] as TimingSocket[] }));
vi.mock("partysocket", () => ({
	default: class extends EventTarget {
		readyState = 0;
		send = vi.fn(() => this.readyState === 1);
		close = vi.fn(() => {
			this.readyState = 3;
			this.dispatchEvent(new Event("close"));
		});
		reconnect = vi.fn();
		constructor() {
			super();
			socketMocks.sockets.push(this);
		}
	},
}));

const initialPath = `${window.location.pathname}${window.location.search}`;
let info: MockInstance<typeof console.info>;
function payload(call: unknown[]): {
	stage: string;
	durationMs: number;
	visibility: string;
} {
	return JSON.parse(String(call[0]).slice("[room timing] ".length));
}
beforeEach(() => {
	vi.resetModules();
	socketMocks.sockets.length = 0;
	window.history.replaceState(null, "", "/");
	info = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	window.history.replaceState(null, "", initialPath);
});

describe("admission acknowledgement to React commit timings", () => {
	const roomId = "9b8c4944-5841-462d-b5a4-a701044be6b2";
	function acknowledgement() {
		const snapshot: RoomSnapshot = {
			roomId,
			title: "시간 확인",
			createdAt: Date.now() - 1000,
			expiresAt: Date.now() - 1000 + 86400000,
			listVersion: 1,
			candidates: [...sampleLunchPlaces.slice(0, 2)],
			participants: [{ id: "timed-client", name: "시간 확인", isHost: false }],
			messages: [],
			draw: null,
			history: [],
			status: "waiting",
		};
		return new MessageEvent("message", {
			data: JSON.stringify({
				type: "snapshot",
				snapshot,
				serverTime: Date.now(),
				self: { id: "timed-client", isHost: false },
			}),
		});
	}
	function stages() {
		return info.mock.calls.map((call) => payload(call).stage);
	}
	function open(socket: TimingSocket) {
		act(() => {
			socket.readyState = 1;
			socket.dispatchEvent(new Event("open"));
		});
	}

	it("logs one connected commit after acknowledgement, repeats on reconnect but not on repeated self snapshots", async () => {
		await loadEnabled();
		const { useLunchRoom } = await import("../src/hooks/useLunchRoom");
		vi.useFakeTimers({
			toFake: [
				"Date",
				"setTimeout",
				"clearTimeout",
				"setInterval",
				"clearInterval",
			],
		});
		const { result } = renderHook(() => useLunchRoom(roomId));
		const socket = socketMocks.sockets[0];
		open(socket);
		expect(stages()).toEqual(["socket_open"]);
		act(() => socket.dispatchEvent(acknowledgement()));
		expect(result.current.connection).toBe("connected");
		expect(stages()).toEqual(["socket_open", "join_ack", "room_commit"]);
		act(() => socket.dispatchEvent(acknowledgement()));
		expect(stages().filter((stage) => stage === "room_commit")).toHaveLength(1);
		act(() => {
			socket.readyState = 3;
			socket.dispatchEvent(new Event("close"));
			socket.readyState = 1;
			socket.dispatchEvent(new Event("open"));
			socket.dispatchEvent(acknowledgement());
		});
		expect(stages()).toEqual([
			"socket_open",
			"join_ack",
			"room_commit",
			"socket_open",
			"join_ack",
			"room_commit",
		]);
	});

	it("does not label a cancelled admission update as a committed room", async () => {
		await loadEnabled();
		const { useLunchRoom } = await import("../src/hooks/useLunchRoom");
		vi.useFakeTimers({
			toFake: [
				"Date",
				"setTimeout",
				"clearTimeout",
				"setInterval",
				"clearInterval",
			],
		});
		const { result } = renderHook(() => useLunchRoom(roomId));
		const socket = socketMocks.sockets[0];
		open(socket);
		act(() => {
			socket.dispatchEvent(acknowledgement());
			socket.readyState = 3;
			socket.dispatchEvent(new Event("close"));
		});
		expect(result.current.connection).toBe("reconnecting");
		expect(stages()).toContain("join_ack");
		expect(stages()).not.toContain("room_commit");
	});
});
async function loadEnabled() {
	window.history.replaceState(null, "", "/?debugRoom=1");
	return import("../src/lib/roomTimings");
}

describe("opt-in sanitized room timings", () => {
	it("does not read clocks or log anything when disabled", async () => {
		const { beginRoomTiming } = await import("../src/lib/roomTimings");
		const clock = vi.spyOn(performance, "now");
		const wall = vi.spyOn(Date, "now");
		const finish = beginRoomTiming("create_http");
		finish();
		finish();
		expect(clock).not.toHaveBeenCalled();
		expect(wall).not.toHaveBeenCalled();
		expect(info).not.toHaveBeenCalled();
	});

	it("keeps the initial opt-in across SPA navigation and finishes a stage only once", async () => {
		const { beginRoomTiming } = await loadEnabled();
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(100)
			.mockReturnValueOnce(112.34)
			.mockReturnValueOnce(120)
			.mockReturnValueOnce(125);
		window.history.replaceState(null, "", "/lunch-room/test-room");
		const finish = beginRoomTiming("create_http");
		finish();
		finish();
		beginRoomTiming("room_navigation")();
		expect(info.mock.calls).toEqual([
			[
				'[room timing] {"stage":"create_http","durationMs":12.3,"visibility":"visible"}',
			],
			[
				'[room timing] {"stage":"room_navigation","durationMs":5,"visibility":"visible"}',
			],
		]);
	});

	it("does not activate from a flag added after the initial page load", async () => {
		const { beginRoomTiming } = await import("../src/lib/roomTimings");
		window.history.replaceState(null, "", "/?debugRoom=1");
		beginRoomTiming("socket_open")();
		expect(info).not.toHaveBeenCalled();
	});

	it("logs only allowlisted stage names and three bounded fields without query data", async () => {
		window.history.replaceState(
			null,
			"",
			"/?debugRoom=1&nickname=private-name&hostToken=private-proof",
		);
		const { beginRoomTiming } = await import("../src/lib/roomTimings");
		vi.spyOn(performance, "now").mockReturnValue(10);
		for (const stage of [
			"create_http",
			"create_decode",
			"room_navigation",
			"nickname_check",
			"socket_open",
			"join_ack",
			"room_commit",
		] as const)
			beginRoomTiming(stage)();
		beginRoomTiming("private-name private-proof" as never)();
		expect(info).toHaveBeenCalledTimes(7);
		for (const call of info.mock.calls) {
			expect(call).toHaveLength(1);
			expect(typeof call[0]).toBe("string");
			expect(call[0]).toMatch(/^\[room timing\] \{/);
			const data = payload(call);
			expect(Object.keys(data)).toEqual(["stage", "durationMs", "visibility"]);
			expect(Number.isFinite(data.durationMs)).toBe(true);
			expect(data.durationMs).toBeGreaterThanOrEqual(0);
			expect(["visible", "hidden", "unknown"]).toContain(data.visibility);
		}
		const serialized = JSON.stringify(info.mock.calls);
		expect(serialized).not.toMatch(
			/private-name|private-proof|hostToken|nickname=|https?:/,
		);
	});

	it("falls back to wall-clock duration when performance is unavailable", async () => {
		const { beginRoomTiming } = await loadEnabled();
		vi.stubGlobal("performance", undefined);
		vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1250);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		beginRoomTiming("create_decode")();
		expect(info).toHaveBeenCalledWith(
			'[room timing] {"stage":"create_decode","durationMs":250,"visibility":"hidden"}',
		);
	});

	it("uses the matching wall-clock baseline when a performance clock fails mid-span", async () => {
		const { beginRoomTiming } = await loadEnabled();
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(10)
			.mockReturnValueOnce(Number.NaN);
		vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1400);
		beginRoomTiming("join_ack")();
		expect(payload(info.mock.calls[0]).durationMs).toBe(400);
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
	])("drops non-finite timing data: %s", async (value) => {
		const { beginRoomTiming } = await loadEnabled();
		vi.spyOn(performance, "now").mockReturnValue(value);
		vi.spyOn(Date, "now").mockReturnValue(value);
		expect(() => beginRoomTiming("socket_open")()).not.toThrow();
		expect(info).not.toHaveBeenCalled();
	});

	it("keeps durations nonnegative if a clock moves backwards", async () => {
		const { beginRoomTiming } = await loadEnabled();
		vi.spyOn(performance, "now")
			.mockReturnValueOnce(100)
			.mockReturnValueOnce(50);
		beginRoomTiming("nickname_check")();
		expect(payload(info.mock.calls[0]).durationMs).toBe(0);
	});

	it("does not let unavailable visibility or throwing consoles affect the flow", async () => {
		const { beginRoomTiming } = await loadEnabled();
		vi.spyOn(document, "visibilityState", "get").mockImplementation(() => {
			throw new Error("Unavailable");
		});
		beginRoomTiming("room_navigation")();
		expect(payload(info.mock.calls[0]).visibility).toBe("unknown");
		info.mockImplementation(() => {
			throw new Error("Console unavailable");
		});
		expect(() => beginRoomTiming("room_navigation")()).not.toThrow();
	});

	it("does nothing when imported outside a browser", async () => {
		vi.stubGlobal("window", undefined);
		const { beginRoomTiming } = await import("../src/lib/roomTimings");
		expect(() => beginRoomTiming("create_http")()).not.toThrow();
		expect(info).not.toHaveBeenCalled();
	});
});
