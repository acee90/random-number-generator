import type { Connection } from "partyserver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	lunchRoomLimits,
	parseServerMessage,
	type RoomSnapshot,
	type ServerMessage,
} from "../src/lib/lunchRoom";
import { LunchRoomServer, type RoomEnv } from "../src/rooms/LunchRoomServer";
import { consumeFromPool } from "../src/services/seedPool";

vi.mock("../src/services/seedPool", () => ({ consumeFromPool: vi.fn() }));
vi.mock("partyserver", () => ({
	Server: class {
		constructor(
			protected ctx: HarnessContext,
			protected env: unknown,
		) {}
		get name() {
			return this.ctx.id.name;
		}
		getConnections() {
			return [...this.ctx.sockets].filter((socket) => !socket.closed);
		}
	},
}));

interface TestSocketState {
	socketId: string;
	connectedAt: number;
	participant?: { id: string; name: string; isHost: boolean };
	lastChatAt?: number;
	lastActiveAt?: number;
	closing?: boolean;
}

class TestSocket {
	state: TestSocketState | null = null;
	closed = false;
	closeCode?: number;
	sent: string[] = [];
	constructor(public id = "client-controlled-id") {}
	setState(value: unknown) {
		this.state = structuredClone(value) as TestSocketState;
		return this.state;
	}
	send(value: string) {
		this.sent.push(value);
	}
	close(code: number) {
		this.closed = true;
		this.closeCode = code;
	}
}

class TestStorage {
	values = new Map<string, unknown>();
	alarm: number | null = null;
	deleteCount = 0;
	async get<T>(key: string): Promise<T | undefined> {
		return structuredClone(this.values.get(key)) as T | undefined;
	}
	async put(key: string, value: unknown) {
		this.values.set(key, structuredClone(value));
	}
	async setAlarm(value: number | Date) {
		this.alarm = Number(value);
	}
	async deleteAlarm() {
		this.alarm = null;
	}
	async deleteAll() {
		this.values.clear();
		this.deleteCount++;
	}
}

class HarnessContext {
	id = { name: "12345678-abcd-4abc-8abc-123456789012" };
	storage = new TestStorage();
	sockets = new Set<TestSocket>();
	tasks: Promise<unknown>[] = [];
	waitUntil(task: Promise<unknown>) {
		this.tasks.push(task);
	}
	async drain() {
		await Promise.all(this.tasks.splice(0));
	}
}

const hostToken = "a".repeat(64);
const candidates = sampleLunchPlaces.slice(0, 3);
const entropy = vi.mocked(consumeFromPool);

function socketConnection(socket: TestSocket) {
	return socket as unknown as Connection<TestSocketState>;
}
function createServer(context: HarnessContext) {
	return new LunchRoomServer(
		context as unknown as DurableObjectState,
		{} as RoomEnv,
	);
}
function messages(socket: TestSocket): ServerMessage[] {
	return socket.sent.map((raw) => {
		const parsed = parseServerMessage(raw);
		expect(parsed, `Malformed server message: ${raw}`).not.toBeNull();
		return parsed as ServerMessage;
	});
}
function latestSnapshot(socket: TestSocket) {
	const snapshots = messages(socket).filter(
		(message) => message.type === "snapshot",
	);
	const latest = snapshots.at(-1);
	if (!latest || latest.type !== "snapshot")
		throw new Error("Expected room snapshot");
	return latest;
}
function hasError(socket: TestSocket, code: string) {
	return messages(socket).some(
		(message) => message.type === "error" && message.code === code,
	);
}
function systemEvents(socket: TestSocket, event?: string) {
	return latestSnapshot(socket).snapshot.messages.filter(
		(message) => message.event && (!event || message.event === event),
	);
}
function member(socket: TestSocket, id = latestSnapshot(socket).self?.id) {
	const value = latestSnapshot(socket).snapshot.members?.find(
		(entry) => entry.id === id,
	);
	if (!value) throw new Error("Expected roster member");
	return value;
}
async function send(
	server: LunchRoomServer,
	socket: TestSocket,
	message: unknown,
) {
	await server.onMessage(socketConnection(socket), JSON.stringify(message));
}
async function connect(
	server: LunchRoomServer,
	context: HarnessContext,
	name?: string,
	token?: string,
	id?: string,
	guestToken?: string,
) {
	const socket = new TestSocket(id);
	context.sockets.add(socket);
	await server.onConnect(socketConnection(socket));
	if (name && !socket.closed)
		await send(server, socket, {
			type: "join",
			name,
			...(token ? { hostToken: token } : {}),
			...(guestToken ? { guestToken } : {}),
		});
	return socket;
}
async function room() {
	const context = new HarnessContext();
	const server = createServer(context);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(hostToken),
	);
	const hostTokenHash = Array.from(new Uint8Array(digest), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
	await server.onStart();
	const input = {
		roomId: context.id.name,
		title: "오늘의 점심",
		hostTokenHash,
		candidateIds: candidates.map((place) => place.id),
		createdAt: Date.now(),
	};
	await server.initialize(input);
	return { context, server, input };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-11-13T03:00:00Z"));
	entropy.mockReset().mockResolvedValue({ numbers: [1], source: "quantum" });
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("LunchRoomServer", () => {
	it("rejects13-unit nicknames on initial joins and renames without changing identity or privileges", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const invalid = await connect(server, context, "가".repeat(13));
		expect(hasError(invalid, "INVALID_NICKNAME")).toBe(true);
		expect(invalid.state?.participant).toBeUndefined();
		await send(server, host, { type: "join", name: "가".repeat(13) });
		expect(hasError(host, "INVALID_NICKNAME")).toBe(true);
		expect(host.state?.participant?.name).toBe("방장");
		await send(server, host, { type: "join", name: "😀".repeat(6) });
		expect(host.state?.participant?.name).toBe("😀".repeat(6));
		expect(host.state?.participant?.isHost).toBe(true);
		expect(entropy).not.toHaveBeenCalled();
	});

	it("serializes simultaneous joins and rejects equivalent active nicknames without exposing a snapshot", async () => {
		const { server, context } = await room();
		const first = await connect(server, context);
		const second = await connect(server, context);
		await Promise.all([
			send(server, first, {
				type: "join",
				name: " Ａlice ",
				guestToken: "a-distinct-guest-token",
				updateName: true,
			}),
			send(server, second, {
				type: "join",
				name: "alice",
				guestToken: "another-guest-token",
				updateName: true,
			}),
		]);
		expect(first.state?.participant?.name).toBe("Alice");
		expect(second.state?.participant).toBeUndefined();
		expect(messages(second)).toEqual([
			{
				type: "error",
				code: "NICKNAME_TAKEN",
				message: "이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.",
			},
		]);
		expect(second.closed).toBe(false);
		await send(server, second, {
			type: "join",
			name: "Bob",
			guestToken: "another-guest-token",
			updateName: true,
		});
		expect(latestSnapshot(second).snapshot.participants).toHaveLength(2);
		expect(latestSnapshot(second).self?.isHost).toBe(false);
	});

	it("blocks collisions with away participants and rejects renames without altering either identity", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "동료");
		const hostId = latestSnapshot(host).self?.id;
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs);
		await server.onAlarm();
		expect(member(guest, hostId).status).toBe("away");
		const before = latestSnapshot(guest).snapshot.messages;
		await send(server, guest, {
			type: "join",
			name: " 방장 ",
			hostToken,
			updateName: true,
		});
		expect(hasError(guest, "NICKNAME_TAKEN")).toBe(true);
		expect(guest.state?.participant).toMatchObject({
			name: "동료",
			isHost: false,
		});
		expect(host.state?.participant).toMatchObject({
			name: "방장",
			isHost: true,
		});
		expect(latestSnapshot(host).snapshot.messages).toEqual(before);
		const duplicate = await connect(server, context, "방장");
		expect(duplicate.state?.participant).toBeUndefined();
		expect(hasError(duplicate, "NICKNAME_TAKEN")).toBe(true);
		await send(server, guest, { type: "join", name: "동료", updateName: true });
		expect(guest.state?.participant?.name).toBe("동료");
	});

	it("allows offline nickname reuse and requires a returning host to choose an available name without losing ownership", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "점심대장", hostToken);
		const hostId = latestSnapshot(host).self?.id;
		host.closed = true;
		await server.onClose(socketConnection(host));
		const guest = await connect(server, context, "점심대장");
		expect(latestSnapshot(guest).self?.isHost).toBe(false);
		const restored = createServer(context);
		await restored.onStart();
		const returning = await connect(restored, context, "점심대장", hostToken);
		expect(returning.state?.participant).toBeUndefined();
		expect(hasError(returning, "NICKNAME_TAKEN")).toBe(true);
		await send(restored, returning, {
			type: "join",
			name: "돌아온대장",
			hostToken,
			updateName: true,
		});
		expect(latestSnapshot(returning).self).toEqual({
			id: hostId,
			isHost: true,
		});
		expect(returning.state?.participant?.name).toBe("돌아온대장");
		await send(restored, returning, {
			type: "start",
			id: "returned-host-draw",
		});
		await context.drain();
		expect(latestSnapshot(returning).snapshot.status).toBe("drawing");
	});

	it("shares explicit entry name changes across authenticated guest tabs while stale reconnects retain the latest name", async () => {
		const { server, context } = await room();
		const token = "returning-guest-proof";
		const first = await connect(
			server,
			context,
			"원래이름",
			undefined,
			undefined,
			token,
		);
		const id = latestSnapshot(first).self?.id;
		const second = await connect(server, context);
		await send(server, second, {
			type: "join",
			name: "새이름",
			guestToken: token,
			updateName: true,
		});
		expect(first.state?.participant?.name).toBe("새이름");
		expect(latestSnapshot(second).self).toEqual({ id, isHost: false });
		expect(latestSnapshot(second).snapshot.participants).toHaveLength(1);
		const stale = await connect(
			server,
			context,
			"원래이름",
			undefined,
			undefined,
			token,
		);
		expect(stale.state?.participant?.name).toBe("새이름");
		expect(latestSnapshot(stale).snapshot.participants).toHaveLength(1);
		expect(systemEvents(stale, "renamed")).toHaveLength(1);
	});

	it("returns specific nickname validation errors before admitting or renaming a participant", async () => {
		const { server, context } = await room();
		const pending = await connect(server, context);
		for (const name of ["", "   ", "안\n녕", "\u200b", "가".repeat(13)]) {
			await send(server, pending, { type: "join", name, updateName: true });
			expect(messages(pending).at(-1)).toMatchObject({
				type: "error",
				code: "INVALID_NICKNAME",
			});
			expect(pending.state?.participant).toBeUndefined();
		}
		expect(
			messages(pending).some((message) => message.type === "snapshot"),
		).toBe(false);
		await send(server, pending, {
			type: "join",
			name: "정상",
			updateName: true,
		});
		expect(pending.state?.participant?.name).toBe("정상");
		await send(server, pending, { type: "join", name: "\u200b" });
		expect(pending.state?.participant?.name).toBe("정상");
	});

	it("migrates current20-unit names on wake and guest resume while preserving historical names and IDs", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guestToken = "d".repeat(64);
		const guest = await connect(
			server,
			context,
			"손님",
			undefined,
			undefined,
			guestToken,
		);
		const guestId = latestSnapshot(guest).self?.id;
		await send(server, host, {
			type: "start",
			id: "before-nickname-migration",
		});
		await context.drain();
		vi.advanceTimersByTime(8700);
		await server.onAlarm();
		const hostName = "호".repeat(20);
		const guestName = `${"가".repeat(11)}😀${"나".repeat(7)}`;
		const stored = structuredClone(
			context.storage.values.get("lunch-room:v1"),
		) as {
			snapshot: RoomSnapshot;
			hostName: string;
			hostParticipantId: string;
		};
		stored.hostName = hostName;
		stored.snapshot.members = stored.snapshot.members?.map((member) => ({
			...member,
			name: member.isHost ? hostName : guestName,
		}));
		for (const draw of [stored.snapshot.draw, ...stored.snapshot.history]) {
			if (draw?.participants)
				draw.participants = draw.participants.map((participant) => ({
					...participant,
					name: participant.isHost ? hostName : guestName,
				}));
		}
		if (stored.snapshot.draw)
			stored.snapshot.history = [structuredClone(stored.snapshot.draw)];
		stored.snapshot.messages.push({
			id: "legacy-message",
			participantId: guestId as string,
			name: guestName,
			text: "당시 메시지",
			timestamp: Date.now(),
		});
		const oldHistory = structuredClone(stored.snapshot.history);
		const oldDraw = structuredClone(stored.snapshot.draw);
		for (const socket of [host, guest]) {
			if (!socket.state?.participant)
				throw new Error("Expected attached participant");
			socket.setState({
				...socket.state,
				participant: {
					...socket.state.participant,
					name: socket === host ? hostName : guestName,
				},
			});
		}
		context.storage.values.set("lunch-room:v1", stored);
		const restored = createServer(context);
		await restored.onStart();
		const current = latestSnapshot(host).snapshot;
		expect(host.state?.participant?.name).toBe("호".repeat(12));
		expect(guest.state?.participant?.name).toBe("가".repeat(11));
		expect(current.members?.every((member) => member.name.length <= 12)).toBe(
			true,
		);
		expect(current.history).toEqual(oldHistory);
		expect(current.draw).toEqual(oldDraw);
		expect(
			current.messages.find((message) => message.id === "legacy-message")?.name,
		).toBe(guestName);
		expect(
			(context.storage.values.get("lunch-room:v1") as { hostName: string })
				.hostName,
		).toBe("호".repeat(12));
		guest.closed = true;
		await restored.onClose(socketConnection(guest));
		const resumed = await connect(
			restored,
			context,
			"새 탭 이름",
			undefined,
			undefined,
			guestToken,
		);
		expect(latestSnapshot(resumed).self?.id).toBe(guestId);
		expect(resumed.state?.participant).toMatchObject({
			name: "가".repeat(11),
			isHost: false,
		});
		await send(restored, resumed, {
			type: "start",
			id: "cannot-escalate-after-migration",
		});
		expect(hasError(resumed, "HOST_REQUIRED")).toBe(true);
		await send(restored, host, {
			type: "start",
			id: "after-nickname-migration",
		});
		await context.drain();
		expect(
			latestSnapshot(host).snapshot.draw?.participants?.map(
				(participant) => participant.name,
			),
		).toEqual(["호".repeat(12), "가".repeat(11)]);
		expect(latestSnapshot(host).snapshot.history).toEqual(oldHistory);
	});
	it("initializes only once through RPC and never exposes HTTP initialization", async () => {
		const { context, server, input } = await room();
		expect(context.storage.alarm).toBe(input.createdAt + lunchRoomLimits.ttlMs);
		await expect(server.initialize(input)).rejects.toThrow(
			"already initialized",
		);
		expect(server.onRequest().status).toBe(404);
		const socket = await connect(server, context, "손님");
		expect(latestSnapshot(socket).snapshot.candidates).toEqual(candidates);
		expect(socket.sent.join(" ")).not.toContain(input.hostTokenHash);
		expect(socket.sent.join(" ")).not.toContain(hostToken);
	});

	it("rejects invalid creation data before persisting a room", async () => {
		const { input } = await room();
		for (const change of [
			{ roomId: "invalid" },
			{ hostTokenHash: "not-a-hash" },
			{ candidateIds: [candidates[0].id] },
			{ candidateIds: [candidates[0].id, candidates[0].id] },
			{ createdAt: Date.now() - lunchRoomLimits.ttlMs },
		]) {
			const context = new HarnessContext();
			await expect(
				createServer(context).initialize({ ...input, ...change }),
			).rejects.toThrow();
			expect(context.storage.values.size).toBe(0);
		}
	});

	it("closes uninitialized rooms and refuses all non-join commands before joining", async () => {
		const context = new HarnessContext();
		const missing = await connect(createServer(context), context, "이름");
		expect(hasError(missing, "ROOM_NOT_FOUND")).toBe(true);
		expect(missing.closeCode).toBe(4004);
		const initialized = await room();
		const pending = await connect(initialized.server, initialized.context);
		await send(initialized.server, pending, { type: "start", id: "unjoined" });
		expect(hasError(pending, "JOIN_REQUIRED")).toBe(true);
		expect(entropy).not.toHaveBeenCalled();
	});

	it("authenticates server-owned identities independently of forged connection IDs and client isHost fields", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken, "same-id");
		const guest = await connect(
			server,
			context,
			undefined,
			undefined,
			"same-id",
		);
		await send(server, guest, {
			type: "join",
			name: "손님",
			isHost: true,
			participantId: latestSnapshot(host).self?.id,
		});
		expect(latestSnapshot(host).self?.isHost).toBe(true);
		expect(latestSnapshot(guest).self?.isHost).toBe(false);
		expect(latestSnapshot(guest).self?.id).not.toBe(
			latestSnapshot(host).self?.id,
		);
		await send(server, guest, {
			type: "start",
			id: "forged-start",
			isHost: true,
		});
		await send(server, guest, {
			type: "candidates",
			ids: candidates.slice(0, 2).map((place) => place.id),
		});
		expect(hasError(guest, "HOST_REQUIRED")).toBe(true);
		expect(entropy).not.toHaveBeenCalled();
		expect(latestSnapshot(host).snapshot.listVersion).toBe(1);
	});

	it("rejects an incorrect host proof instead of silently granting or downgrading host access", async () => {
		const { server, context } = await room();
		const socket = await connect(server, context, "방장", "b".repeat(64));
		expect(hasError(socket, "HOST_AUTH_FAILED")).toBe(true);
		expect(socket.closeCode).toBe(4003);
		expect(
			messages(socket).some((message) => message.type === "snapshot"),
		).toBe(false);
	});

	it("restores host attachments and deduplicates host tabs without invalidating the other tab", async () => {
		const { server, context } = await room();
		const first = await connect(server, context, "방장", hostToken);
		const second = await connect(server, context, "다른 탭 이름", hostToken);
		const guest = await connect(server, context, "손님");
		const firstId = latestSnapshot(first).self?.id;
		expect(latestSnapshot(second).self?.id).toBe(firstId);
		expect(latestSnapshot(guest).snapshot.participants).toHaveLength(2);
		expect(
			latestSnapshot(guest).snapshot.participants.filter(
				(participant) => participant.isHost,
			),
		).toEqual([{ id: firstId, name: "방장", isHost: true }]);
		first.closed = true;
		await server.onClose(socketConnection(first));
		expect(latestSnapshot(guest).snapshot.participants).toHaveLength(2);
		const restored = createServer(context);
		await restored.onStart();
		await send(restored, second, { type: "start", id: "restored-host-start" });
		await context.drain();
		expect(entropy).toHaveBeenCalledTimes(1);
		expect(latestSnapshot(guest).snapshot.status).toBe("drawing");
		second.closed = true;
		await restored.onClose(socketConnection(second));
		expect(latestSnapshot(guest).snapshot.participants).toHaveLength(1);
	});

	it("restores the original host identity and draw access after its last socket closes and the room wakes", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "점심 방장", hostToken);
		const guest = await connect(
			server,
			context,
			"손님",
			undefined,
			undefined,
			"c".repeat(64),
		);
		const originalHost = latestSnapshot(host).self;
		expect(originalHost?.isHost).toBe(true);
		host.closed = true;
		await server.onClose(socketConnection(host));
		expect(member(guest, originalHost?.id).status).toBe("offline");
		expect(
			latestSnapshot(guest).snapshot.participants.some((entry) => entry.isHost),
		).toBe(false);

		const restored = createServer(context);
		await restored.onStart();
		const returningHost = await connect(
			restored,
			context,
			"다른 탭 이름",
			hostToken,
		);
		expect(latestSnapshot(returningHost).self).toEqual(originalHost);
		expect(returningHost.state?.participant).toEqual({
			id: originalHost?.id,
			name: "점심 방장",
			isHost: true,
		});
		expect(member(guest, originalHost?.id).status).toBe("online");
		await send(restored, guest, {
			type: "start",
			id: "guest-after-host-return",
		});
		expect(hasError(guest, "HOST_REQUIRED")).toBe(true);
		expect(entropy).not.toHaveBeenCalled();

		await send(restored, returningHost, {
			type: "start",
			id: "returning-host-start",
		});
		await context.drain();
		expect(entropy).toHaveBeenCalledExactlyOnceWith(
			0,
			candidates.length - 1,
			1,
		);
		expect(latestSnapshot(returningHost).snapshot).toMatchObject({
			status: "drawing",
			draw: {
				id: "returning-host-start",
				winnerIndex: 1,
				source: "quantum",
			},
		});
	});

	it("limits joined participants to 30 while a second authorized host tab remains the same participant", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		for (let index = 0; index < 29; index++)
			await connect(server, context, `손님${index}`);
		expect(latestSnapshot(host).snapshot.participants).toHaveLength(30);
		const extra = await connect(server, context, "초과 인원");
		expect(extra.closed).toBe(true);
		expect(hasError(extra, "ROOM_FULL")).toBe(true);
		const otherHost = await connect(server, context, "방장", hostToken);
		expect(otherHost.closed).toBe(false);
		expect(latestSnapshot(otherHost).snapshot.participants).toHaveLength(30);
	});

	it("renames an authenticated participant without accepting role changes and updates every host tab", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const otherHost = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "손님");
		const hostId = latestSnapshot(host).self?.id;
		const guestId = latestSnapshot(guest).self?.id;
		await send(server, guest, {
			type: "join",
			name: "바꾼 손님",
			hostToken,
			isHost: true,
		});
		expect(latestSnapshot(guest).self).toEqual({ id: guestId, isHost: false });
		expect(
			latestSnapshot(host).snapshot.participants.find(
				(participant) => participant.id === guestId,
			)?.name,
		).toBe("바꾼 손님");
		await send(server, host, { type: "join", name: "바꾼 방장" });
		expect(latestSnapshot(host).self).toEqual({ id: hostId, isHost: true });
		expect(otherHost.state?.participant).toEqual({
			id: hostId,
			isHost: true,
			name: "바꾼 방장",
		});
		expect(
			latestSnapshot(guest).snapshot.participants.filter(
				(participant) => participant.isHost,
			),
		).toEqual([{ id: hostId, isHost: true, name: "바꾼 방장" }]);
		const restored = createServer(context);
		await restored.onStart();
		const reconnectedHost = await connect(
			restored,
			context,
			"이전 이름",
			hostToken,
		);
		expect(reconnectedHost.state?.participant?.name).toBe("바꾼 방장");
		await send(restored, guest, { type: "start", id: "guest-after-rename" });
		expect(hasError(guest, "HOST_REQUIRED")).toBe(true);
		expect(entropy).not.toHaveBeenCalled();
	});

	it("bounds unjoined sockets and closes them by alarm without process timers", async () => {
		const { server, context } = await room();
		const pending = [];
		for (let index = 0; index < 30; index++)
			pending.push(await connect(server, context));
		const extra = await connect(server, context);
		expect(extra.closed).toBe(true);
		expect(hasError(extra, "ROOM_FULL")).toBe(true);
		expect(context.storage.alarm).toBe(Date.now() + 10_000);
		// A close handshake may leave sockets visible to the platform temporarily.
		Object.defineProperty(server, "getConnections", {
			value: () => [...context.sockets],
		});
		vi.advanceTimersByTime(10_000);
		await server.onAlarm();
		expect(
			pending.every(
				(socket) => socket.closed && hasError(socket, "JOIN_TIMEOUT"),
			),
		).toBe(true);
		expect(context.storage.alarm).toBe(latestExpiry(context));
		expect(vi.getTimerCount()).toBe(0);
	});

	it("records authoritative presence and actual renames once across host tabs, close races, and hibernation", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const otherHost = await connect(server, context, "방장", hostToken);
		const thirdHost = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "손님");
		expect(systemEvents(guest, "joined")).toHaveLength(2);
		await send(server, guest, { type: "join", name: "손님" });
		await send(server, guest, { type: "join", name: "새 이름" });
		await send(server, guest, { type: "join", name: "새 이름" });
		expect(systemEvents(guest, "renamed")).toHaveLength(1);
		expect(systemEvents(guest, "renamed")[0].text).toContain(
			"손님님이 새 이름님으로",
		);
		const beforeWake = systemEvents(guest);
		const restored = createServer(context);
		await restored.onStart();
		expect(systemEvents(guest)).toEqual(beforeWake);
		host.closed = true;
		await restored.onClose(socketConnection(host));
		expect(systemEvents(guest, "left")).toHaveLength(0);
		otherHost.closed = true;
		thirdHost.closed = true;
		await Promise.all([
			restored.onClose(socketConnection(otherHost)),
			restored.onClose(socketConnection(thirdHost)),
		]);
		await restored.onError(socketConnection(otherHost));
		await restored.onClose(socketConnection(thirdHost));
		expect(systemEvents(guest, "left")).toHaveLength(1);
		for (const event of systemEvents(guest)) {
			expect(event.name).toBe("시스템");
			expect(event.participantId).toBe("system");
			expect(event.id).toMatch(/^[0-9a-f-]{36}$/i);
		}
		const oldGuestId = latestSnapshot(guest).self?.id;
		guest.closed = true;
		await restored.onClose(socketConnection(guest));
		const reconnected = await connect(restored, context, "새 이름");
		expect(latestSnapshot(reconnected).self?.id).not.toBe(oldGuestId);
		expect(systemEvents(reconnected, "left")).toHaveLength(2);
		expect(systemEvents(reconnected, "joined")).toHaveLength(3);
	});

	it("persists fetching before awaiting entropy, rejects concurrent starts, and replays a repeated request ID", async () => {
		const { server, context } = await room();
		const first = await connect(server, context, "방장", hostToken);
		const second = await connect(server, context, "방장", hostToken);
		let complete: (value: { numbers: number[]; source: "quantum" }) => void =
			() => {};
		entropy.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		await Promise.all([
			send(server, first, { type: "start", id: "same-request" }),
			send(server, second, { type: "start", id: "same-request" }),
			send(server, second, { type: "start", id: "racing-request" }),
		]);
		expect(entropy).toHaveBeenCalledExactlyOnceWith(0, 2, 1);
		expect(latestSnapshot(first).snapshot.status).toBe("fetching");
		expect(storedSnapshot(context).status).toBe("fetching");
		expect(hasError(second, "DRAW_BUSY")).toBe(true);
		expect(systemEvents(first, "draw-started")).toHaveLength(1);
		await send(server, first, {
			type: "candidates",
			ids: candidates.slice(0, 2).map((place) => place.id),
		});
		expect(hasError(first, "DRAW_BUSY")).toBe(true);
		complete({ numbers: [2], source: "quantum" });
		await context.drain();
		await send(server, second, { type: "start", id: "same-request" });
		expect(entropy).toHaveBeenCalledTimes(1);
		expect(latestSnapshot(second).snapshot.draw?.winnerIndex).toBe(2);
		expect(systemEvents(second, "draw-started")).toHaveLength(1);
	});

	it("shares canonical timing and immutable candidates, then archives a completed result only when the next draw starts", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await send(server, host, { type: "start", id: "first-draw" });
		await context.drain();
		const draw = latestSnapshot(host).snapshot.draw;
		expect(draw).not.toBeNull();
		expect(draw?.startedAt).toBe(Date.now() + 1500);
		expect(draw?.durationMs).toBe(7200);
		expect(draw?.fromRotation).toBe(0);
		expect(draw?.toRotation).toBe(1620);
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		const late = await connect(server, context, "늦은 참가자");
		expect(latestSnapshot(late).snapshot.draw).toEqual(draw);
		vi.advanceTimersByTime(8699);
		await server.onAlarm();
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		vi.advanceTimersByTime(1);
		await server.onAlarm();
		await server.onAlarm();
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(systemEvents(host, "draw-finished")).toHaveLength(1);
		expect(systemEvents(host, "draw-finished")[0].text).toContain(
			candidates[1].name,
		);
		await send(server, host, {
			type: "candidates",
			ids: candidates.slice(0, 2).map((place) => place.id),
		});
		const snapshot = latestSnapshot(host).snapshot;
		expect(snapshot.listVersion).toBe(2);
		expect(snapshot.candidates).toHaveLength(2);
		expect(snapshot.draw?.candidates).toEqual(candidates);
		expect(snapshot.history).toEqual([]);
		await send(server, host, { type: "start", id: "second-draw" });
		expect(latestSnapshot(host).snapshot.history).toEqual([draw]);
		expect(latestSnapshot(host).snapshot.draw).toBeNull();
		await context.drain();
		expect(latestSnapshot(host).snapshot.history[0].candidates).toEqual(
			candidates,
		);
	});

	it("captures participant names, request time, and equal probabilities before entropy and preserves them in history", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "시작 시점 손님");
		const participants = latestSnapshot(host).snapshot.participants;
		const requestedAt = Date.now();
		let complete: (value: { numbers: number[]; source: "quantum" }) => void =
			() => {};
		entropy.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		await send(server, host, { type: "start", id: "captured-metadata" });
		await send(server, guest, { type: "join", name: "바꾼 손님" });
		guest.closed = true;
		await server.onClose(socketConnection(guest));
		await connect(server, context, "늦게 온 손님");
		vi.advanceTimersByTime(25);
		complete({ numbers: [1], source: "quantum" });
		await context.drain();
		const draw = latestSnapshot(host).snapshot.draw;
		expect(draw?.participants).toEqual(participants);
		expect(draw?.requestedAt).toBe(requestedAt);
		expect(draw?.timestamp).toBe(requestedAt + 25);
		expect(draw?.probabilities).toEqual(
			candidates.map(() => 1 / candidates.length),
		);
		expect(latestSnapshot(host).snapshot.participants).not.toEqual(
			participants,
		);
		vi.advanceTimersByTime(8700);
		await server.onAlarm();
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(latestSnapshot(host).snapshot.draw).toEqual(draw);
		await send(restored, host, {
			type: "start",
			id: "archive-captured-metadata",
		});
		expect(latestSnapshot(host).snapshot.history[0]).toEqual(draw);
		await context.drain();
	});

	it("restores a legacy draw without fabricating missing participant or probability metadata", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "현재 방장", hostToken);
		await send(server, host, { type: "start", id: "legacy-draw" });
		await context.drain();
		vi.advanceTimersByTime(8700);
		await server.onAlarm();
		const stored = structuredClone(
			context.storage.values.get("lunch-room:v1"),
		) as {
			snapshot: RoomSnapshot;
			presentParticipantIds?: string[];
		};
		if (stored.snapshot.draw)
			stored.snapshot.history = [structuredClone(stored.snapshot.draw)];
		for (const draw of [stored.snapshot.draw, ...stored.snapshot.history]) {
			if (!draw) continue;
			delete draw.participants;
			delete draw.requestedAt;
			delete draw.probabilities;
			delete draw.votes;
		}
		delete stored.presentParticipantIds;
		context.storage.values.set("lunch-room:v1", stored);
		const beforeWake = latestSnapshot(host).snapshot.messages;
		const restored = createServer(context);
		await restored.onStart();
		const snapshot = latestSnapshot(host).snapshot;
		expect(snapshot.draw?.id).toBe("legacy-draw");
		expect(snapshot.draw?.participants).toBeUndefined();
		expect(snapshot.draw?.requestedAt).toBeUndefined();
		expect(snapshot.draw?.probabilities).toBeUndefined();
		expect(snapshot.draw?.votes).toBeUndefined();
		expect(snapshot.history[0]).toEqual(snapshot.draw);
		expect(snapshot.messages).toEqual(beforeWake);
	});

	it("allows chat during entropy fetching, uses server identity and treats duplicate messages idempotently", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "손님");
		entropy.mockReturnValueOnce(new Promise(() => {}));
		await send(server, host, { type: "start", id: "slow-draw" });
		const text = "<img src=x onerror=alert(1)>";
		await send(server, guest, {
			type: "chat",
			id: "chat-one",
			text,
			name: "위조 방장",
			participantId: latestSnapshot(host).self?.id,
			event: "draw-finished",
		});
		await send(server, guest, { type: "chat", id: "chat-one", text: "재전송" });
		await send(server, guest, {
			type: "chat",
			id: "chat-two",
			text: "너무 빠른 메시지",
		});
		const history = latestSnapshot(guest).snapshot.messages.filter(
			(message) => !message.event,
		);
		expect(history).toHaveLength(1);
		expect(history[0]).toMatchObject({
			text,
			name: "손님",
			participantId: latestSnapshot(guest).self?.id,
		});
		expect(history[0].event).toBeUndefined();
		expect(hasError(guest, "CHAT_RATE_LIMIT")).toBe(true);
		await send(server, guest, { type: "ping", clientTime: Date.now() });
		expect(messages(guest).at(-1)).toEqual({
			type: "pong",
			clientTime: Date.now(),
			serverTime: Date.now(),
		});
	});

	it("keeps at most 100 chat messages and rejects oversized or invalid messages", async () => {
		const { server, context } = await room();
		const guest = await connect(server, context, "손님");
		for (let index = 0; index < 102; index++) {
			vi.advanceTimersByTime(750);
			await send(server, guest, {
				type: "chat",
				id: `chat-${index}`,
				text: `메시지${index}`,
			});
		}
		expect(latestSnapshot(guest).snapshot.messages).toHaveLength(100);
		expect(latestSnapshot(guest).snapshot.messages[0].id).toBe("chat-2");
		await send(server, guest, {
			type: "chat",
			id: "too-long",
			text: "가".repeat(501),
		});
		await server.onMessage(socketConnection(guest), "x".repeat(4097));
		expect(hasError(guest, "INVALID_MESSAGE")).toBe(true);
		expect(latestSnapshot(guest).snapshot.messages).toHaveLength(100);
	});

	it("recovers an interrupted fetch to waiting and preserves processed start IDs across restart", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		entropy.mockReturnValueOnce(new Promise(() => {}));
		await send(server, host, { type: "start", id: "interrupted" });
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		expect(hasError(host, "DRAW_INTERRUPTED")).toBe(true);
		expect(systemEvents(host, "draw-failed")).toHaveLength(1);
		await createServer(context).onStart();
		expect(systemEvents(host, "draw-failed")).toHaveLength(1);
		await send(restored, host, { type: "start", id: "interrupted" });
		expect(entropy).toHaveBeenCalledTimes(1);
		await send(restored, host, { type: "start", id: "fresh-request" });
		// The old isolate's pending task is deliberately never resolved.
		await context.tasks.at(-1);
		expect(entropy).toHaveBeenCalledTimes(2);
		expect(latestSnapshot(host).snapshot.status).toBe("drawing");
	});

	it("finalizes an overdue draw on wake and retains the latest20 archived rounds separately from the current result", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await send(server, host, { type: "start", id: "draw-0" });
		await context.drain();
		vi.advanceTimersByTime(8700);
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(latestSnapshot(host).snapshot.draw?.id).toBe("draw-0");
		for (let index = 1; index <= 20; index++) {
			await send(restored, host, { type: "start", id: `draw-${index}` });
			await context.drain();
			vi.advanceTimersByTime(8700);
			await restored.onAlarm();
		}
		const history = latestSnapshot(host).snapshot.history;
		expect(history).toHaveLength(20);
		expect(history[0].id).toBe("draw-19");
		expect(history.at(-1)?.id).toBe("draw-0");
		expect(latestSnapshot(host).snapshot.draw?.id).toBe("draw-20");
		expect(entropy).toHaveBeenCalledTimes(21);
	});

	it.each([
		{ numbers: [], source: "quantum" },
		{ numbers: [-1], source: "quantum" },
		{ numbers: [3], source: "quantum" },
		{ numbers: [0], source: "untrusted" },
	])("recovers invalid entropy without inventing a result: %j", async (result) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		entropy.mockResolvedValueOnce(
			result as Awaited<ReturnType<typeof consumeFromPool>>,
		);
		await send(server, host, { type: "start", id: "invalid-result" });
		await context.drain();
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(latestSnapshot(host).snapshot.draw).toBeNull();
		expect(hasError(host, "DRAW_FAILED")).toBe(true);
		expect(systemEvents(host, "draw-failed")).toHaveLength(1);
		await send(server, host, { type: "start", id: "invalid-result" });
		expect(systemEvents(host, "draw-failed")).toHaveLength(1);
	});

	it("expires after 24 hours, closes clients, deletes persisted state and ignores a late entropy response", async () => {
		const { server, context, input } = await room();
		const host = await connect(server, context, "방장", hostToken);
		let complete: (value: { numbers: number[]; source: "quantum" }) => void =
			() => {};
		entropy.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		await send(server, host, { type: "start", id: "expiring-draw" });
		vi.setSystemTime(input.createdAt + lunchRoomLimits.ttlMs);
		await server.onAlarm();
		expect(latestSnapshot(host).snapshot.status).toBe("closed");
		expect(host.closeCode).toBe(4008);
		expect(hasError(host, "ROOM_EXPIRED")).toBe(true);
		expect(context.storage.values.size).toBe(0);
		expect(context.storage.alarm).toBeNull();
		expect(context.storage.deleteCount).toBe(1);
		complete({ numbers: [0], source: "quantum" });
		await context.drain();
		expect(context.storage.values.size).toBe(0);
		const late = await connect(server, context, "늦은 참가자");
		expect(hasError(late, "ROOM_EXPIRED")).toBe(true);
	});

	it("retries failed expiry data deletion on the next alarm without reopening the room", async () => {
		const { server, context, input } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const deleteAll = vi
			.spyOn(context.storage, "deleteAll")
			.mockRejectedValueOnce(new Error("temporary data deletion failure"));
		vi.setSystemTime(input.createdAt + lunchRoomLimits.ttlMs);
		await expect(server.onAlarm()).rejects.toThrow(
			"temporary data deletion failure",
		);
		expect(host.closed).toBe(true);
		expect(host.closeCode).toBe(4008);
		expect(context.storage.values.has("lunch-room:v1")).toBe(true);
		expect(
			await server.checkNicknameAvailability({ name: "참가자" }),
		).toMatchObject({ status: 410 });
		await server.onAlarm();
		expect(deleteAll).toHaveBeenCalledTimes(2);
		expect(context.storage.values.size).toBe(0);
		expect(context.storage.alarm).toBeNull();
		await server.onAlarm();
		expect(deleteAll).toHaveBeenCalledTimes(2);
	});

	it("retries alarm deletion after data deletion has already succeeded", async () => {
		const { server, context, input } = await room();
		await connect(server, context, "방장", hostToken);
		const deleteAlarm = vi
			.spyOn(context.storage, "deleteAlarm")
			.mockRejectedValueOnce(new Error("temporary alarm deletion failure"));
		vi.setSystemTime(input.createdAt + lunchRoomLimits.ttlMs);
		await expect(server.onAlarm()).rejects.toThrow(
			"temporary alarm deletion failure",
		);
		expect(context.storage.values.size).toBe(0);
		expect(context.storage.alarm).not.toBeNull();
		expect(
			await server.checkNicknameAvailability({ name: "참가자" }),
		).toMatchObject({ status: 410 });
		await server.onAlarm();
		expect(deleteAlarm).toHaveBeenCalledTimes(2);
		expect(context.storage.alarm).toBeNull();
		expect(context.storage.values.size).toBe(0);
	});

	it("keeps repeated cleanup failures retryable in one isolate and rejects fresh sockets without publishing expired room data", async () => {
		const { server, context, input } = await room();
		await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		await send(server, guest, {
			type: "chat",
			id: "before-expiry-chat",
			text: "expired private test content",
		});
		const deleteAll = vi
			.spyOn(context.storage, "deleteAll")
			.mockRejectedValue(new Error("temporary cleanup failure"));
		vi.setSystemTime(input.createdAt + lunchRoomLimits.ttlMs);
		for (let attempt = 0; attempt < 3; attempt++)
			await expect(server.onAlarm()).rejects.toThrow(
				"temporary cleanup failure",
			);
		expect(deleteAll).toHaveBeenCalledTimes(3);
		vi.setSystemTime(input.createdAt + lunchRoomLimits.ttlMs - 60_000);
		const late = await connect(server, context, "새 참가자");
		expect(late.closed).toBe(true);
		expect(messages(late)).toEqual([
			{ type: "error", code: "ROOM_EXPIRED", message: "방이 만료됐습니다." },
		]);
		expect(late.sent.join(" ")).not.toContain("expired private test content");
		expect(deleteAll).toHaveBeenCalledTimes(3);
		deleteAll.mockRestore();
		await server.onAlarm();
		expect(context.storage.values.size).toBe(0);
		expect(context.storage.alarm).toBeNull();
	});

	it.each([
		"startup",
		"alarm",
	])("removes an orphan alarm after a restart between deleting room data and its alarm: %s", async (entrypoint) => {
		const { server, context, input } = await room();
		await connect(server, context, "방장", hostToken);
		const deleteAlarm = vi
			.spyOn(context.storage, "deleteAlarm")
			.mockRejectedValueOnce(new Error("interrupted cleanup"));
		vi.setSystemTime(input.createdAt + lunchRoomLimits.ttlMs);
		await expect(server.onAlarm()).rejects.toThrow("interrupted cleanup");
		expect(context.storage.values.size).toBe(0);
		expect(context.storage.alarm).not.toBeNull();
		deleteAlarm.mockRestore();
		const restored = createServer(context);
		if (entrypoint === "startup") await restored.onStart();
		else await restored.onAlarm();
		expect(context.storage.alarm).toBeNull();
		expect(context.storage.values.size).toBe(0);
		const late = await connect(restored, context, "늦은 참가자");
		expect(hasError(late, "ROOM_NOT_FOUND")).toBe(true);
		expect(messages(late).some((message) => message.type === "snapshot")).toBe(
			false,
		);
	});

	it("becomes away at exactly five minutes and ping does not postpone the transition", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const joinedAt = Date.now();
		expect(member(host).status).toBe("online");
		expect(context.storage.alarm).toBe(joinedAt + lunchRoomLimits.awayAfterMs);
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs - 1);
		await send(server, host, { type: "ping", clientTime: Date.now() });
		await server.onAlarm();
		expect(member(host).status).toBe("online");
		expect(member(host).lastActiveAt).toBe(joinedAt);
		expect(context.storage.alarm).toBe(joinedAt + lunchRoomLimits.awayAfterMs);
		vi.advanceTimersByTime(1);
		await server.onAlarm();
		expect(member(host).status).toBe("away");
		expect(member(host).lastActiveAt).toBe(joinedAt);
		expect(latestSnapshot(host).snapshot.participants).toHaveLength(1);
		expect(systemEvents(host)).toHaveLength(1);
		expect(context.storage.alarm).toBe(latestExpiry(context));
	});

	it("returns from away on real activity and does not broadcast every online activity heartbeat", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs);
		await server.onAlarm();
		expect(member(host).status).toBe("away");
		await send(server, host, {
			type: "activity",
			lastActiveAt: Date.now() + 99_000_000,
		});
		expect(member(host).status).toBe("online");
		expect(member(host).lastActiveAt).toBe(Date.now());
		const sentCount = host.sent.length;
		vi.advanceTimersByTime(15_000);
		await send(server, host, { type: "activity" });
		expect(host.sent).toHaveLength(sentCount);
		expect(context.storage.alarm).toBe(
			Date.now() + lunchRoomLimits.awayAfterMs,
		);
		const stored = context.storage.values.get("lunch-room:v1") as {
			snapshot: RoomSnapshot;
		};
		expect(stored.snapshot.members?.[0].lastActiveAt).toBe(Date.now());
		expect(systemEvents(host)).toHaveLength(1);
	});

	it("counts accepted chat, rename, candidate changes and starting as activity while retaining role checks", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		for (const message of [
			{ type: "chat", id: "presence-chat", text: "점심 먹어요" },
			{ type: "join", name: "새 방장" },
			{
				type: "candidates",
				ids: candidates.slice(0, 2).map((place) => place.id),
			},
			{ type: "start", id: "presence-draw" },
		]) {
			vi.advanceTimersByTime(1000);
			await send(server, host, message);
			if (message.type === "start") await context.drain();
			expect(member(host).lastActiveAt).toBe(Date.now());
			expect(member(host).status).toBe("online");
		}
	});

	it("uses the latest activity across host tabs and remains connected until the last physical tab closes", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const watcher = await connect(server, context, "관전자");
		const hostId = latestSnapshot(host).self?.id;
		vi.advanceTimersByTime(250_000);
		const otherHost = await connect(server, context, "방장", hostToken);
		vi.advanceTimersByTime(50_000);
		await server.onAlarm();
		expect(member(watcher, hostId).status).toBe("online");
		expect(member(watcher, hostId).lastActiveAt).toBe(Date.now() - 50_000);
		await send(server, host, { type: "activity" });
		otherHost.closed = true;
		await server.onClose(socketConnection(otherHost));
		expect(member(watcher, hostId).status).toBe("online");
		const activeAt = member(watcher, hostId).lastActiveAt;
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs);
		await server.onAlarm();
		expect(member(watcher, hostId).status).toBe("away");
		host.closed = true;
		await server.onClose(socketConnection(host));
		expect(member(watcher, hostId)).toMatchObject({
			status: "offline",
			lastActiveAt: activeAt,
			lastSeenAt: Date.now(),
		});
		expect(
			latestSnapshot(watcher).snapshot.participants.some(
				(participant) => participant.id === hostId,
			),
		).toBe(false);
	});

	it("restores stable guest identity with a private token, synchronizes same-ID names, and never grants host privileges", async () => {
		const { server, context, input } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guestToken = "c".repeat(64);
		const guest = await connect(
			server,
			context,
			"손님",
			undefined,
			undefined,
			guestToken,
		);
		const guestId = latestSnapshot(guest).self?.id;
		guest.closed = true;
		await server.onClose(socketConnection(guest));
		expect(member(host, guestId).status).toBe("offline");
		const restored = createServer(context);
		await restored.onStart();
		const resumed = await connect(
			restored,
			context,
			"오래된 탭 이름",
			undefined,
			undefined,
			guestToken,
		);
		expect(latestSnapshot(resumed).self).toEqual({
			id: guestId,
			isHost: false,
		});
		expect(member(host, guestId)).toMatchObject({
			status: "online",
			name: "손님",
		});
		const otherTab = await connect(
			restored,
			context,
			"다른 이름",
			undefined,
			undefined,
			guestToken,
		);
		await send(restored, resumed, {
			type: "join",
			name: "바꾼 손님",
			hostToken,
		});
		expect(otherTab.state?.participant).toEqual({
			id: guestId,
			isHost: false,
			name: "바꾼 손님",
		});
		resumed.closed = true;
		await restored.onClose(socketConnection(resumed));
		expect(member(host, guestId).status).toBe("online");
		await send(restored, otherTab, { type: "start", id: "guest-cannot-start" });
		expect(hasError(otherTab, "HOST_REQUIRED")).toBe(true);
		const hostTokenAsGuest = await connect(
			restored,
			context,
			"손님2",
			undefined,
			undefined,
			hostToken,
		);
		expect(latestSnapshot(hostTokenAsGuest).self?.isHost).toBe(false);
		expect(latestSnapshot(hostTokenAsGuest).self?.id).not.toBe(
			latestSnapshot(host).self?.id,
		);
		expect(host.sent.join(" ")).not.toContain(guestToken);
		expect(host.sent.join(" ")).not.toContain(input.hostTokenHash);
		expect(entropy).not.toHaveBeenCalled();
	});

	it("bounds the roster and token mappings to 60 members, evicts the oldest offline guest and keeps active members", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const oldIds: string[] = [];
		const guestToken = (index: number) =>
			`guest-token-${String(index).padStart(6, "0")}`;
		for (let index = 0; index < 61; index++) {
			vi.advanceTimersByTime(1);
			const guest = await connect(
				server,
				context,
				`손님${index}`,
				undefined,
				undefined,
				guestToken(index),
			);
			oldIds.push(latestSnapshot(guest).self?.id ?? "");
			guest.closed = true;
			await server.onClose(socketConnection(guest));
		}
		const members = latestSnapshot(host).snapshot.members;
		expect(members).toHaveLength(lunchRoomLimits.maxMembers);
		expect(member(host).status).toBe("online");
		expect(members?.some((entry) => entry.id === oldIds[0])).toBe(false);
		expect(members?.some((entry) => entry.id === oldIds[1])).toBe(false);
		expect(members?.some((entry) => entry.id === oldIds[60])).toBe(true);
		const stored = context.storage.values.get("lunch-room:v1") as {
			guestTokenIds: Record<string, string>;
		};
		expect(Object.values(stored.guestTokenIds)).toHaveLength(59);
		expect(
			Object.values(stored.guestTokenIds).every((id) =>
				members?.some((entry) => entry.id === id),
			),
		).toBe(true);
		const evicted = await connect(
			server,
			context,
			"다시 온 손님",
			undefined,
			undefined,
			guestToken(0),
		);
		expect(latestSnapshot(evicted).self?.id).not.toBe(oldIds[0]);
		expect(latestSnapshot(host).snapshot.members).toHaveLength(60);
		vi.setSystemTime(latestExpiry(context));
		await server.onAlarm();
		expect(context.storage.values.size).toBe(0);
	});

	it("upgrades legacy attachments and snapshots without members and does not synthesize activity on wake", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const joinedAt = Date.now();
		const stored = context.storage.values.get("lunch-room:v1") as {
			snapshot: RoomSnapshot;
			guestTokenIds?: Record<string, string>;
		};
		delete stored.snapshot.members;
		delete stored.guestTokenIds;
		if (host.state) delete host.state.lastActiveAt;
		const beforeWake = systemEvents(host);
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs);
		const restored = createServer(context);
		await restored.onStart();
		expect(member(host)).toMatchObject({
			status: "away",
			lastActiveAt: joinedAt,
		});
		expect(systemEvents(host)).toEqual(beforeWake);
		await send(restored, host, { type: "ping", clientTime: Date.now() });
		expect(member(host).lastActiveAt).toBe(joinedAt);
		expect(context.storage.alarm).toBe(latestExpiry(context));
	});
});

describe("LunchRoomServer irreversible current-result votes", () => {
	const guestProof = "v".repeat(64);
	async function votingRoom(finished = true) {
		const value = await room();
		const host = await connect(value.server, value.context, "방장", hostToken);
		const guest = await connect(
			value.server,
			value.context,
			"투표참가자",
			undefined,
			undefined,
			guestProof,
		);
		await send(value.server, host, { type: "start", id: "vote-draw-1" });
		await value.context.drain();
		if (finished) {
			vi.advanceTimersByTime(8700);
			await value.server.onAlarm();
		}
		const draw = latestSnapshot(host).snapshot.draw;
		if (!draw) throw new Error("Expected draw for voting");
		return { ...value, host, guest, draw };
	}
	function voteErrors(socket: TestSocket, requestId: string) {
		return messages(socket).filter(
			(message) => message.type === "error" && message.requestId === requestId,
		);
	}

	it("records authoritative guest identity and server reaction timing, then publishes the current result without modifying history", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		const beforeEvents = systemEvents(host);
		vi.advanceTimersByTime(1450);
		const votedAt = Date.now();
		await send(server, guest, {
			type: "vote",
			id: "vote-up",
			drawId: draw.id,
			vote: "up",
			participantId: latestSnapshot(host).self?.id,
			name: "위조방장",
			timestamp: 0,
			reactionMs: 0,
		});
		const expected = [
			{
				participantId: latestSnapshot(guest).self?.id,
				name: "투표참가자",
				vote: "up",
				timestamp: votedAt,
				reactionMs: 1450,
			},
		];
		expect(latestSnapshot(host).snapshot.draw?.votes).toEqual(expected);
		expect(latestSnapshot(guest).snapshot.draw?.votes).toEqual(expected);
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(systemEvents(host)).toEqual(beforeEvents);
		expect(guest.sent.join(" ")).not.toContain(guestProof);
		expect(host.sent.join(" ")).not.toContain(hostToken);
		const persisted = context.storage.values.get("lunch-room:v1") as {
			snapshot: RoomSnapshot;
		};
		expect(persisted.snapshot.draw?.votes).toEqual(expected);
		expect(entropy).toHaveBeenCalledTimes(1);
	});

	it("rejects unjoined users, hosts, unknown rounds and pre-result votes with the request ID, but accepts exactly at reveal", async () => {
		const { server, context, host, guest, draw } = await votingRoom(false);
		const pending = await connect(server, context);
		await send(server, pending, {
			type: "vote",
			id: "unjoined-vote",
			drawId: draw.id,
			vote: "up",
		});
		expect(voteErrors(pending, "unjoined-vote")).toMatchObject([
			{ code: "JOIN_REQUIRED" },
		]);
		await send(server, host, {
			type: "vote",
			id: "host-vote",
			drawId: draw.id,
			vote: "up",
		});
		expect(voteErrors(host, "host-vote")).toMatchObject([
			{ code: "HOST_CANNOT_VOTE" },
		]);
		await send(server, guest, {
			type: "vote",
			id: "unknown-vote",
			drawId: "missing-draw",
			vote: "down",
		});
		expect(voteErrors(guest, "unknown-vote")).toMatchObject([
			{ code: "VOTE_NOT_FOUND" },
		]);
		vi.advanceTimersByTime(8699);
		await send(server, guest, {
			type: "vote",
			id: "early-vote",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(guest, "early-vote")).toMatchObject([
			{ code: "VOTE_NOT_READY" },
		]);
		expect(latestSnapshot(host).snapshot.draw?.votes).toEqual([]);
		vi.advanceTimersByTime(1);
		await send(server, guest, {
			type: "vote",
			id: "on-time-vote",
			drawId: draw.id,
			vote: "down",
		});
		expect(latestSnapshot(host).snapshot.draw?.votes).toMatchObject([
			{ vote: "down", reactionMs: 0 },
		]);
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
	});

	it("lets only the first opposite vote win across same-identity tabs, renaming and a persisted reconnect", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		const otherTab = await connect(
			server,
			context,
			"오래된이름",
			undefined,
			undefined,
			guestProof,
		);
		const participantId = latestSnapshot(guest).self?.id;
		await Promise.all([
			send(server, guest, {
				type: "vote",
				id: "first-choice",
				drawId: draw.id,
				vote: "up",
			}),
			send(server, otherTab, {
				type: "vote",
				id: "opposite-choice",
				drawId: draw.id,
				vote: "down",
			}),
		]);
		const firstVote = structuredClone(
			latestSnapshot(host).snapshot.draw?.votes,
		);
		expect(firstVote).toMatchObject([
			{ participantId, name: "투표참가자", vote: "up" },
		]);
		expect(voteErrors(otherTab, "opposite-choice")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
		expect(messages(otherTab).at(-1)).toMatchObject({
			type: "snapshot",
			snapshot: { draw: { votes: firstVote } },
		});
		await send(server, guest, { type: "join", name: "바꾼참가자" });
		await send(server, guest, {
			type: "vote",
			id: "renamed-choice",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(guest, "renamed-choice")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
		for (const socket of [guest, otherTab]) {
			socket.closed = true;
			await server.onClose(socketConnection(socket));
		}
		const restored = createServer(context);
		await restored.onStart();
		const returned = await connect(
			restored,
			context,
			"입장입력값",
			undefined,
			undefined,
			guestProof,
		);
		expect(latestSnapshot(returned).self?.id).toBe(participantId);
		await send(restored, returned, {
			type: "vote",
			id: "returned-choice",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(returned, "returned-choice")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
		expect(latestSnapshot(host).snapshot.draw?.votes).toEqual(firstVote);
	});

	it("keeps voting open without a timer until the next draw archives and freezes the complete result", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		vi.advanceTimersByTime(4 * 60 * 60 * 1000);
		await send(server, guest, {
			type: "vote",
			id: "hours-late",
			drawId: draw.id,
			vote: "down",
		});
		expect(latestSnapshot(host).snapshot.draw?.votes).toMatchObject([
			{ reactionMs: 4 * 60 * 60 * 1000 },
		]);
		const frozen = structuredClone(latestSnapshot(host).snapshot.draw);
		await send(server, host, { type: "start", id: "vote-draw-2" });
		expect(latestSnapshot(host).snapshot.draw).toBeNull();
		expect(latestSnapshot(host).snapshot.history).toEqual([frozen]);
		await send(server, guest, {
			type: "vote",
			id: "archived-choice",
			drawId: draw.id,
			vote: "up",
		});
		expect(voteErrors(guest, "archived-choice")).toMatchObject([
			{ code: "VOTE_CLOSED" },
		]);
		await context.drain();
		vi.advanceTimersByTime(8700);
		await server.onAlarm();
		await send(server, guest, {
			type: "vote",
			id: "next-choice",
			drawId: "vote-draw-2",
			vote: "up",
		});
		expect(latestSnapshot(host).snapshot.draw?.votes).toMatchObject([
			{ vote: "up" },
		]);
		expect(latestSnapshot(host).snapshot.history).toEqual([frozen]);
	});

	it.each([
		"vote-first",
		"start-first",
	])("serializes a next-draw race so archived votes never change: %s", async (order) => {
		const { server, context, host, guest, draw } = await votingRoom();
		const vote = () =>
			send(server, guest, {
				type: "vote",
				id: "racing-choice",
				drawId: draw.id,
				vote: "up",
			});
		const start = () =>
			send(server, host, { type: "start", id: "racing-next-draw" });
		await Promise.all(
			order === "vote-first" ? [vote(), start()] : [start(), vote()],
		);
		await context.drain();
		const archived = latestSnapshot(host).snapshot.history[0];
		expect(archived.id).toBe(draw.id);
		expect(archived.votes?.length ?? 0).toBe(order === "vote-first" ? 1 : 0);
		if (order === "start-first")
			expect(voteErrors(guest, "racing-choice")).toMatchObject([
				{ code: "VOTE_CLOSED" },
			]);
		const frozen = structuredClone(archived);
		await send(server, guest, {
			type: "vote",
			id: "post-race-choice",
			drawId: draw.id,
			vote: "down",
		});
		expect(latestSnapshot(host).snapshot.history[0]).toEqual(frozen);
	});

	it("keeps a previous result archived and closed if fetching its replacement fails", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		await send(server, guest, {
			type: "vote",
			id: "before-failure-choice",
			drawId: draw.id,
			vote: "up",
		});
		const frozen = structuredClone(latestSnapshot(host).snapshot.draw);
		entropy.mockRejectedValueOnce(new Error("test entropy failure"));
		await send(server, host, { type: "start", id: "failed-next-draw" });
		await context.drain();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			history: [frozen],
		});
		await send(server, guest, {
			type: "vote",
			id: "after-failure-choice",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(guest, "after-failure-choice")).toMatchObject([
			{ code: "VOTE_CLOSED" },
		]);
		await send(server, host, { type: "start", id: "fresh-next-draw" });
		await context.drain();
		expect(latestSnapshot(host).snapshot.history).toEqual([frozen]);
	});

	it("does not reopen or alter legacy results already copied into history", async () => {
		const { context, host, guest, draw } = await votingRoom();
		const saved = structuredClone(
			context.storage.values.get("lunch-room:v1"),
		) as { snapshot: RoomSnapshot };
		saved.snapshot.history = [structuredClone(draw)];
		context.storage.values.set("lunch-room:v1", saved);
		const restored = createServer(context);
		await restored.onStart();
		await send(restored, guest, {
			type: "vote",
			id: "legacy-history-choice",
			drawId: draw.id,
			vote: "up",
		});
		expect(voteErrors(guest, "legacy-history-choice")).toMatchObject([
			{ code: "VOTE_CLOSED" },
		]);
		expect(latestSnapshot(host).snapshot.history).toEqual([draw]);
		await send(restored, host, { type: "start", id: "after-legacy-history" });
		await context.drain();
		expect(latestSnapshot(host).snapshot.history).toEqual([draw]);
	});

	it("caps each result at60 ballots and retains voter proofs through roster eviction and server reload", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await send(server, host, { type: "start", id: "many-votes-1" });
		await context.drain();
		vi.advanceTimersByTime(8700);
		await server.onAlarm();
		const voters: { id: string; token: string }[] = [];
		for (let index = 0; index < 65; index++) {
			vi.advanceTimersByTime(1);
			const token = `retained-voter-proof-${index}`;
			const guest = await connect(
				server,
				context,
				`투표자${index}`,
				undefined,
				undefined,
				token,
			);
			voters.push({ id: latestSnapshot(guest).self?.id ?? "", token });
			if (index === 60) {
				await send(server, guest, {
					type: "vote",
					id: "over-cap-choice",
					drawId: "many-votes-1",
					vote: "up",
				});
				expect(voteErrors(guest, "over-cap-choice")).toMatchObject([
					{ code: "VOTE_LIMIT" },
				]);
				await send(server, host, { type: "start", id: "many-votes-2" });
				await context.drain();
				vi.advanceTimersByTime(8700);
				await server.onAlarm();
			}
			await send(server, guest, {
				type: "vote",
				id: `choice-${index}`,
				drawId: index < 60 ? "many-votes-1" : "many-votes-2",
				vote: "up",
			});
			guest.closed = true;
			await server.onClose(socketConnection(guest));
		}
		for (let index = 0; index < 65; index++) {
			vi.advanceTimersByTime(1);
			const guest = await connect(
				server,
				context,
				`대기자${index}`,
				undefined,
				undefined,
				`nonvoter-guest-proof-${index}`,
			);
			guest.closed = true;
			await server.onClose(socketConnection(guest));
		}
		const currentVoter = voters[64];
		const before = latestSnapshot(host).snapshot;
		expect(before.history[0].votes).toHaveLength(60);
		expect(before.draw?.votes).toHaveLength(5);
		expect(before.members?.some((entry) => entry.id === currentVoter.id)).toBe(
			false,
		);
		const stored = context.storage.values.get("lunch-room:v1") as {
			guestTokenIds: Record<string, string>;
		};
		expect(Object.values(stored.guestTokenIds)).toContain(currentVoter.id);
		expect(Object.keys(stored.guestTokenIds).length).toBeGreaterThan(60);
		expect(Object.keys(stored.guestTokenIds).length).toBeLessThanOrEqual(
			lunchRoomLimits.maxMembers * (lunchRoomLimits.maxHistory + 2),
		);
		const restored = createServer(context);
		await restored.onStart();
		const returned = await connect(
			restored,
			context,
			"돌아온참가자",
			undefined,
			undefined,
			currentVoter.token,
		);
		expect(latestSnapshot(returned).self?.id).toBe(currentVoter.id);
		await send(restored, returned, {
			type: "vote",
			id: "evicted-voter-repeat",
			drawId: "many-votes-2",
			vote: "down",
		});
		expect(voteErrors(returned, "evicted-voter-repeat")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
		expect(latestSnapshot(host).snapshot.draw?.votes).toEqual(
			before.draw?.votes,
		);
	});
});

describe("LunchRoomServer nickname availability", () => {
	it("normalizes names, excludes only proven identities, and does not register or mutate any participants", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guestToken = "g".repeat(64);
		const guest = await connect(
			server,
			context,
			"Alice",
			undefined,
			undefined,
			guestToken,
		);
		const storageBefore = structuredClone(context.storage.values);
		const alarmBefore = context.storage.alarm;
		const hostBefore = structuredClone(host.state);
		const guestBefore = structuredClone(guest.state);
		const sentBefore = [host.sent.length, guest.sent.length];
		for (const [input, name, available] of [
			[{ name: " ＡLICE " }, "ALICE", false],
			[{ name: "새이름" }, "새이름", true],
			[{ name: "방장" }, "방장", false],
			[{ name: "방장", hostToken }, "방장", true],
			[{ name: "alice", guestToken }, "alice", true],
			[{ name: "방장", guestToken }, "방장", false],
			[{ name: "방장", guestToken: hostToken }, "방장", false],
			[{ name: "alice", guestToken: "unknown-guest-proof" }, "alice", false],
		] as const)
			expect(await server.checkNicknameAvailability(input)).toEqual({
				status: 200,
				body: { name, available },
			});
		expect(context.storage.values).toEqual(storageBefore);
		expect(context.storage.alarm).toBe(alarmBefore);
		expect(context.sockets.size).toBe(2);
		expect(host.state).toEqual(hostBefore);
		expect(guest.state).toEqual(guestBefore);
		expect([host.sent.length, guest.sent.length]).toEqual(sentBefore);
		expect(entropy).not.toHaveBeenCalled();
	});

	it("keeps away names unavailable without refreshing activity and permits offline name reuse", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "동료");
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs);
		await server.onAlarm();
		const activeAt = member(host, guest.state?.participant?.id).lastActiveAt;
		expect(await server.checkNicknameAvailability({ name: "동료" })).toEqual({
			status: 200,
			body: { name: "동료", available: false },
		});
		expect(member(host, guest.state?.participant?.id)).toMatchObject({
			status: "away",
			lastActiveAt: activeAt,
		});
		guest.closed = true;
		await server.onClose(socketConnection(guest));
		expect(await server.checkNicknameAvailability({ name: "동료" })).toEqual({
			status: 200,
			body: { name: "동료", available: true },
		});
	});

	it("returns explicit validation and host-proof errors rather than ignoring an invalid supplied proof", async () => {
		const { server, context } = await room();
		await connect(server, context, "방장", hostToken);
		for (const name of ["", " ", "가".repeat(13), "\u200b", "이\n름"])
			expect(await server.checkNicknameAvailability({ name })).toMatchObject({
				status: 400,
				body: { code: "INVALID_NICKNAME" },
			});
		for (const invalid of [null, [], false, 1])
			expect(await server.checkNicknameAvailability(invalid)).toMatchObject({
				status: 400,
				body: { code: "INVALID_REQUEST" },
			});
		for (const proof of [null, "", 1, "b".repeat(64)]) {
			const response = await server.checkNicknameAvailability({
				name: "새이름",
				hostToken: proof,
			});
			expect(response).toEqual({
				status: 403,
				body: { code: "HOST_AUTH_FAILED", error: "방장 인증을 확인해 주세요." },
			});
		}
		for (const guestToken of [null, 1, "short"])
			expect(
				await server.checkNicknameAvailability({ name: "새이름", guestToken }),
			).toMatchObject({ status: 400, body: { code: "INVALID_REQUEST" } });
	});

	it("loads a saved identity for self-exclusion without creating a connection or changing its stored name", async () => {
		const { server, context } = await room();
		const guestToken = "g".repeat(64);
		await connect(
			server,
			context,
			"기존참가자",
			undefined,
			undefined,
			guestToken,
		);
		const before = structuredClone(context.storage.values);
		const restored = createServer(context);
		expect(
			await restored.checkNicknameAvailability({
				name: "기존참가자",
				guestToken,
			}),
		).toEqual({ status: 200, body: { name: "기존참가자", available: true } });
		expect(context.storage.values).toEqual(before);
		expect(context.sockets.size).toBe(1);
	});

	it("returns404 for a missing room and410 for an expired room without extending or deleting data during a check", async () => {
		const missingContext = new HarnessContext();
		const missing = createServer(missingContext);
		expect(await missing.checkNicknameAvailability({ name: "이름" })).toEqual({
			status: 404,
			body: { code: "ROOM_NOT_FOUND", error: "방을 찾을 수 없습니다." },
		});
		expect(missingContext.storage.values.size).toBe(0);
		expect(missingContext.sockets.size).toBe(0);
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const before = structuredClone(context.storage.values);
		const sentBefore = host.sent.length;
		vi.setSystemTime(latestExpiry(context));
		expect(await server.checkNicknameAvailability({ name: "이름" })).toEqual({
			status: 410,
			body: { code: "ROOM_EXPIRED", error: "방이 만료됐습니다." },
		});
		expect(context.storage.values).toEqual(before);
		expect(context.storage.deleteCount).toBe(0);
		expect(host.sent).toHaveLength(sentBefore);
		expect(host.closed).toBe(false);
	});

	it("does not reserve a checked name and still rejects a join if another person claims it first", async () => {
		const { server, context } = await room();
		expect(
			await server.checkNicknameAvailability({ name: "같은이름" }),
		).toEqual({ status: 200, body: { name: "같은이름", available: true } });
		await connect(server, context, "같은이름");
		const late = await connect(server, context, "같은이름");
		expect(late.state?.participant).toBeUndefined();
		expect(hasError(late, "NICKNAME_TAKEN")).toBe(true);
	});
});

function storedSnapshot(context: HarnessContext) {
	return (
		context.storage.values.get("lunch-room:v1") as {
			snapshot: { status: string; expiresAt: number };
		}
	).snapshot;
}
function latestExpiry(context: HarnessContext) {
	return storedSnapshot(context).expiresAt;
}
