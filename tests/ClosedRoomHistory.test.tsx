// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ClosedRoomHistory from "../src/components/features/ClosedRoomHistory";
import { getWheelRotation, sampleLunchPlaces } from "../src/lib/lunch";
import type { RoomDraw } from "../src/lib/lunchRoom";

vi.mock("../src/lib/lunchRoomClient", () => ({
	readLunchRoomHost: () => "a".repeat(64),
	readOrCreateLunchRoomGuestToken: () => "b".repeat(64),
}));
const roomId = "12345678-abcd-4abc-8abc-123456789012";
const draw: RoomDraw = {
	id: "archive-round",
	candidates: sampleLunchPlaces.slice(0, 2),
	winnerIndex: 0,
	source: "csprng",
	timestamp: 1000,
	startedAt: 2000,
	durationMs: 4000,
	fromRotation: 0,
	toRotation: getWheelRotation(0, 0, 2),
	listVersion: 1,
	participants: [{ id: "guest", name: "동료", isHost: false }],
	votes: [
		{
			participantId: "guest",
			name: "동료",
			vote: "up",
			reactionMs: 250,
			timestamp: 6250,
		},
	],
};
const fetchMock = vi.fn();
const archive = () => ({
	title: "점심 기록",
	expiresAt: Date.now() + 60000,
	draws: [draw],
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("fetch", fetchMock);
	fetchMock
		.mockReset()
		.mockImplementation(async () => Response.json(archive()));
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
async function show() {
	await act(async () => {
		render(<ClosedRoomHistory roomId={roomId} />);
	});
}

it("reads with a saved private proof and shows immutable details and votes without game actions", async () => {
	await show();
	expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
		hostToken: "a".repeat(64),
	});
	expect(
		screen.getByText(draw.candidates[0].name, { selector: "summary span" }),
	).toBeTruthy();
	fireEvent.click(
		screen.getByText(draw.candidates[0].name, { selector: "summary span" }),
	);
	expect(screen.getByText("추첨 요청 시 참가자")).toBeTruthy();
	expect(screen.getByText("후보와 확률")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "좋아요 투표" })).toBeNull();
	expect(screen.queryByRole("button", { name: "다음 게임" })).toBeNull();
});
it("downloads the current archive as BOM UTF-8 text with candidates, participants and votes", async () => {
	vi.useRealTimers();
	const create = vi.fn((_blob: Blob) => "blob:history");
	const revoke = vi.fn();
	vi.stubGlobal(
		"URL",
		Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }),
	);
	const click = vi
		.spyOn(HTMLAnchorElement.prototype, "click")
		.mockImplementation(() => {});
	await show();
	fireEvent.click(screen.getByRole("button", { name: "TXT 내보내기" }));
	expect(click).toHaveBeenCalledOnce();
	const blob = create.mock.calls[0][0] as Blob;
	const text = await new Promise<string>((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.readAsText(blob);
	});
	expect(text).toContain("점심 기록");
	expect(text).toContain(draw.candidates[0].name);
	expect(text).toContain("동료: 좋아요");
	expect(text).toContain("후보와 확률");
	expect(text).not.toContain("hostToken");
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(revoke).toHaveBeenCalledWith("blob:history");
});
it("removes loaded history and export at the original expiry", async () => {
	await show();
	await act(async () => vi.advanceTimersByTimeAsync(60000));
	expect(screen.getByRole("alert").textContent).toContain("만료");
	expect(screen.queryByRole("button", { name: "TXT 내보내기" })).toBeNull();
});
it("supports retry after a load failure and explains an empty archive", async () => {
	fetchMock.mockRejectedValueOnce(new Error("기록 조회 실패"));
	fetchMock.mockResolvedValueOnce(Response.json({ ...archive(), draws: [] }));
	await show();
	expect(screen.getByRole("alert").textContent).toBe("기록 조회 실패");
	await act(async () =>
		fireEvent.click(screen.getByRole("button", { name: "다시 확인" })),
	);
	expect(screen.getByText("완료된 추첨 기록이 없습니다.")).toBeTruthy();
	expect(fetchMock).toHaveBeenCalledTimes(2);
});
