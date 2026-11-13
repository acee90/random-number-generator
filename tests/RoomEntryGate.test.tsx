// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	renderHook,
	screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RoomEntryGate from "../src/components/features/RoomEntryGate";
import { useNicknameAvailability } from "../src/hooks/useNicknameAvailability";

const mocks = vi.hoisted(() => ({
	readName: vi.fn(),
	readHost: vi.fn(),
	readGuest: vi.fn(),
}));
vi.mock("../src/lib/lunchRoomClient", () => ({
	readLunchRoomName: mocks.readName,
	readLunchRoomHost: mocks.readHost,
	readOrCreateLunchRoomGuestToken: mocks.readGuest,
}));

const roomId = "9b8c4944-5841-462d-b5a4-a701044be6b2";
const otherRoomId = "9b8c4944-5841-462d-b5a4-a701044be6b3";
const hostToken = "a".repeat(64);
const guestToken = "b".repeat(64);
const fetchMock = vi.fn<typeof fetch>();
const enter = vi.fn(() => true);
const clearError = vi.fn();

function response(name: string, available = true) {
	return new Response(JSON.stringify({ name, available }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
async function advance(ms = 350) {
	await act(async () => vi.advanceTimersByTimeAsync(ms));
}
function gate(error = "") {
	return (
		<RoomEntryGate
			roomId={roomId}
			pending={false}
			error={error}
			onEnter={enter}
			onClearError={clearError}
		/>
	);
}

beforeEach(() => {
	vi.useFakeTimers();
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.readGuest.mockReturnValue(guestToken);
	fetchMock.mockReset();
	enter.mockClear();
	clearError.mockClear();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("nickname preflight entry UI", () => {
	it("shows immediate checking feedback while debouncing changes and requires explicit entry after success", async () => {
		fetchMock.mockResolvedValue(response("동료 둘"));
		render(gate());
		const input = screen.getByRole("textbox", { name: "닉네임" });
		const button = screen.getByRole("button", { name: "입장하기" });
		fireEvent.change(input, { target: { value: "동료 하나" } });
		expect(screen.getByRole("status").textContent).toContain("확인 중…");
		expect(
			screen.getByRole("status").querySelector(".room-entry-spinner"),
		).not.toBeNull();
		expect((button as HTMLButtonElement).disabled).toBe(true);
		expect((input as HTMLInputElement).disabled).toBe(false);
		await advance(200);
		fireEvent.change(input, { target: { value: "  동료 둘  " } });
		await advance(349);
		expect(fetchMock).not.toHaveBeenCalled();
		await advance(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("status").textContent).toContain("사용할 수 있는");
		expect((button as HTMLButtonElement).disabled).toBe(false);
		expect(enter).not.toHaveBeenCalled();
		fireEvent.click(button);
		expect(enter).toHaveBeenCalledExactlyOnceWith("동료 둘");
	});

	it("checks a saved name without automatically submitting it", async () => {
		mocks.readName.mockReturnValue("전에 쓴 이름");
		fetchMock.mockResolvedValue(response("전에 쓴 이름"));
		render(gate());
		expect(
			(screen.getByRole("textbox", { name: "닉네임" }) as HTMLInputElement)
				.value,
		).toBe("전에 쓴 이름");
		await advance();
		expect(screen.getByRole("status").textContent).toContain("사용할 수 있는");
		expect(enter).not.toHaveBeenCalled();
	});

	it("blocks duplicate names even if the form is submitted directly", async () => {
		fetchMock.mockResolvedValue(response("같은 이름", false));
		render(gate());
		fireEvent.change(screen.getByRole("textbox", { name: "닉네임" }), {
			target: { value: "같은 이름" },
		});
		await advance();
		expect(screen.getByRole("status").textContent).toContain("이미 사용 중");
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		expect(enter).not.toHaveBeenCalled();
	});

	it("suspends requests through Korean composition and checks the completed name", async () => {
		fetchMock.mockResolvedValue(response("한글"));
		render(gate());
		const input = screen.getByRole("textbox", { name: "닉네임" });
		fireEvent.compositionStart(input);
		fireEvent.change(input, { target: { value: "ㅎ" } });
		await advance(500);
		fireEvent.change(input, { target: { value: "한글" } });
		await advance(500);
		expect(fetchMock).not.toHaveBeenCalled();
		fireEvent.compositionEnd(input);
		await advance(349);
		expect(fetchMock).not.toHaveBeenCalled();
		await advance(1);
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).name).toBe(
			"한글",
		);
		expect(screen.getByRole("status").textContent).toContain("사용할 수 있는");
	});

	it("keeps a failed check blocked and offers an explicit retry", async () => {
		fetchMock.mockRejectedValueOnce(new Error("Offline"));
		fetchMock.mockResolvedValueOnce(response("다시 확인"));
		render(gate());
		fireEvent.change(screen.getByRole("textbox", { name: "닉네임" }), {
			target: { value: "다시 확인" },
		});
		await advance();
		expect(screen.getByRole("status").textContent).toContain(
			"확인하지 못했습니다",
		);
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
		expect(screen.getByRole("status").textContent).toContain("확인 중…");
		await advance();
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
	});

	it("invalidates an available result after the join loses a nickname race", async () => {
		let rejectJoin: (error: string) => void = () => {};
		function Harness() {
			const [error, setError] = useState("");
			rejectJoin = setError;
			return (
				<RoomEntryGate
					roomId={roomId}
					pending={false}
					error={error}
					onEnter={enter}
					onClearError={() => setError("")}
				/>
			);
		}
		fetchMock.mockResolvedValueOnce(response("동료"));
		fetchMock.mockResolvedValueOnce(response("동료", false));
		render(<Harness />);
		fireEvent.change(screen.getByRole("textbox", { name: "닉네임" }), {
			target: { value: "동료" },
		});
		await advance();
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);
		act(() => rejectJoin("이미 사용 중인 닉네임입니다."));
		expect(
			(screen.getByRole("button", { name: "입장하기" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		fireEvent.submit(screen.getByRole("form", { name: "추첨방 입장" }));
		expect(enter).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
		await advance();
		expect(screen.getByRole("status").textContent).toContain("이미 사용 중");
	});
});

describe("nickname preflight cancellation and private proofs", () => {
	it("normalizes the request and sends only the host proof in the POST body", async () => {
		mocks.readHost.mockReturnValue(hostToken);
		fetchMock.mockResolvedValue(response("ERIC"));
		const { result } = renderHook(() =>
			useNicknameAvailability({ roomId, name: " ＥＲＩＣ " }),
		);
		await advance();
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe(`/api/lunch/rooms/${roomId}/nickname-availability`);
		expect(String(url)).not.toContain(hostToken);
		expect(JSON.parse(String(options?.body))).toEqual({
			name: "ERIC",
			hostToken,
		});
		expect(options).toMatchObject({
			method: "POST",
			cache: "no-store",
			credentials: "same-origin",
		});
		expect(mocks.readGuest).not.toHaveBeenCalled();
		expect(result.current.status).toBe("available");
	});

	it("uses a stable guest proof without joining the room", async () => {
		fetchMock.mockResolvedValue(response("손님"));
		renderHook(() => useNicknameAvailability({ roomId, name: "손님" }));
		await advance();
		expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
			name: "손님",
			guestToken,
		});
		expect(mocks.readGuest).toHaveBeenCalledExactlyOnceWith(roomId);
		expect(String(fetchMock.mock.calls[0][0])).not.toContain(guestToken);
	});

	it("does not request empty, invalid or composing names", async () => {
		const { result, rerender } = renderHook(
			({ name, composing }) =>
				useNicknameAvailability({ roomId, name, composing }),
			{ initialProps: { name: "", composing: false } },
		);
		for (const name of ["", "   ", "가".repeat(13), "숨김\u200b문자"]) {
			rerender({ name, composing: false });
			await advance(500);
			expect(result.current.status).not.toBe("available");
		}
		rerender({ name: "조합 중", composing: true });
		await advance(500);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mocks.readGuest).not.toHaveBeenCalled();
	});

	it("ignores late responses after input changes even if transport cancellation is ignored", async () => {
		const first = deferred<Response>();
		const second = deferred<Response>();
		fetchMock
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { result, rerender } = renderHook(
			({ name }) => useNicknameAvailability({ roomId, name }),
			{ initialProps: { name: "첫 이름" } },
		);
		await advance();
		const firstSignal = fetchMock.mock.calls[0][1]?.signal;
		rerender({ name: "다음 이름" });
		expect(firstSignal?.aborted).toBe(true);
		expect(result.current.status).toBe("checking");
		await advance();
		await act(async () => second.resolve(response("다음 이름", false)));
		expect(result.current.status).toBe("taken");
		await act(async () => first.resolve(response("첫 이름", true)));
		expect(result.current.status).toBe("taken");
	});

	it("scopes checks to the current room and aborts on unmount", async () => {
		const first = deferred<Response>();
		const second = deferred<Response>();
		fetchMock
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { result, rerender, unmount } = renderHook(
			({ roomId: currentRoom }) =>
				useNicknameAvailability({ roomId: currentRoom, name: "동료" }),
			{ initialProps: { roomId } },
		);
		await advance();
		rerender({ roomId: otherRoomId });
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		await advance();
		expect(String(fetchMock.mock.calls[1][0])).toContain(otherRoomId);
		await act(async () => first.resolve(response("동료", true)));
		expect(result.current.status).toBe("checking");
		unmount();
		expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		await act(async () => second.resolve(response("동료", true)));
	});

	it("times out eight seconds after dispatch and ignores any later success", async () => {
		const request = deferred<Response>();
		fetchMock.mockReturnValue(request.promise);
		const { result } = renderHook(() =>
			useNicknameAvailability({ roomId, name: "동료" }),
		);
		await advance(350);
		await advance(7999);
		expect(result.current.status).toBe("checking");
		await advance(1);
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		expect(result.current.status).toBe("error");
		await act(async () => request.resolve(response("동료", true)));
		expect(result.current.status).toBe("error");
	});

	it.each([
		() => new Response("Unavailable", { status: 410 }),
		() =>
			new Response(JSON.stringify({ name: "다른 이름", available: true }), {
				status: 200,
			}),
		() =>
			new Response(JSON.stringify({ name: "동료", available: "true" }), {
				status: 200,
			}),
	])("does not grant entry on unsuccessful or malformed responses", async (makeResponse) => {
		fetchMock.mockResolvedValue(makeResponse());
		const { result } = renderHook(() =>
			useNicknameAvailability({ roomId, name: "동료" }),
		);
		await advance();
		expect(result.current.status).toBe("error");
	});
});
