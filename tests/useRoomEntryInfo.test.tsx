// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRoomEntryInfo } from "../src/hooks/useRoomEntryInfo";

const roomId = "9b8c4944-5841-462d-b5a4-a701044be6b2";
const otherRoomId = "9b8c4944-5841-462d-b5a4-a701044be6b3";
const fetchMock = vi.fn<typeof fetch>();
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function flush() {
	await act(async () => {});
}
beforeEach(() => {
	vi.useFakeTimers();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("room entry info", () => {
	it("exposes explicit closure as a terminal entry state", async () => {
		fetchMock.mockResolvedValue(
			Response.json({ code: "ROOM_CLOSED" }, { status: 410 }),
		);
		const { result } = renderHook(() => useRoomEntryInfo({ roomId }));
		await flush();
		expect(result.current).toEqual({ title: null, status: "closed" });
	});

	it("reads only a title before nickname input using a cancellable no-store GET without proofs", async () => {
		fetchMock.mockResolvedValue(
			Response.json({ title: "  점심 모임  ", participants: ["private"] }),
		);
		const { result } = renderHook(() => useRoomEntryInfo({ roomId }));
		await flush();
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`/api/lunch/rooms/${roomId}/entry-info`);
		expect(init).toEqual({
			method: "GET",
			credentials: "same-origin",
			cache: "no-store",
			signal: expect.any(AbortSignal),
		});
		expect(result.current).toEqual({ title: "점심 모임", status: "ready" });
	});

	it("ignores a late previous-room response and hides its title immediately on room changes", async () => {
		const first = deferred<Response>();
		const second = deferred<Response>();
		fetchMock
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { result, rerender } = renderHook(
			({ id }) => useRoomEntryInfo({ roomId: id }),
			{ initialProps: { id: roomId } },
		);
		const firstSignal = fetchMock.mock.calls[0][1]?.signal;
		rerender({ id: otherRoomId });
		expect(firstSignal?.aborted).toBe(true);
		expect(result.current).toEqual({ title: null, status: "loading" });
		await act(async () => second.resolve(Response.json({ title: "다른 방" })));
		expect(result.current).toEqual({ title: "다른 방", status: "ready" });
		await act(async () => first.resolve(Response.json({ title: "이전 방" })));
		expect(result.current).toEqual({ title: "다른 방", status: "ready" });
	});

	it("aborts on disable/unmount and keeps a resolved same-room title while admission is pending", async () => {
		fetchMock.mockResolvedValue(Response.json({ title: "회의 점심" }));
		const { result, rerender, unmount } = renderHook(
			({ enabled }) => useRoomEntryInfo({ roomId, enabled }),
			{ initialProps: { enabled: true } },
		);
		await flush();
		const signal = fetchMock.mock.calls[0][1]?.signal;
		rerender({ enabled: false });
		expect(signal?.aborted).toBe(true);
		expect(result.current).toEqual({ title: "회의 점심", status: "ready" });
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("skips disabled and malformed room lookups", () => {
		const { result, rerender } = renderHook(
			({ id, enabled }) => useRoomEntryInfo({ roomId: id, enabled }),
			{ initialProps: { id: roomId, enabled: false } },
		);
		expect(fetchMock).not.toHaveBeenCalled();
		rerender({ id: "not-a-room", enabled: true });
		expect(result.current).toEqual({ title: null, status: "error" });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("times out without accepting a late response or keeping a pending timer", async () => {
		const pending = deferred<Response>();
		fetchMock.mockReturnValue(pending.promise);
		const { result } = renderHook(() => useRoomEntryInfo({ roomId }));
		await act(async () => vi.advanceTimersByTimeAsync(8000));
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		expect(result.current).toEqual({ title: null, status: "error" });
		await act(async () =>
			pending.resolve(Response.json({ title: "너무 늦은 방" })),
		);
		expect(result.current).toEqual({ title: null, status: "error" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it.each([
		null,
		{},
		[],
		{ title: " " },
		{ title: 1 },
		{ title: "가".repeat(61) },
	])("rejects malformed room info %j without affecting admission state", async (body) => {
		fetchMock.mockResolvedValue(Response.json(body));
		const { result } = renderHook(() => useRoomEntryInfo({ roomId }));
		await flush();
		expect(result.current).toEqual({ title: null, status: "error" });
	});

	it.each([
		404, 410, 503,
	])("handles lookup failure %s as optional metadata failure", async (status) => {
		fetchMock.mockResolvedValue(Response.json({ title: "무시" }, { status }));
		const { result } = renderHook(() => useRoomEntryInfo({ roomId }));
		await flush();
		expect(result.current).toEqual({ title: null, status: "error" });
	});
});
