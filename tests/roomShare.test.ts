import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roomEntryInfoPath } from "../src/lib/lunchRoomRequest.server";
import { readRoomShareInfo } from "../src/server/roomShare";

vi.mock("partyserver", () => ({
	getServerByName: vi.fn(),
	routePartykitRequest: vi.fn(),
}));

const roomId = "28a5cbd4-051b-48f8-9e93-c052e4746b39";
const fetchRoom = vi.fn();
const idFromName = vi.fn(() => "room-id");
const get = vi.fn(() => ({ fetch: fetchRoom }));
const env = { LunchRooms: { idFromName, get } } as unknown as Env;

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("server-rendered room share metadata", () => {
	it("reads the authoritative title only without joining or returning private data", async () => {
		fetchRoom.mockResolvedValue(
			Response.json({
				title: "팀 점심",
				hostToken: "secret",
				participants: ["private"],
			}),
		);
		expect(await readRoomShareInfo(roomId, env)).toEqual({
			status: "open",
			title: "팀 점심",
		});
		expect(idFromName).toHaveBeenCalledExactlyOnceWith(roomId);
		const request = fetchRoom.mock.calls[0][0] as Request;
		expect(new URL(request.url).pathname).toBe(roomEntryInfoPath);
		expect(request.method).toBe("GET");
		expect(request.headers.get("x-partykit-room")).toBe(roomId);
	});

	it("rejects invalid identifiers before accessing a room", async () => {
		expect(await readRoomShareInfo("invalid?hostToken=secret", env)).toEqual({
			status: "missing",
		});
		expect(get).not.toHaveBeenCalled();
	});

	it.each([
		[404, "ROOM_NOT_FOUND", "missing"],
		[410, "ROOM_CLOSED", "closed"],
		[410, "ROOM_EXPIRED", "expired"],
		[503, "UNAVAILABLE", "unavailable"],
	] as const)("handles HTTP %s %s safely", async (status, code, expected) => {
		fetchRoom.mockResolvedValue(
			Response.json({ code, title: "古い部屋" }, { status }),
		);
		expect(await readRoomShareInfo(roomId, env)).toEqual({ status: expected });
	});

	it("falls back when the binding fails or returns invalid title data", async () => {
		fetchRoom.mockRejectedValueOnce(new Error("offline"));
		expect(await readRoomShareInfo(roomId, env)).toEqual({
			status: "unavailable",
		});
		fetchRoom.mockResolvedValueOnce(Response.json({ title: "" }));
		expect(await readRoomShareInfo(roomId, env)).toEqual({
			status: "unavailable",
		});
	});

	it("bounds metadata lookup time so an unavailable room cannot hold up the page", async () => {
		vi.useFakeTimers();
		fetchRoom.mockReturnValue(new Promise(() => {}));
		const result = readRoomShareInfo(roomId, env);
		await vi.advanceTimersByTimeAsync(2000);
		expect(await result).toEqual({ status: "unavailable" });
		expect(vi.getTimerCount()).toBe(0);
	});
});
