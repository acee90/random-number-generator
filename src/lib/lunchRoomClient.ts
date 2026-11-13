import {
	clampLunchRoomNickname,
	isLunchRoomId,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
} from "./lunchRoom";

const hosts = new Map<string, string>();
const guests = new Map<string, string>();
const preparedEntries = new Map<string, { name: string; expiresAt: number }>();
let nickname: string | undefined;
const nameKey = "randomlab:lunch-room-name";
const hostKey = (roomId: string) => `randomlab:lunch-room-host:${roomId}`;
const guestKey = (roomId: string) => `randomlab:lunch-room-guest:${roomId}`;
const validToken = (value: unknown): value is string =>
	typeof value === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(value);

function read(key: string): string | undefined {
	for (const kind of ["localStorage", "sessionStorage"] as const) {
		try {
			const value = window[kind].getItem(key);
			if (value) return value;
		} catch {
			// Memory still allows navigation to the room when storage is unavailable.
		}
	}
}

function save(key: string, value: string): boolean {
	let persisted = false;
	for (const kind of ["localStorage", "sessionStorage"] as const) {
		try {
			window[kind].setItem(key, value);
			persisted = true;
		} catch {
			// Some private browsing contexts reject storage writes.
		}
	}
	return persisted;
}

export function saveLunchRoomHost(roomId: string, token: string): boolean {
	if (!isLunchRoomId(roomId) || !validToken(token)) return false;
	hosts.set(roomId, token);
	return save(hostKey(roomId), token);
}

export function readLunchRoomHost(roomId: string): string | undefined {
	if (!isLunchRoomId(roomId)) return;
	for (const kind of ["localStorage", "sessionStorage"] as const) {
		try {
			const value = window[kind].getItem(hostKey(roomId));
			if (validToken(value)) {
				hosts.set(roomId, value);
				return value;
			}
		} catch {
			// Validate the other store before falling back to this page's memory.
		}
	}
	const cached = hosts.get(roomId);
	if (validToken(cached)) return cached;
}

/** A private reconnect proof, scoped to this tab's session and never an invite URL. */
export function readOrCreateLunchRoomGuestToken(roomId: string): string {
	if (!isLunchRoomId(roomId)) throw new Error("Invalid lunch room ID");
	const cached = guests.get(roomId);
	if (cached) return cached;
	try {
		const stored = window.sessionStorage.getItem(guestKey(roomId));
		if (validToken(stored)) {
			guests.set(roomId, stored);
			return stored;
		}
	} catch {
		// Memory retains identity across socket reconnects when storage is blocked.
	}
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const token = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	guests.set(roomId, token);
	try {
		window.sessionStorage.setItem(guestKey(roomId), token);
	} catch {
		// Reloads may use a new identity when session storage is unavailable.
	}
	return token;
}

export function saveLunchRoomName(name: string): void {
	const value = name.trim();
	if (!value || value.length > lunchRoomLimits.maxNicknameLength) return;
	nickname = value;
	save(nameKey, value);
}

export function readLunchRoomName(): string | undefined {
	const value = (nickname ?? read(nameKey))?.trim();
	if (value && value.length <= 20) {
		const normalized = clampLunchRoomNickname(value);
		if (!normalized) return;
		if (normalized !== value) saveLunchRoomName(normalized);
		return normalized;
	}
}

/** Only a just-submitted creation form can skip a second nickname prompt. */
export function prepareLunchRoomEntry(roomId: string, name: string): void {
	const value = normalizeLunchRoomNickname(name);
	if (!isLunchRoomId(roomId) || !value) return;
	preparedEntries.set(roomId, { name: value, expiresAt: Date.now() + 30000 });
}

export function consumeLunchRoomEntry(roomId: string): string | undefined {
	const entry = preparedEntries.get(roomId);
	preparedEntries.delete(roomId);
	if (entry && Date.now() < entry.expiresAt) return entry.name;
}
