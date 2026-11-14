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
import CreateLunchRoomPage from "../src/components/features/CreateLunchRoomPage";
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
vi.mock("../src/components/layout/SiteHeader", () => ({
	default: () => (
		<nav aria-label="사이트 메뉴">
			<a href="/">점메추</a>
			<a href="/tools">도구 모음</a>
		</nav>
	),
}));

const roomId = "387c8be4-49a2-4d09-83cb-8b3011be1da1";
const hostToken = "a".repeat(64);
const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown, status = 201) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function form() {
	const element = screen.getByRole("main").querySelector("form");
	if (!element) throw new Error("Expected inline room creation form");
	return element;
}

function createButton() {
	return screen.getByRole("button", {
		name: "방 만들고 입장하기",
	}) as HTMLButtonElement;
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

describe("Jeommechu room setup page", () => {
	it("shows the room form with a saved editable nickname and a path back home", () => {
		mocks.readName.mockReturnValue("저장된 이름");
		render(<CreateLunchRoomPage />);
		const main = screen.getByRole("main");
		expect(within(main).getByRole("heading", { level: 1 }).textContent).toBe(
			"방 만들기",
		);
		expect((screen.getByLabelText("닉네임") as HTMLInputElement).value).toBe(
			"저장된 이름",
		);
		expect(
			(screen.getByLabelText("방 이름") as HTMLInputElement).value,
		).not.toBe("");
		expect(createButton().disabled).toBe(false);
		expect(screen.queryByRole("button", { name: "방 만들기" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(
			within(main).getByRole("link", { name: "홈" }).getAttribute("href"),
		).toBe("/");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("sends every source ID and stores normalized identity and credentials before SPA navigation", async () => {
		fetchMock.mockResolvedValueOnce(response({ roomId, hostToken }));
		render(<CreateLunchRoomPage />);
		fireEvent.change(screen.getByLabelText("방 이름"), {
			target: { value: "  개발팀 점심  " },
		});
		fireEvent.change(screen.getByLabelText("닉네임"), {
			target: { value: "  에릭  " },
		});
		mocks.navigate.mockImplementationOnce(async () => {
			expect(mocks.saveHost).toHaveBeenCalledExactlyOnceWith(roomId, hostToken);
			expect(mocks.saveName).toHaveBeenCalledExactlyOnceWith("에릭");
			expect(mocks.prepareEntry).toHaveBeenCalledExactlyOnceWith(
				roomId,
				"에릭",
			);
		});
		await submit();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/lunch/rooms");
		expect(options?.method).toBe("POST");
		expect(options?.headers).toEqual({ "Content-Type": "application/json" });
		const body = JSON.parse(String(options?.body));
		expect(body).toEqual({
			title: "개발팀 점심",
			hostName: "에릭",
			candidateIds: sampleLunchPlaces.map((place) => place.id),
		});
		expect(body.candidateIds).toHaveLength(sampleLunchPlaces.length);
		expect(new Set(body.candidateIds).size).toBe(sampleLunchPlaces.length);
		expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
			to: "/lunch-room/$roomId",
			params: { roomId },
		});
		expect(JSON.stringify(mocks.navigate.mock.calls)).not.toContain(hostToken);
	});

	it("offers only the current room flow rather than future public, private, custom or voting controls", () => {
		render(<CreateLunchRoomPage />);
		const main = within(screen.getByRole("main"));
		expect(main.getAllByRole("button")).toHaveLength(1);
		expect(
			main.queryByRole("button", {
				name: /공개|비공개|메뉴 추가|엑셀|투표|가중치|위치 검색/,
			}),
		).toBeNull();
		expect(main.queryByRole("checkbox")).toBeNull();
		expect(main.queryByRole("radio")).toBeNull();
		expect(main.queryByRole("combobox")).toBeNull();
		expect(
			screen.getByText(
				new RegExp(
					`회사 주변 음식점 ${sampleLunchPlaces.length}곳으로 시작합니다.`,
				),
			),
		).toBeTruthy();
		expect(screen.getByText(/제공받은 엑셀 목록을 사용합니다/)).toBeTruthy();
	});

	it("blocks creation for blank or whitespace-only room names and nicknames", () => {
		render(<CreateLunchRoomPage />);
		for (const label of ["방 이름", "닉네임"]) {
			const field = screen.getByLabelText(label) as HTMLInputElement;
			const original = field.value;
			for (const value of ["", "   "]) {
				fireEvent.change(field, { target: { value } });
				expect(createButton().disabled).toBe(true);
				fireEvent.click(createButton());
				expect(fetchMock).not.toHaveBeenCalled();
			}
			fireEvent.change(field, { target: { value: original } });
			expect(createButton().disabled).toBe(false);
		}
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("shows an HTTP failure in the form and retains input for retry without forced navigation", async () => {
		fetchMock.mockResolvedValueOnce(
			response({ error: "지금은 방을 만들 수 없습니다." }, 503),
		);
		render(<CreateLunchRoomPage />);
		fireEvent.change(screen.getByLabelText("방 이름"), {
			target: { value: "기획팀 점심" },
		});
		fireEvent.change(screen.getByLabelText("닉네임"), {
			target: { value: "동료" },
		});
		await submit();
		expect(screen.getByRole("alert").textContent).toBe(
			"지금은 방을 만들 수 없습니다.",
		);
		expect((screen.getByLabelText("방 이름") as HTMLInputElement).value).toBe(
			"기획팀 점심",
		);
		expect((screen.getByLabelText("닉네임") as HTMLInputElement).value).toBe(
			"동료",
		);
		expect(createButton().disabled).toBe(false);
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.saveName).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
		fetchMock.mockResolvedValueOnce(response({ roomId, hostToken }));
		await submit();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("prevents duplicate inline submissions and locks the fields while creating", async () => {
		let finish: (value: Response) => void = () => {};
		fetchMock.mockReturnValueOnce(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		render(<CreateLunchRoomPage />);
		await act(async () => {
			fireEvent.submit(form());
			fireEvent.submit(form());
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(
			(screen.getByLabelText("방 이름") as HTMLInputElement).disabled,
		).toBe(true);
		expect((screen.getByLabelText("닉네임") as HTMLInputElement).disabled).toBe(
			true,
		);
		expect(
			(
				screen.getByRole("button", {
					name: "방 만드는 중…",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		expect(form().getAttribute("aria-busy")).toBe("true");
		expect(mocks.navigate).not.toHaveBeenCalled();
		await act(async () => finish(response({ roomId, hostToken })));
		expect(mocks.navigate).toHaveBeenCalledTimes(1);
	});
});
