import { describe, expect, it } from "vitest";
import {
	readRecentLunchRooms,
	recentRoomsKey,
	removeRecentLunchRoom,
	saveRecentLunchRoom,
} from "../src/lib/recentRooms";

function memoryStorage(initial: Record<string, string> = {}) {
	const store = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
	};
}

const roomA = "11111111-1111-4111-8111-111111111111";
const roomB = "22222222-2222-4222-8222-222222222222";
const roomC = "33333333-3333-4333-8333-333333333333";
const roomD = "44444444-4444-4444-8444-444444444444";

describe("recent lunch rooms storage", () => {
	it("saves, deduplicates, limits to 3, and prunes expired rooms", () => {
		const storage = memoryStorage();
		const now = 1_700_000_000_000;
		expect(
			saveRecentLunchRoom(
				{ roomId: roomA, title: "첫 방", role: "host", expiresAt: now + 5_000 },
				now,
				storage,
			),
		).toBe(true);
		expect(
			saveRecentLunchRoom(
				{
					roomId: roomB,
					title: "두 번째 방",
					role: "guest",
					expiresAt: now + 60_000,
				},
				now + 100,
				storage,
			),
		).toBe(true);
		expect(
			saveRecentLunchRoom(
				{
					roomId: roomC,
					title: "세 번째 방",
					role: "host",
					expiresAt: now + 60_000,
				},
				now + 200,
				storage,
			),
		).toBe(true);
		expect(
			saveRecentLunchRoom(
				{
					roomId: roomD,
					title: "네 번째 방",
					role: "host",
					expiresAt: now + 60_000,
				},
				now + 300,
				storage,
			),
		).toBe(true);
		expect(
			readRecentLunchRooms(now + 400, storage).map((room) => room.roomId),
		).toEqual([roomD, roomC, roomB]);
		expect(removeRecentLunchRoom(roomC, now + 500, storage)).toBe(true);
		expect(
			readRecentLunchRooms(now + 500, storage).map((room) => room.roomId),
		).toEqual([roomD, roomB]);
		expect(readRecentLunchRooms(now + 70_000, storage)).toEqual([]);
	});

	it("returns empty safely on corrupt storage data", () => {
		const storage = memoryStorage({ [recentRoomsKey]: "{not-json" });
		expect(readRecentLunchRooms(1_700_000_000_000, storage)).toEqual([]);
	});
});
