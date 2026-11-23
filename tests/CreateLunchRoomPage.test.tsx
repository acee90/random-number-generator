// @vitest-environment jsdom

import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CreateLunchRoomPage from "../src/components/features/CreateLunchRoomPage";
import { saveCandidateList } from "../src/lib/candidateLibrary";
import { sampleLunchPlaces } from "../src/lib/lunch";
import { readSoloRoom } from "../src/lib/soloRoom";

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
const roomId = "387c8be4-49a2-4d09-83cb-8b3011be1da1";
const hostToken = "a".repeat(64);
const fetchMock = vi.fn<typeof fetch>();

function response(body: unknown = { roomId, hostToken }, status = 201) {
	return Response.json(body, { status });
}

function button(name: string): HTMLButtonElement {
	return screen.getByRole("button", { name }) as HTMLButtonElement;
}

function input(label: string): HTMLInputElement | HTMLTextAreaElement {
	return screen.getByLabelText(label);
}

function next() {
	fireEvent.click(button("다음"));
}

function listAction(name: string) {
	fireEvent.keyDown(button("목록 작업"), { key: "ArrowDown" });
	fireEvent.click(screen.getByRole("menuitem", { name }));
}

async function setCandidates(...values: string[]) {
	const addRow = screen.queryByRole("button", { name: "추가하기" });
	if (addRow) fireEvent.click(addRow);
	for (const value of values.length ? values : ["라면", "김치찌개"]) {
		fireEvent.change(input("새 후보 이름"), { target: { value } });
		await act(async () => fireEvent.click(button("후보 추가")));
	}
}

async function create(name = "방 만들기") {
	await act(async () => fireEvent.click(button(name)));
}

beforeEach(() => {
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.navigate.mockResolvedValue(undefined);
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
	localStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("room creation steps", () => {
	it.each([
		false,
		true,
	])("preserves early input when the setup page hydrates (solo=%s)", (solo) => {
		mocks.readName.mockReturnValue("지난 닉네임");
		const container = document.body.appendChild(document.createElement("div"));
		const page = <CreateLunchRoomPage solo={solo} />;
		container.innerHTML = renderToString(page);
		input("방 이름").value = "먼저 입력한 이름";
		input("닉네임").value = "준희";
		render(page, { container, hydrate: true });
		next();
		fireEvent.click(button("이전"));
		expect(input("방 이름").value).toBe("먼저 입력한 이름");
		expect(input("닉네임").value).toBe("준희");
	});
	it("groups required fields together and retains both steps' input after going back", async () => {
		mocks.readName.mockReturnValue(`${"가".repeat(11)}😀옛이름`);
		render(<CreateLunchRoomPage />);
		const main = within(screen.getByRole("main"));
		expect(main.getByRole("heading", { level: 1 }).textContent).toBe(
			"방 만들기",
		);
		expect(main.queryByRole("link", { name: "홈" })).toBeNull();
		expect(
			screen.getByRole("link", { name: "점메추 홈" }).getAttribute("href"),
		).toBe("/");
		expect(input("닉네임").value).toBe("가".repeat(11));
		expect(input("닉네임").maxLength).toBe(12);
		fireEvent.change(input("방 이름"), { target: { value: "팀 점심" } });

		next();
		expect(document.activeElement).toBe(
			main.getByRole("heading", { name: "후보 준비" }),
		);
		expect(button("방 만들기").disabled).toBe(true);
		expect(main.getByText("전체 후보 0개")).toBeTruthy();
		expect(screen.queryByLabelText("새 후보 이름")).toBeNull();
		fireEvent.click(button("추가하기"));
		expect(document.activeElement).toBe(input("새 후보 이름"));
		fireEvent.change(input("새 후보 이름"), {
			target: { value: "취소할 후보" },
		});
		fireEvent.keyDown(input("새 후보 이름"), { key: "Escape" });
		expect(document.activeElement).toBe(button("추가하기"));
		await setCandidates();
		fireEvent.change(input("새 후보 이름"), {
			target: { value: "아직 추가하지 않은 후보" },
		});
		fireEvent.click(button("이전"));
		expect(input("방 이름").value).toBe("팀 점심");
		expect(input("닉네임").value).toBe("가".repeat(11));
		next();
		expect(screen.getByRole("button", { name: "라면 이름 수정" })).toBeTruthy();
		expect(input("새 후보 이름").value).toBe("아직 추가하지 않은 후보");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("blocks whitespace-only room names and invalid nicknames on the first step", () => {
		render(<CreateLunchRoomPage />);
		fireEvent.change(input("방 이름"), { target: { value: "   " } });
		next();
		expect(document.activeElement).toBe(input("방 이름"));
		expect(input("방 이름").getAttribute("aria-invalid")).toBe("true");
		fireEvent.change(input("방 이름"), { target: { value: "팀 점심" } });
		fireEvent.change(input("닉네임"), { target: { value: "가".repeat(13) } });
		next();
		expect(document.activeElement).toBe(input("닉네임"));
		expect(screen.getByRole("alert").textContent).toContain("1~12자");
		expect(screen.queryByLabelText("새 후보 이름")).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("keeps list numbers when searching and restores a directly deleted candidate to its place", async () => {
		render(<CreateLunchRoomPage />);
		next();
		await setCandidates("라면", "김치찌개", "비빔밥");
		const list = within(screen.getByRole("list", { name: "후보 편집 목록" }));
		fireEvent.change(input("후보 검색"), { target: { value: "김치" } });
		expect(within(list.getByRole("listitem")).getByText("2")).toBeTruthy();
		expect(list.queryByRole("button", { name: /후보 관리$/ })).toBeNull();
		fireEvent.click(list.getByRole("button", { name: "김치찌개 후보 삭제" }));
		expect(
			list.queryByRole("button", { name: "김치찌개 이름 수정" }),
		).toBeNull();
		expect(screen.getByText("김치찌개 삭제됨", { exact: true })).toBeTruthy();
		fireEvent.click(button("되돌리기"));
		expect(within(list.getByRole("listitem")).getByText("2")).toBeTruthy();
		expect(document.activeElement).toBe(input("후보 검색"));
	});

	it("changes category filters in a dialog and shows when a filter is applied", () => {
		const candidates = sampleLunchPlaces.slice(0, 3);
		saveCandidateList({
			id: "filter-menu",
			name: "분류 검증 목록",
			items: candidates.map((candidate) => ({ ...candidate, included: true })),
		});
		render(<CreateLunchRoomPage />);
		next();
		listAction("목록 불러오기");
		fireEvent.click(
			screen.getByRole("button", { name: /^분류 검증 목록\s*후보/ }),
		);
		const filter = button("필터");
		expect(filter.getAttribute("aria-haspopup")).toBe("dialog");
		expect(screen.queryByText(/^필터 적용 중\./)).toBeNull();
		fireEvent.click(filter);
		const dialog = within(screen.getByRole("dialog", { name: "후보 필터" }));
		const category = candidates[0].category;
		fireEvent.click(
			dialog.getByRole("button", { name: `${category} 분류 포함` }),
		);
		fireEvent.click(dialog.getByRole("button", { name: "완료" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.getByText(/^필터 적용 중\./)).toBeTruthy();
		const list = within(screen.getByRole("list", { name: "후보 편집 목록" }));
		expect(
			list.queryByRole("button", { name: `${candidates[0].name} 이름 수정` }),
		).toBeNull();

		fireEvent.click(filter);
		fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
		expect(screen.queryByText(/^필터 적용 중\./)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "완료" }));
		expect(
			list.getByRole("button", { name: `${candidates[0].name} 이름 수정` }),
		).toBeTruthy();
	});

	it("creates a ready room with the included candidate list and stores the host credentials before navigation", async () => {
		const savedCandidates = sampleLunchPlaces.slice(0, 3);
		saveCandidateList({
			id: "team-menu",
			name: "팀 후보 목록",
			items: savedCandidates.map((candidate) => ({
				...candidate,
				included: true,
			})),
		});
		fetchMock.mockResolvedValueOnce(response());
		mocks.navigate.mockImplementationOnce(async () => {
			expect(mocks.saveHost).toHaveBeenCalledExactlyOnceWith(roomId, hostToken);
			expect(mocks.saveName).toHaveBeenCalledExactlyOnceWith("에릭");
			expect(mocks.prepareEntry).toHaveBeenCalledExactlyOnceWith(
				roomId,
				"에릭",
			);
		});
		render(<CreateLunchRoomPage />);
		fireEvent.change(input("방 이름"), {
			target: { value: "  개발팀 점심  " },
		});
		fireEvent.change(input("닉네임"), { target: { value: "  에릭  " } });
		next();
		listAction("목록 불러오기");
		fireEvent.click(
			within(screen.getByRole("dialog", { name: "목록 불러오기" })).getByRole(
				"button",
				{ name: /^팀 후보 목록\s*후보/ },
			),
		);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(
			screen.getByText(`전체 후보 ${savedCandidates.length}개`),
		).toBeTruthy();
		await setCandidates("  라면  ", "김치찌개");
		fireEvent.click(screen.getByRole("button", { name: "김치찌개 이름 수정" }));
		fireEvent.change(screen.getByRole("textbox", { name: /번 후보 이름/ }), {
			target: { value: "된장찌개" },
		});
		fireEvent.keyDown(screen.getByRole("textbox", { name: /번 후보 이름/ }), {
			key: "Enter",
		});
		fireEvent.click(
			screen.getByRole("checkbox", { name: "된장찌개 추첨 포함" }),
		);
		await create();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe("/api/lunch/rooms");
		expect(options?.method).toBe("POST");
		const body = JSON.parse(String(options?.body));
		expect(body).toMatchObject({
			title: "개발팀 점심",
			hostName: "에릭",
			startInWaiting: true,
			candidateIds: [],
		});
		expect(body.candidates).toHaveLength(2 + savedCandidates.length);
		expect(body.candidates.slice(-2)).toMatchObject([
			{ name: "라면", category: "미분류" },
			{ name: "된장찌개", category: "미분류" },
		]);
		expect(body.candidates[0]).toMatchObject({
			name: sampleLunchPlaces[0].name,
			included: true,
		});
		expect(body.gameFilter).toEqual({
			categories: null,
			excludedIds: [body.candidates.at(-1).id],
		});
		expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
			to: "/lunch-room/$roomId",
			params: { roomId },
		});
	});

	it("uses the same two steps to open a private room with the selected host, candidates and filter", async () => {
		render(<CreateLunchRoomPage solo />);
		fireEvent.change(input("방 이름"), { target: { value: "혼자 먹는 점심" } });
		fireEvent.change(input("닉네임"), { target: { value: "준희" } });
		next();
		expect(button("방 만들기").disabled).toBe(true);
		await setCandidates("국밥", "우동");
		fireEvent.click(screen.getByRole("checkbox", { name: "우동 추첨 포함" }));
		await create();
		expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({
			to: "/solo/$roomId",
			params: { roomId: expect.any(String) },
		});
		const saved = readSoloRoom(
			mocks.navigate.mock.calls[0][0].params.roomId,
		)?.snapshot;
		expect(saved).toMatchObject({
			title: "혼자 먹는 점심",
			participants: [{ name: "준희", isHost: true }],
			status: "waiting",
			candidates: [{ name: "국밥" }, { name: "우동" }],
			gameFilter: { excludedIds: [saved?.candidates[1].id] },
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.prepareEntry).not.toHaveBeenCalled();
	});
	it("locks the candidate step while submitting once, then keeps the draft available after a server error", async () => {
		let resolve!: (value: Response) => void;
		fetchMock.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		render(<CreateLunchRoomPage />);
		next();
		await setCandidates();
		await act(async () => {
			fireEvent.click(button("방 만들기"));
			fireEvent.click(button("방 만들기"));
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(
			screen
				.getByRole("region", { name: "후보 준비" })
				.getAttribute("aria-busy"),
		).toBe("true");
		expect(button("이전").disabled).toBe(true);
		expect(button("방 만드는 중…").disabled).toBe(true);
		expect(button("목록 작업").disabled).toBe(true);
		expect(button("라면 후보 삭제").disabled).toBe(true);
		expect(input("후보 검색").disabled).toBe(true);
		expect(input("새 후보 이름").disabled).toBe(true);
		await act(async () =>
			resolve(response({ error: "지금은 방을 만들 수 없습니다." }, 503)),
		);
		expect(screen.getByRole("alert").textContent).toBe(
			"지금은 방을 만들 수 없습니다.",
		);
		expect(screen.getByRole("button", { name: "라면 이름 수정" })).toBeTruthy();
		expect(button("방 만들기").disabled).toBe(false);
		expect(mocks.saveHost).not.toHaveBeenCalled();
		fetchMock.mockResolvedValueOnce(response());
		await create();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(mocks.navigate).toHaveBeenCalledOnce();
	});

	it("retries entry with the created room after a navigation failure", async () => {
		fetchMock.mockResolvedValueOnce(response());
		mocks.navigate.mockRejectedValueOnce(new Error("Navigation failed"));
		render(<CreateLunchRoomPage />);
		next();
		await setCandidates();
		await create();
		expect(screen.getByRole("alert").textContent).toBe(
			"방을 만들었습니다. 다시 입장해 주세요.",
		);
		expect(button("방에 다시 입장").disabled).toBe(false);
		await create("방에 다시 입장");
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(mocks.navigate).toHaveBeenCalledTimes(2);
	});

	it("ignores an expired response without cancelling a retry's deadline", async () => {
		vi.useFakeTimers();
		let resolveFirst!: (value: Response) => void;
		fetchMock
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
			)
			.mockResolvedValueOnce({ json: () => new Promise(() => {}) } as Response);
		render(<CreateLunchRoomPage />);
		next();
		await setCandidates();

		await create();
		await act(async () => vi.advanceTimersByTime(15000));
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		expect(screen.getByRole("alert").textContent).toContain("응답이 늦어지고");

		await create();
		await act(async () => resolveFirst(response()));
		expect(button("방 만드는 중…").disabled).toBe(true);
		await act(async () => vi.advanceTimersByTime(15000));
		expect(fetchMock.mock.calls[1][1]?.signal?.aborted).toBe(true);
		expect(button("방 만들기").disabled).toBe(false);
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});

	it("aborts an outstanding request on unmount", async () => {
		let resolve!: (value: Response) => void;
		fetchMock.mockReturnValueOnce(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const view = render(<CreateLunchRoomPage />);
		next();
		await setCandidates();
		await create();
		view.unmount();
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
		await act(async () => resolve(response()));
		expect(mocks.saveHost).not.toHaveBeenCalled();
	});

	it("rejects a successful response with malformed host credentials", async () => {
		fetchMock.mockResolvedValueOnce(
			response({ roomId, hostToken: "malformed" }),
		);
		render(<CreateLunchRoomPage />);
		next();
		await setCandidates();
		await create();
		expect(screen.getByRole("alert").textContent).toContain(
			"방 정보를 확인할 수 없습니다",
		);
		expect(mocks.saveHost).not.toHaveBeenCalled();
		expect(mocks.navigate).not.toHaveBeenCalled();
	});
});
