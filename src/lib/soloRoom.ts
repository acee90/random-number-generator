import {
	type CreateRoomInput,
	isLunchRoomId,
	parseRoomDrawHistory,
	parseRoomSnapshot,
	type RoomSnapshot,
	resolveCandidateIds,
} from "./lunchRoom";
import { createRoomSnapshot } from "./roomGame";

const prefix = "randomlab:solo-room:v1:";
export const soloHistoryKey = "randomlab:solo-draws:v1";
// Keep a room usable for this page visit if the browser rejects storage writes.
const unsaved = new Map<string, RoomSnapshot>();

function removeFromStores(key: string) {
	for (const store of [localStorage, sessionStorage]) {
		try {
			store.removeItem(key);
		} catch {
			// Expiration is also checked on every read.
		}
	}
}

export function saveSoloRoom(room: RoomSnapshot): boolean {
	try {
		localStorage.setItem(prefix + room.roomId, JSON.stringify(room));
		unsaved.delete(room.roomId);
		try {
			sessionStorage.removeItem(prefix + room.roomId);
		} catch {
			// Legacy tab storage cleanup is best-effort.
		}
		return true;
	} catch {
		unsaved.set(room.roomId, room);
		return false;
	}
}

export function forgetSoloRoom(roomId: string) {
	unsaved.delete(roomId);
	removeFromStores(prefix + roomId);
}

export function readSoloRoom(roomId: string) {
	if (!isLunchRoomId(roomId)) return null;
	let snapshot = unsaved.get(roomId);
	const storageFailed = Boolean(snapshot);
	let fromLegacySession = false;
	if (!snapshot) {
		try {
			let raw = localStorage.getItem(prefix + roomId);
			if (!raw) {
				raw = sessionStorage.getItem(prefix + roomId);
				fromLegacySession = Boolean(raw);
			}
			if (!raw) return null;
			snapshot = parseRoomSnapshot(JSON.parse(raw)) ?? undefined;
		} catch {
			return null;
		}
	}
	if (
		!snapshot ||
		snapshot.roomId !== roomId ||
		snapshot.participants.length !== 1 ||
		!snapshot.participants[0].isHost
	)
		return null;
	if (snapshot.expiresAt <= Date.now()) {
		forgetSoloRoom(roomId);
		return null;
	}
	if (fromLegacySession) saveSoloRoom(snapshot);
	// A pending random request belongs to the previous page. A chosen draw,
	// including its original reveal time, is safe to resume after a refresh.
	if (snapshot.status === "fetching")
		snapshot = { ...snapshot, status: "waiting" };
	return { snapshot, storageFailed };
}

export function createSoloRoom(input: CreateRoomInput) {
	const now = Date.now();
	for (const [id, room] of unsaved) {
		if (room.expiresAt <= now) forgetSoloRoom(id);
	}
	for (const store of [localStorage, sessionStorage]) {
		try {
			for (const key of Object.keys(store)) {
				if (!key.startsWith(prefix)) continue;
				const raw = store.getItem(key);
				if (!raw) continue;
				try {
					if (JSON.parse(raw)?.expiresAt <= now) store.removeItem(key);
				} catch {
					// One unreadable room must not prevent cleanup of other rooms.
				}
			}
		} catch {
			// Restricted storage still supports creating a room in memory.
		}
	}
	const room = createRoomSnapshot(
		crypto.randomUUID(),
		now,
		input,
		input.candidates ?? resolveCandidateIds(input.candidateIds, 0) ?? [],
	);
	room.participants = [
		{ id: crypto.randomUUID(), name: input.hostName, isHost: true },
	];
	saveSoloRoom(room);
	return room;
}

export function readPreviousSoloDraws() {
	try {
		const raw = localStorage.getItem(soloHistoryKey);
		const draws = raw ? parseRoomDrawHistory(JSON.parse(raw)) : [];
		if (draws) return { draws, failed: false };
	} catch {
		// Keep legacy records intact even when unreadable.
	}
	return { draws: [], failed: true };
}
