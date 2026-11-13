// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateLunchRoom from "../src/components/features/CreateLunchRoom";
import { sampleLunchPlaces } from "../src/lib/lunch";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	readName: vi.fn(),
	saveHost: vi.fn(),
	saveName: vi.fn(),
	prepareEntry: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ navigate: mocks.navigate }),
}));
vi.mock("../src/lib/lunchRoomClient", () => ({
	readLunchRoomName: mocks.readName,
	saveLunchRoomHost: mocks.saveHost,
	saveLunchRoomName: mocks.saveName,
	prepareLunchRoomEntry: mocks.prepareEntry,
}));

const roomId = "12345678-abcd-4abc-8abc-123456789012";
const hostToken = "a".repeat(64);
const candidateIds = sampleLunchPlaces.slice(0, 2).map((place) => place.id);
const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown, status = 201) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
function openDialog() {
	fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
}
function form() {
	const element = screen.getByRole("dialog").querySelector("form");
	if (!element) throw new Error("Expected create-room form");
	return element;
}
async function submit() {
	await act(async () => fireEvent.submit(form()));
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.navigate.mockResolvedValue(undefined);
	mocks.saveHost.mockReturnValue(true);
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("CreateLunchRoom", () => {
	it("clamps old saved names, exposes a12-unit input limit and rejects injected overlong submits", async () => {
		mocks.readName.mockReturnValue(`${"가".repeat(11)}😀옛이름`);
		render(<CreateLunchRoom candidateIds={candidateIds} />);
		openDialog();
		const field = screen.getByLabelText("내 이름") as HTMLInputElement;
		expect(field.value).toBe("가".repeat(11));
		expect(field.maxLength).toBe(12);
		expect(screen.getByText("최대 12자 · 11/12")).toBeTruthy();
		fireEvent.change(field, { target: { value: "가".repeat(13) } });
		await submit();
		expect(screen.getByRole("alert").textContent).toContain("1~12자");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});
	it("submits the current selection and stores credentials before SPA navigation without placing the host token in the URL", async () => {
		mocks.readName.mockReturnValue("이전 이름");
		fetchMock.mockResolvedValueOnce(response({ roomId, hostToken }));
		const view = render(
			<CreateLunchRoom candidateIds={candidateIds} disabled={false} />,
		);
		const currentIds = sampleLunchPlaces.slice(2, 5).map((place) => place.id);
		view.rerender(
			<CreateLunchRoom candidateIds={currentIds} disabled={false} />,
		);
		openDialog();
		expect((screen.getByLabelText("내 이름") as HTMLInputElement).value).toBe(
			"이전 이름",
		);
		fireEvent.change(screen.getByLabelText("방 이름"), {
			target: { value: "  팀 점심  " },
		});
		fireEvent.change(screen.getByLabelText("내 이름"), {
			target: { value: "  에릭  " },
		});
		mocks.navigate.mockImplementationOnce(async () => {
			expect(mocks.saveHost).toHaveBeenCalledWith(roomId, hostToken);
			expect(mocks.saveName).toHaveBeenCalledWith("에릭");
			expect(mocks.prepareEntry).toHaveBeenCalledWith(roomId, "에릭");
		});
		await submit();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/lunch/rooms");
		expect(options?.method).toBe("POST");
		expect(JSON.parse(String(options?.body))).toEqual({
			title: "팀 점심",
			hostName: "에릭",
			candidateIds: currentIds,
		});
		expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
			to: "/lunch-room/$roomId",
			params: { roomId },
		});
		expect(JSON.stringify(mocks.navigate.mock.calls[0])).not.toContain(
			hostToken,
		);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("prevents duplicate creation and locks form controls while the request is pending", async () => {
		let resolveFetch: (value: Response) => void = () => {};
		fetchMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFetch = resolve;
			}),
		);
		render(<CreateLunchRoom candidateIds={candidateIds} disabled={false} />);
		openDialog();
		const currentForm = form();
		await act(async () => {
			fireEvent.submit(currentForm);
			fireEvent.submit(currentForm);
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(
			(screen.getByLabelText("방 이름") as HTMLInputElement).disabled,
		).toBe(true);
		expect(
			(screen.getByLabelText("내 이름") as HTMLInputElement).disabled,
		).toBe(true);
		expect(
			(screen.getByRole("button", { name: "닫기" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "방 만드는 중…",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.keyDown(screen.getByRole("dialog"), {
			key: "Escape",
			code: "Escape",
		});
		expect(screen.getByRole("dialog")).toBeTruthy();
		await act(async () => resolveFetch(response({ roomId, hostToken })));
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
	});

	it("ignores a late response after unmount even when the fetch transport ignores cancellation", async () => {
		let resolveFetch: (value: Response) => void = () => {};
		fetchMock.mockReturnValueOnce(
			new Promise((resolve) => {
				resolveFetch = resolve;
			}),
		);
		const view = render(
			<CreateLunchRoom candidateIds={candidateIds} disabled={false} />,
		);
		openDialog();
		await submit();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const signal = fetchMock.mock.calls[0][1]?.signal;
		expect(signal?.aborted).toBe(false);
		view.unmount();
		expect(signal?.aborted).toBe(true);
		await act(async () => resolveFetch(response({ roomId, hostToken })));
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.saveName).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("shows API errors without saving or navigating, then allows a fresh retry", async () => {
		fetchMock.mockResolvedValueOnce(
			response({ error: "잠시 후 다시 시도해 주세요." }, 503),
		);
		render(<CreateLunchRoom candidateIds={candidateIds} disabled={false} />);
		openDialog();
		await submit();
		expect(screen.getByRole("alert").textContent).toBe(
			"잠시 후 다시 시도해 주세요.",
		);
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.saveName).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
		expect(
			(
				screen.getByRole("button", {
					name: "방 만들고 입장하기",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);
		fetchMock.mockResolvedValueOnce(response({ roomId, hostToken }));
		await submit();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
	});

	it("rejects malformed successful credentials without saving them or navigating", async () => {
		fetchMock.mockResolvedValueOnce(
			response({ roomId, hostToken: "not-a-host-token" }),
		);
		render(<CreateLunchRoom candidateIds={candidateIds} disabled={false} />);
		openDialog();
		await submit();
		expect(screen.getByRole("alert").textContent).toContain(
			"방 정보를 확인할 수 없습니다",
		);
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("blocks fewer than two candidates both in the button and submit handler", async () => {
		render(
			<CreateLunchRoom
				candidateIds={candidateIds.slice(0, 1)}
				disabled={false}
			/>,
		);
		openDialog();
		expect(
			(
				screen.getByRole("button", {
					name: "방 만들고 입장하기",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		await submit();
		expect(screen.getByRole("alert").textContent).toContain("두 곳 이상");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("does not open a modal while the parent disables room creation", () => {
		render(<CreateLunchRoom candidateIds={candidateIds} disabled />);
		const trigger = screen.getByRole("button", {
			name: "방 만들기",
		});
		expect((trigger as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(trigger);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
