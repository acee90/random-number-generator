import { isLunchRoomId, lunchRoomLimits } from "./lunchRoom";

export const recentRoomsKey = "jeommechu:recent-rooms:v1";

export type RecentLunchRoom = {
	roomId: string;
	title: string;
	role: "host" | "guest";
	expiresAt: number;
	visitedAt: number;
};

const maximumRecentRooms = 3;
const defaultRoomLifetimeMs = 24 * 60 * 60 * 1000;
const invalidCharacters = /[\p{Cc}\p{Cf}\p{Cs}]/u;

type RecentRoomStorage = Pick<Storage, "getItem" | "setItem">;

function parseEntry(value: unknown): RecentLunchRoom | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.roomId !== "string" ||
		!isLunchRoomId(record.roomId) ||
		typeof record.title !== "string" ||
		!record.title.trim() ||
		record.title.length > lunchRoomLimits.maxTitleLength ||
		invalidCharacters.test(record.title) ||
		(record.role !== "host" && record.role !== "guest") ||
		typeof record.expiresAt !== "number" ||
		!Number.isSafeInteger(record.expiresAt) ||
		typeof record.visitedAt !== "number" ||
		!Number.isSafeInteger(record.visitedAt)
	)
		return null;
	return {
		roomId: record.roomId,
		title: record.title.trim(),
		role: record.role,
		expiresAt: record.expiresAt,
		visitedAt: record.visitedAt,
	};
}

function parseList(raw: string | null): RecentLunchRoom[] | null {
	if (raw === null) return [];
	if (raw.length > 10000) return null;
	const decoded: unknown = JSON.parse(raw);
	if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
		return null;
	const record = decoded as Record<string, unknown>;
	if (record.version !== 1 || !Array.isArray(record.rooms)) return null;
	const entries: RecentLunchRoom[] = [];
	const seen = new Set<string>();
	for (const item of record.rooms) {
		const parsed = parseEntry(item);
		if (!parsed || seen.has(parsed.roomId)) continue;
		seen.add(parsed.roomId);
		entries.push(parsed);
	}
	return entries;
}

export function readRecentLunchRooms(
	now = Date.now(),
	storage?: Pick<Storage, "getItem">,
): RecentLunchRoom[] {
	if (!storage && typeof window === "undefined") return [];
	try {
		const target = storage ?? window.localStorage;
		const parsed = parseList(target.getItem(recentRoomsKey));
		if (!parsed) return [];
		return parsed
			.filter((entry) => entry.expiresAt > now)
			.sort((a, b) => b.visitedAt - a.visitedAt)
			.slice(0, maximumRecentRooms);
	} catch {
		return [];
	}
}

export function saveRecentLunchRoom(
	room: {
		roomId: string;
		title: string;
		role: "host" | "guest";
		expiresAt?: number;
	},
	now = Date.now(),
	storage?: RecentRoomStorage,
): boolean {
	if (!isLunchRoomId(room.roomId)) return false;
	const title = room.title.normalize("NFC").trim();
	if (
		!title ||
		title.length > lunchRoomLimits.maxTitleLength ||
		invalidCharacters.test(title)
	)
		return false;
	const expiresAt = room.expiresAt ?? now + defaultRoomLifetimeMs;
	if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
	if (!storage && typeof window === "undefined") return false;
	try {
		const target = storage ?? window.localStorage;
		const existing = readRecentLunchRooms(now, target);
		const next: RecentLunchRoom[] = [
			{
				roomId: room.roomId,
				title,
				role: room.role,
				expiresAt,
				visitedAt: now,
			},
			...existing.filter((entry) => entry.roomId !== room.roomId),
		].slice(0, maximumRecentRooms);
		target.setItem(recentRoomsKey, JSON.stringify({ version: 1, rooms: next }));
		return true;
	} catch {
		return false;
	}
}

export function removeRecentLunchRoom(
	roomId: string,
	now = Date.now(),
	storage?: RecentRoomStorage,
): boolean {
	if (!isLunchRoomId(roomId)) return false;
	if (!storage && typeof window === "undefined") return false;
	try {
		const target = storage ?? window.localStorage;
		const existing = readRecentLunchRooms(now, target);
		const next = existing.filter((entry) => entry.roomId !== roomId);
		target.setItem(recentRoomsKey, JSON.stringify({ version: 1, rooms: next }));
		return true;
	} catch {
		return false;
	}
}
