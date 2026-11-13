// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const roomId = "12345678-abcd-4abc-8abc-123456789012";
const token = "a".repeat(64);
const hostKey = `randomlab:lunch-room-host:${roomId}`;
const guestKey = `randomlab:lunch-room-guest:${roomId}`;
const nameKey = "randomlab:lunch-room-name";
const storageDescriptors = {
	localStorage: Object.getOwnPropertyDescriptor(window, "localStorage"),
	sessionStorage: Object.getOwnPropertyDescriptor(window, "sessionStorage"),
};

function blockStorage(kind: "localStorage" | "sessionStorage") {
	Object.defineProperty(window, kind, {
		configurable: true,
		get() {
			throw new DOMException("Storage unavailable", "SecurityError");
		},
	});
}

beforeEach(() => {
	vi.resetModules();
	window.localStorage.clear();
	window.sessionStorage.clear();
});
afterEach(() => {
	for (const kind of ["localStorage", "sessionStorage"] as const) {
		const descriptor = storageDescriptors[kind];
		if (descriptor) Object.defineProperty(window, kind, descriptor);
	}
	vi.restoreAllMocks();
});

describe("lunch room browser credentials", () => {
	it("only consumes a just-submitted creation intent once for its own room", async () => {
		const client = await import("../src/lib/lunchRoomClient");
		client.prepareLunchRoomEntry(roomId, "  Ｅｒｉｃ  ");
		expect(client.consumeLunchRoomEntry("other-room")).toBeUndefined();
		expect(client.consumeLunchRoomEntry(roomId)).toBe("Eric");
		expect(client.consumeLunchRoomEntry(roomId)).toBeUndefined();
		expect(localStorage.length).toBe(0);
		expect(sessionStorage.length).toBe(0);
	});

	it("does not restore an old creation intent from storage or after its short timeout", async () => {
		const client = await import("../src/lib/lunchRoomClient");
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		client.prepareLunchRoomEntry(roomId, "방장");
		now.mockReturnValue(31000);
		expect(client.consumeLunchRoomEntry(roomId)).toBeUndefined();
		client.prepareLunchRoomEntry(roomId, "방장");
		vi.resetModules();
		const fresh = await import("../src/lib/lunchRoomClient");
		expect(fresh.consumeLunchRoomEntry(roomId)).toBeUndefined();
	});

	it("falls back to a valid session proof when the local proof is corrupt", async () => {
		window.localStorage.setItem(hostKey, "corrupt proof");
		window.sessionStorage.setItem(hostKey, token);
		const client = await import("../src/lib/lunchRoomClient");
		expect(client.readLunchRoomHost(roomId)).toBe(token);
		expect(window.localStorage.getItem(hostKey)).toBe("corrupt proof");
	});

	it("uses a fresh validated stored proof rather than stale memory and retains it as the blocked-storage fallback", async () => {
		const refreshed = "b".repeat(64);
		const client = await import("../src/lib/lunchRoomClient");
		client.saveLunchRoomHost(roomId, token);
		window.localStorage.setItem(hostKey, refreshed);
		expect(client.readLunchRoomHost(roomId)).toBe(refreshed);
		blockStorage("localStorage");
		blockStorage("sessionStorage");
		expect(client.readLunchRoomHost(roomId)).toBe(refreshed);
	});

	it("ignores an invalid local proof even if an older memory proof exists", async () => {
		const refreshed = "c".repeat(64);
		const client = await import("../src/lib/lunchRoomClient");
		client.saveLunchRoomHost(roomId, token);
		window.localStorage.setItem(hostKey, "not a proof");
		window.sessionStorage.setItem(hostKey, refreshed);
		expect(client.readLunchRoomHost(roomId)).toBe(refreshed);
	});

	it("never treats corrupt proofs as host credentials and does not manufacture recovery in a fresh storage scope", async () => {
		window.localStorage.setItem(hostKey, "invalid token");
		window.sessionStorage.setItem(hostKey, "short");
		let client = await import("../src/lib/lunchRoomClient");
		expect(client.readLunchRoomHost(roomId)).toBeUndefined();
		client.saveLunchRoomHost(roomId, token);
		const getItem = vi.fn(() => null);
		const setItem = vi.fn();
		for (const kind of ["localStorage", "sessionStorage"] as const)
			Object.defineProperty(window, kind, {
				configurable: true,
				value: { getItem, setItem },
			});
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readLunchRoomHost(roomId)).toBeUndefined();
		expect(getItem).toHaveBeenCalledWith(hostKey);
		expect(setItem).not.toHaveBeenCalled();
	});

	it("migrates a stored20-unit legacy nickname to12 without splitting the last emoji", async () => {
		const legacyName = `${"가".repeat(11)}😀${"나".repeat(7)}`;
		window.localStorage.setItem(nameKey, legacyName);
		const client = await import("../src/lib/lunchRoomClient");
		expect(client.readLunchRoomName()).toBe("가".repeat(11));
		for (const storage of [window.localStorage, window.sessionStorage])
			expect(storage.getItem(nameKey)).toBe("가".repeat(11));
		client.saveLunchRoomName("😀".repeat(6));
		expect(client.readLunchRoomName()).toBe("😀".repeat(6));
		client.saveLunchRoomName("가".repeat(13));
		expect(client.readLunchRoomName()).toBe("😀".repeat(6));
	});
	it("shares a distinct private guest proof per room through local storage and restores it on reload", async () => {
		let client = await import("../src/lib/lunchRoomClient");
		const proof = client.readOrCreateLunchRoomGuestToken(roomId);
		expect(proof).toMatch(/^[0-9a-f]{64}$/);
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(proof);
		expect(window.sessionStorage.getItem(guestKey)).toBe(proof);
		expect(window.localStorage.getItem(guestKey)).toBe(proof);
		const otherId = "22345678-abcd-4abc-8abc-123456789012";
		expect(client.readOrCreateLunchRoomGuestToken(otherId)).not.toBe(proof);
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(proof);
	});

	it("restores the same guest identity in a fresh tab with separate session storage", async () => {
		let client = await import("../src/lib/lunchRoomClient");
		const proof = client.readOrCreateLunchRoomGuestToken(roomId);
		window.sessionStorage.clear();
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(proof);
		expect(window.sessionStorage.getItem(guestKey)).toBe(proof);
	});

	it("prefers the shared canonical guest proof over stale memory and session proofs", async () => {
		const client = await import("../src/lib/lunchRoomClient");
		const original = client.readOrCreateLunchRoomGuestToken(roomId);
		const canonical = "c".repeat(64);
		expect(original).not.toBe(canonical);
		window.localStorage.setItem(guestKey, canonical);
		window.sessionStorage.setItem(guestKey, "d".repeat(64));
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(canonical);
		expect(window.sessionStorage.getItem(guestKey)).toBe(canonical);
		blockStorage("localStorage");
		blockStorage("sessionStorage");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(canonical);
	});

	it("migrates a valid legacy session guest proof without replacing its identity", async () => {
		window.sessionStorage.setItem(guestKey, token);
		const client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(token);
		expect(window.localStorage.getItem(guestKey)).toBe(token);
	});

	it("uses a valid session guest proof when the shared value is corrupt", async () => {
		window.localStorage.setItem(guestKey, "corrupt proof");
		window.sessionStorage.setItem(guestKey, token);
		const client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(token);
		expect(window.localStorage.getItem(guestKey)).toBe(token);
	});

	it("replaces an invalid guest proof and rejects invalid room IDs", async () => {
		window.localStorage.setItem(guestKey, "bad shared token");
		window.sessionStorage.setItem(guestKey, "bad token");
		const client = await import("../src/lib/lunchRoomClient");
		const proof = client.readOrCreateLunchRoomGuestToken(roomId);
		expect(proof).toMatch(/^[0-9a-f]{64}$/);
		expect(window.localStorage.getItem(guestKey)).toBe(proof);
		expect(window.sessionStorage.getItem(guestKey)).toBe(proof);
		expect(() => client.readOrCreateLunchRoomGuestToken("invalid")).toThrow();
	});

	it("keeps shared guest identity when session storage is blocked", async () => {
		blockStorage("sessionStorage");
		let client = await import("../src/lib/lunchRoomClient");
		const proof = client.readOrCreateLunchRoomGuestToken(roomId);
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(proof);
		expect(window.localStorage.getItem(guestKey)).toBe(proof);
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(proof);
	});

	it("falls back to the legacy session guest identity on reload when local storage is blocked", async () => {
		window.sessionStorage.setItem(guestKey, token);
		blockStorage("localStorage");
		let client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(token);
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(token);
	});

	it("keeps guest reconnect identity in memory when both storage APIs are blocked", async () => {
		blockStorage("localStorage");
		blockStorage("sessionStorage");
		const client = await import("../src/lib/lunchRoomClient");
		const proof = client.readOrCreateLunchRoomGuestToken(roomId);
		expect(proof).toMatch(/^[0-9a-f]{64}$/);
		expect(client.readOrCreateLunchRoomGuestToken(roomId)).toBe(proof);
	});

	it("saves validated host credentials and a trimmed nickname in both stores and restores them after a module reload", async () => {
		let client = await import("../src/lib/lunchRoomClient");
		expect(client.saveLunchRoomHost(roomId, token)).toBe(true);
		client.saveLunchRoomName("  에릭  ");
		for (const storage of [window.localStorage, window.sessionStorage]) {
			expect(storage.getItem(hostKey)).toBe(token);
			expect(storage.getItem(nameKey)).toBe("에릭");
		}
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readLunchRoomHost(roomId)).toBe(token);
		expect(client.readLunchRoomName()).toBe("에릭");
	});

	it("uses session storage when local storage is unavailable, including a later reload", async () => {
		blockStorage("localStorage");
		let client = await import("../src/lib/lunchRoomClient");
		expect(client.saveLunchRoomHost(roomId, token)).toBe(true);
		client.saveLunchRoomName("세션 이름");
		expect(window.sessionStorage.getItem(hostKey)).toBe(token);
		vi.resetModules();
		client = await import("../src/lib/lunchRoomClient");
		expect(client.readLunchRoomHost(roomId)).toBe(token);
		expect(client.readLunchRoomName()).toBe("세션 이름");
	});

	it("keeps credentials in memory for SPA navigation when both storage APIs are blocked", async () => {
		blockStorage("localStorage");
		blockStorage("sessionStorage");
		const client = await import("../src/lib/lunchRoomClient");
		expect(client.saveLunchRoomHost(roomId, token)).toBe(false);
		client.saveLunchRoomName("메모리 이름");
		expect(client.readLunchRoomHost(roomId)).toBe(token);
		expect(client.readLunchRoomName()).toBe("메모리 이름");
	});

	it("rejects invalid new inputs without overwriting valid stored credentials or a valid nickname", async () => {
		const client = await import("../src/lib/lunchRoomClient");
		client.saveLunchRoomHost(roomId, token);
		client.saveLunchRoomName("기존 이름");
		expect(client.saveLunchRoomHost("not-a-room-id", token)).toBe(false);
		expect(client.saveLunchRoomHost(roomId, "bad token")).toBe(false);
		client.saveLunchRoomName(" ");
		client.saveLunchRoomName("가".repeat(21));
		expect(client.readLunchRoomHost("not-a-room-id")).toBeUndefined();
		expect(client.readLunchRoomHost(roomId)).toBe(token);
		expect(client.readLunchRoomName()).toBe("기존 이름");
		expect(window.localStorage.getItem(hostKey)).toBe(token);
		expect(window.localStorage.getItem(nameKey)).toBe("기존 이름");
	});
});
