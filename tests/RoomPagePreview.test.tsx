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
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	previewRoomId,
	RoomPageFixtureProvider,
} from "../stories/core/room-page-fixture";

vi.mock(
	"../src/hooks/useLunchRoom",
	() => import("../stories/core/room-page-fixture"),
);

const fetchRequest = vi.fn();
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-13T05:00:00.000Z"));
	localStorage.clear();
	vi.stubGlobal("fetch", fetchRequest.mockReset());
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	);
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function renderPage(
	isHost: boolean,
	initialPhase: "idle" | "editing" | "result",
	candidateCount = 12,
) {
	return render(
		<RoomPageFixtureProvider
			isHost={isHost}
			initialPhase={initialPhase}
			candidateCount={candidateCount}
		>
			<LunchRoomPage roomId={previewRoomId} />
		</RoomPageFixtureProvider>,
	);
}

function candidateName(index = 1) {
	const existing = screen.queryByRole("textbox", {
		name: `${index}번 후보 이름`,
	});
	if (existing) return existing as HTMLInputElement;
	const rows = within(
		screen.getByRole("list", { name: "후보 편집 목록" }),
	).getAllByRole("listitem");
	fireEvent.click(
		within(rows[index - 1]).getByRole("button", { name: /이름 수정$/ }),
	);
	return screen.getByRole("textbox", {
		name: `${index}번 후보 이름`,
	}) as HTMLInputElement;
}
function listAction(name: string) {
	fireEvent.keyDown(screen.getByRole("button", { name: "목록 작업" }), {
		key: "ArrowDown",
	});
	fireEvent.click(screen.getByRole("menuitem", { name }));
}
async function addCandidate(value: string) {
	const addRow = screen.queryByRole("button", { name: "추가하기" });
	if (addRow) fireEvent.click(addRow);
	const quickAdd = within(screen.getByRole("form", { name: "후보 빠른 추가" }));
	fireEvent.change(quickAdd.getByLabelText("새 후보 이름"), {
		target: { value },
	});
	await act(async () =>
		fireEvent.click(quickAdd.getByRole("button", { name: "후보 추가" })),
	);
}
function filterButton() {
	return screen.getByRole("button", { name: "필터" });
}

function expectWaitingCandidateCount(count: number) {
	expect(document.querySelector(".room-current-candidates")).toBeNull();
	expect(
		screen.getByRole("button", {
			name: "후보",
			description: new RegExp(`이번 추첨 ${count}개$`),
		}),
	).toBeTruthy();
}

describe("Storybook room page with the local transport adapter", () => {
	it("opens the editor on an empty room and preserves an added candidate when loading is cancelled", async () => {
		renderPage(true, "editing", 0);
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "목록 작업" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "슬롯 돌리기" })).toBeNull();
		expect(screen.getByRole("button", { name: "추가하기" })).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "마감" }).matches(":disabled"),
		).toBe(true);
		await addCandidate("처음 작성한 후보");

		listAction("목록 불러오기");
		const load = screen.getByRole("dialog", { name: "목록 불러오기" });
		expect(
			within(load).getByRole("button", { name: /^기본 음식점 목록/ }),
		).toBeTruthy();
		fireEvent.click(within(load).getByRole("button", { name: "취소" }));
		expect(
			screen.getByRole("button", { name: "처음 작성한 후보 이름 수정" }),
		).toBeTruthy();

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "마감" }));
		});
		expectWaitingCandidateCount(1);
		expect(
			screen.getByRole("button", { name: "마지막 후보 확정" }),
		).toBeTruthy();
		expect(fetchRequest).not.toHaveBeenCalled();
	});
	it("loads the default list through a dialog from Empty and finalizes without an extra confirmation stage", async () => {
		renderPage(true, "editing", 0);
		listAction("목록 불러오기");
		const load = screen.getByRole("dialog", { name: "목록 불러오기" });
		await act(async () => {
			fireEvent.click(
				within(load).getByRole("button", { name: /^기본 음식점 목록/ }),
			);
		});
		expect(screen.queryByRole("dialog", { name: "목록 불러오기" })).toBeNull();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(candidateName(1).value).toBe(sampleLunchPlaces[0].name);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "마감" }));
		});
		expectWaitingCandidateCount(sampleLunchPlaces.length);
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(false);
		expect(fetchRequest).not.toHaveBeenCalled();
	});
	it("keeps the new empty participant view read-only until recommendation intake opens", () => {
		renderPage(false, "editing", 0);
		expect(screen.getByRole("heading", { name: "후보 만들기" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^새로 작성/ })).toBeNull();
		expect(screen.queryByRole("button", { name: /^목록 불러오기/ })).toBeNull();
		expect(screen.queryByRole("textbox", { name: "후보 추천" })).toBeNull();
		expect(screen.queryByRole("button", { name: "슬롯 돌리기" })).toBeNull();
	});
	it("opens recommendation intake from candidate editing and finalizes back to compact waiting without drawing", async () => {
		renderPage(true, "idle");
		expect(screen.queryByRole("switch", { name: "후보 추천받기" })).toBeNull();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "후보" }));
		});
		await act(async () => {
			fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" }));
		});
		expect(
			screen.getByRole("heading", { name: "후보 추천 접수 중" }),
		).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "슬롯머신" })).toBeNull();
		await addCandidate("닫기 전 추가한 후보");
		await act(async () => {
			fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" }));
		});
		expect(
			screen.getByRole("heading", { name: "접수 종료 · 목록 확인" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "닫기 전 추가한 후보 이름 수정" }),
		).toBeTruthy();
		await act(async () => {
			fireEvent.click(screen.getByRole("switch", { name: "후보 추천받기" }));
		});
		expect(
			screen.getByRole("button", { name: "닫기 전 추가한 후보 이름 수정" }),
		).toBeTruthy();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "마감" }));
		});
		expectWaitingCandidateCount(13);
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(false);
		expect(screen.queryByRole("button", { name: "슬롯 준비 중" })).toBeNull();
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("preserves chat focus and an unsent message when a host draw reveals its result", () => {
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => ({
				matches: query === "(max-width: 900px)",
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		);
		renderPage(true, "idle");
		fireEvent.click(screen.getByRole("button", { name: "슬롯 돌리기" }));
		act(() => vi.advanceTimersByTime(350));
		const input = screen.getByRole("textbox", { name: "메시지" });
		act(() => input.focus());
		fireEvent.change(input, { target: { value: "추첨 보면서 이야기해요" } });
		expect(screen.getByRole("heading", { name: "슬롯머신" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "채팅" })).toBeTruthy();
		expect(
			screen.queryByRole("navigation", { name: "모바일 추첨방 화면" }),
		).toBeNull();
		act(() => vi.advanceTimersByTime(12000));
		expect(screen.getByText("0명 참여")).toBeTruthy();
		expect(document.activeElement).toBe(input);
		expect((input as HTMLTextAreaElement).value).toBe("추첨 보면서 이야기해요");
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("runs a host draw through the real reveal, then archives it by spinning again", () => {
		renderPage(true, "idle");
		fireEvent.keyDown(screen.getByRole("button", { name: "슬롯 돌리기" }), {
			key: " ",
		});
		expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBeTruthy();
		act(() => vi.advanceTimersByTime(12000));
		expect(
			screen.queryByRole("region", { name: "실시간 투표 현황" }),
		).toBeNull();
		fireEvent.keyUp(window, { key: " " });
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(false);
		act(() => vi.advanceTimersByTime(12000));
		expect(screen.getByText("0명 참여")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "슬롯 돌리기" }));
		expect(
			screen.queryByRole("region", { name: "실시간 투표 현황" }),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "당첨 내역 열기" }));
		expect(
			screen.getAllByRole("button", { name: /상세 기록 열기$/ }),
		).toHaveLength(2);
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("acknowledges the host ballot before starting the next spin and freezes it in the archived round", () => {
		renderPage(true, "result");
		const next = screen.getByRole("button", {
			name: "슬롯 돌리기",
		});
		expect(next.matches(":disabled")).toBe(false);
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(next.matches(":disabled")).toBe(true);
		expect(screen.getByText("8명 참여")).toBeTruthy();
		fireEvent.click(next);
		expect(
			screen.getByRole("region", { name: "실시간 투표 현황" }),
		).toBeTruthy();
		act(() => vi.advanceTimersByTime(140));
		expect(next.matches(":disabled")).toBe(false);
		expect(
			within(
				screen.getByRole("list", { name: "좋아요 투표한 참가자" }),
			).getByText("방장"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(screen.getByRole("heading", { name: /좋아요\s*5/ })).toBeTruthy();
		expect(screen.getByRole("heading", { name: /싫어요\s*3/ })).toBeTruthy();
		expect(screen.getByText("8명 참여")).toBeTruthy();
		fireEvent.click(next);
		expectWaitingCandidateCount(12);
		fireEvent.click(screen.getByRole("button", { name: "당첨 내역 열기" }));
		const entries = screen.getAllByRole("button", { name: /상세 기록 열기$/ });
		fireEvent.click(entries[0]);
		const archived = screen.getByRole("dialog");
		expect(
			within(
				within(archived).getByRole("list", { name: "좋아요 투표한 참가자" }),
			).getByText("방장"),
		).toBeTruthy();
		expect(
			within(archived).queryByRole("button", { name: "좋아요 투표" }),
		).toBeNull();
		expect(
			within(archived).queryByRole("button", {
				name: "슬롯 돌리기",
			}),
		).toBeNull();
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("acknowledges a guest's one-time vote and sends a chat message without contacting a real room", () => {
		renderPage(false, "result");
		fireEvent.click(screen.getByRole("button", { name: "좋아요 투표" }));
		expect(screen.getByText("투표를 보내고 있습니다…")).toBeTruthy();
		expect(screen.getByRole("heading", { name: /좋아요\s*5/ })).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			within(
				screen.getByRole("region", { name: "실시간 투표 현황" }),
			).getByRole("status").className,
		).toBe("sr-only");
		act(() => vi.advanceTimersByTime(140));
		expect(
			screen
				.getByRole("button", { name: "좋아요 투표" })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByRole("heading", { name: /좋아요\s*5/ })).toBeTruthy();
		const voters = screen.getByRole("list", { name: "좋아요 투표한 참가자" });
		expect(within(voters).getByText("지민")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "싫어요 투표" }));
		expect(screen.getByText("8명 참여")).toBeTruthy();
		expect(screen.getByRole("heading", { name: /싫어요\s*3/ })).toBeTruthy();
		const input = screen.getByRole("textbox", { name: "메시지" });
		fireEvent.change(input, { target: { value: "이 메뉴로 가요" } });
		fireEvent.click(screen.getByRole("button", { name: "메시지 보내기" }));
		expect(screen.getByText("이 메뉴로 가요")).toBeTruthy();
		expect((input as HTMLTextAreaElement).value).toBe("");
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("keeps waiting view readonly and applies candidate edits only in the editing stage", async () => {
		renderPage(true, "idle");
		expect(
			screen.queryByRole("complementary", { name: "후보 제외 목록" }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "제외 목록 초기화" }),
		).toBeNull();
		expect(screen.queryByRole("textbox", { name: "1번 후보 이름" })).toBeNull();
		expect(document.querySelector(".room-game-filter")).toBeNull();
		expect(screen.queryByRole("button", { name: "게임 필터" })).toBeNull();
		expect(screen.queryByRole("checkbox", { name: /추첨 포함$/ })).toBeNull();
		expectWaitingCandidateCount(12);
		expect(screen.queryByRole("textbox", { name: "1번 후보 이름" })).toBeNull();
		expect(screen.queryByRole("button", { name: "후보 보기" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const options = screen.getByRole("dialog", { name: "방 설정" });
		expect(
			within(options).queryByRole("button", { name: "변경 적용" }),
		).toBeNull();
		expect(within(options).queryByRole("checkbox")).toBeNull();
		fireEvent.click(
			within(options).getAllByRole("button", { name: "닫기" })[0],
		);
		expect(
			screen
				.getByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" })
				.matches(":disabled"),
		).toBe(false);
		expect(screen.queryByRole("heading", { name: "추첨" })).toBeNull();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "후보" }));
		});
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(screen.queryByRole("region", { name: /게임 옵션$/ })).toBeNull();
		expect(
			screen.queryByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" }),
		).toBeNull();
		expect(
			screen.queryByRole("checkbox", {
				name: "중복 없이 추첨 · 뽑힌 후보 제외",
			}),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "슬롯 돌리기" })).toBeNull();
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(screen.queryByRole("button", { name: "편집하기" })).toBeNull();
		expect(screen.queryByRole("button", { name: "변경 적용" })).toBeNull();
		expect(
			screen.queryByRole("checkbox", {
				name: `${sampleLunchPlaces[0].name} 추첨 포함`,
			}),
		).toBeTruthy();
		fireEvent.change(candidateName(1), {
			target: { value: "필터와 별개로 바꾼 이름" },
		});
		fireEvent.click(filterButton());
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: "필터와 별개로 바꾼 이름 추첨 포함",
			}),
		);
		expect(filterButton().getAttribute("aria-expanded")).toBe("true");
		expect(screen.queryByRole("textbox", { name: "1번 후보 이름" })).toBeNull();
		expect(screen.queryByRole("dialog", { name: "후보 편집" })).toBeNull();
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "마감" }));
		});
		expectWaitingCandidateCount(11);
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(false);
		expect(document.querySelector(".room-game-filter")).toBeNull();
		expect(screen.queryByRole("checkbox", { name: /추첨 포함$/ })).toBeNull();
		expect(fetchRequest).not.toHaveBeenCalled();
	});
	it("keeps source candidates and manual exclusions while category chips are toggled in the editing draft", async () => {
		renderPage(true, "editing");
		fireEvent.click(filterButton());
		const individuallyExcluded = sampleLunchPlaces[0];
		const anotherCategory = sampleLunchPlaces
			.slice(0, 12)
			.find(
				(candidate) => candidate.category !== individuallyExcluded.category,
			)?.category;
		if (!anotherCategory) throw new Error("Expected two preview categories");
		fireEvent.click(
			screen.getByRole("checkbox", {
				name: `${individuallyExcluded.name} 추첨 포함`,
			}),
		);
		const category = screen.getByRole("button", {
			name: `${anotherCategory} 분류 포함`,
		});
		fireEvent.click(category);
		expect(category.getAttribute("aria-pressed")).toBe("false");
		fireEvent.click(category);
		expect(category.getAttribute("aria-pressed")).toBe("true");
		expect(
			(
				screen.getByRole("checkbox", {
					name: `${individuallyExcluded.name} 추첨 포함`,
				}) as HTMLInputElement
			).checked,
		).toBe(false);
		expect(
			within(screen.getByRole("list", { name: "후보 편집 목록" })).getAllByRole(
				"listitem",
			),
		).toHaveLength(12);

		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expectWaitingCandidateCount(11);
		expect(document.querySelector(".room-game-filter")).toBeNull();
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("changes the room name from settings on a result while preserving the round and candidate count", async () => {
		renderPage(true, "result");
		expect(
			screen.getByRole("region", { name: "실시간 투표 현황" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		fireEvent.change(
			within(settings).getByRole("textbox", { name: "방 이름" }),
			{ target: { value: "결과에서 바꾼 방 이름" } },
		);
		await act(async () =>
			fireEvent.click(
				within(settings).getByRole("button", { name: "변경 저장" }),
			),
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "결과에서 바꾼 방 이름" }),
		).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "실시간 투표 현황" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "후보",
				description: /전체 후보 12개 중/,
			}),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "후보" }));
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(
			screen.queryByRole("region", { name: "실시간 투표 현황" }),
		).toBeNull();
	});

	it("changes next-game duplicate exclusion beside the stored excluded candidates", async () => {
		renderPage(true, "result");
		const roomName = screen.getByRole("heading", { level: 1 }).textContent;
		fireEvent.click(screen.getByRole("button", { name: "방 설정" }));
		const settings = screen.getByRole("dialog", { name: "방 설정" });
		expect(within(settings).queryByRole("checkbox")).toBeNull();
		fireEvent.click(
			within(settings).getAllByRole("button", { name: "닫기" })[0],
		);
		const options = screen.getByRole("region", { name: "게임 보드" });
		await act(async () =>
			fireEvent.click(
				within(options).getByRole("switch", {
					name: "중복 없이 추첨 · 뽑힌 후보 제외",
				}),
			),
		);
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
			roomName,
		);
		expect(
			screen.getByRole("region", { name: "실시간 투표 현황" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "슬롯 돌리기" })).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "후보",
				description: /전체 후보 12개 중/,
			}),
		).toBeTruthy();
	});

	it("can finish candidate editing with every candidate drawn and recover the same list in waiting", async () => {
		renderPage(true, "result", 1);
		const switchForDrawn = () =>
			screen.getByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" });
		await act(async () => fireEvent.click(switchForDrawn()));
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(true);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보" })),
		);
		expect(
			screen.queryByRole("switch", { name: "중복 없이 추첨 · 뽑힌 후보 제외" }),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "마감" }).matches(":disabled"),
		).toBe(false);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "마감" })),
		);
		expect(screen.queryByRole("heading", { name: "추첨" })).toBeNull();
		expectWaitingCandidateCount(0);
		expect(switchForDrawn().getAttribute("aria-checked")).toBe("true");
		await act(async () => fireEvent.click(switchForDrawn()));
		expectWaitingCandidateCount(1);
		expect(
			screen
				.getByRole("button", { name: "마지막 후보 확정" })
				.matches(":disabled"),
		).toBe(false);
		await act(async () =>
			fireEvent.click(screen.getByRole("button", { name: "후보" })),
		);
		const candidates = screen.getByRole("list", { name: "후보 편집 목록" });
		expect(within(candidates).getAllByRole("listitem")).toHaveLength(1);
		expect(
			within(candidates).getByRole("button", {
				name: `${sampleLunchPlaces[0].name} 이름 수정`,
			}),
		).toBeTruthy();
		expect(fetchRequest).not.toHaveBeenCalled();
	});

	it("starts a new room on editing and waits for the host to finish before showing the slot machine", async () => {
		renderPage(true, "editing");
		expect(screen.getByRole("heading", { name: "후보 편집" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "슬롯 돌리기" })).toBeNull();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "마감" }));
		});
		expect(
			screen.getByRole("button", { name: "슬롯 돌리기" }).matches(":disabled"),
		).toBe(false);
		expect(screen.queryByRole("button", { name: "슬롯 준비 중" })).toBeNull();
	});
});
