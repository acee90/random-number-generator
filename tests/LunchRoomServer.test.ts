import type { Connection } from "partyserver";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as wheel from "../src/lib/lunch";
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	getEligibleRoomCandidates,
	lunchRoomLimits,
	parseRoomSnapshot,
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
	chatProtocol?: "delta-v1";
	voteProtocol?: "delta-v1";
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
	async sync() {}
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
	finalizeInitialEditOnHostJoin = true;
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
function currentRevision(socket: TestSocket) {
	const snapshot = latestSnapshot(socket).snapshot;
	return snapshot.revision ?? snapshot.listVersion;
}

/** Test setup follows the same explicit editing boundary as the host UI. */
async function editPreparedRoom(
	server: LunchRoomServer,
	host: TestSocket,
	edit: { id: string; title?: string; candidates?: RoomSnapshot["candidates"] },
) {
	const entered = latestSnapshot(host).snapshot.status === "waiting";
	if (entered) {
		await send(server, host, {
			type: "intake",
			id: `${edit.id}-prepare`,
			action: "edit",
			expectedRevision: currentRevision(host),
		});
		expect(latestSnapshot(host).snapshot.status).toBe("editing");
	}
	await send(server, host, {
		type: "room-edit",
		baseListVersion: latestSnapshot(host).snapshot.listVersion,
		...edit,
	});
	if (
		entered &&
		getEligibleRoomCandidates(latestSnapshot(host).snapshot).length > 0
	) {
		await send(server, host, {
			type: "intake",
			id: `${edit.id}-finish`,
			action: "finalize",
			expectedRevision: currentRevision(host),
		});
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
	}
}

async function returnToWaiting(server: LunchRoomServer, socket: TestSocket) {
	const draw = latestSnapshot(socket).snapshot.draw;
	if (!draw) throw new Error("Expected a completed result");
	await send(server, socket, {
		type: "next",
		id: `next-${draw.id}`,
		drawId: draw.id,
	});
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
	if (
		context.finalizeInitialEditOnHostJoin &&
		socket.state?.participant?.isHost &&
		latestSnapshot(socket).snapshot.status === "editing"
	) {
		context.finalizeInitialEditOnHostJoin = false;
		await send(server, socket, {
			type: "intake",
			id: "fixture-finalize-initial-edit",
			action: "finalize",
			expectedRevision: currentRevision(socket),
		});
	}
	return socket;
}
async function room(prepareForDraw = true) {
	const context = new HarnessContext();
	context.finalizeInitialEditOnHostJoin = prepareForDraw;
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
	it("persists an explicit host closure, closes everyone and rejects reentry after wake until TTL cleanup", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		const unjoined = await connect(server, context);
		await send(server, unjoined, { type: "room-close", id: "close-unjoined" });
		expect(hasError(unjoined, "JOIN_REQUIRED")).toBe(true);
		await send(server, guest, { type: "room-close", id: "close-guest" });
		expect(hasError(guest, "HOST_REQUIRED")).toBe(true);
		expect(storedSnapshot(context).status).toBe("waiting");
		const expiresAt = storedSnapshot(context).expiresAt;
		await send(server, host, { type: "room-close", id: "close-host" });
		expect(storedSnapshot(context).status).toBe("closed");
		expect(storedSnapshot(context).expiresAt).toBe(expiresAt);
		for (const socket of [host, guest, unjoined]) {
			expect(socket.closed).toBe(true);
			expect(hasError(socket, "ROOM_CLOSED")).toBe(true);
		}
		const restored = createServer(context);
		await restored.onStart();
		const returning = await connect(restored, context, "방장", hostToken);
		expect(returning.closed).toBe(true);
		expect(hasError(returning, "ROOM_CLOSED")).toBe(true);
		expect(await restored.getEntryInfo()).toMatchObject({
			status: 410,
			body: { code: "ROOM_CLOSED" },
		});
		expect(
			await restored.checkNicknameAvailability({ name: "새 참가자" }),
		).toMatchObject({ status: 410, body: { code: "ROOM_CLOSED" } });
		vi.setSystemTime(expiresAt);
		await restored.onAlarm();
		expect(context.storage.values.size).toBe(0);
		expect(context.storage.alarm).toBeNull();
	});

	it("lets only former participants read closed history across wake without extending TTL or exposing chat/proofs", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guestToken = "g".repeat(64);
		await connect(server, context, "참가자", undefined, undefined, guestToken);
		expect((await server.getClosedHistory({ hostToken })).status).toBe(409);
		await send(server, host, { type: "start", id: "archive-draw" });
		await context.drain();
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
		await server.onAlarm();
		const draw = latestSnapshot(host).snapshot.draw;
		await returnToWaiting(server, host);
		await send(server, host, { type: "start", id: "last-draw" });
		await context.drain();
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
		await server.onAlarm();
		const last = latestSnapshot(host).snapshot.draw;
		await send(server, host, { type: "room-close", id: "archive-close" });
		const restored = createServer(context);
		await restored.onStart();
		const before = structuredClone(context.storage.values);
		const alarm = context.storage.alarm;
		for (const proof of [
			{},
			{ hostToken: "z".repeat(64) },
			{ guestToken: "z".repeat(64) },
			{ guestToken: hostToken },
			null,
		])
			expect((await restored.getClosedHistory(proof)).status).toBe(403);
		for (const proof of [{ hostToken }, { guestToken }]) {
			const result = await restored.getClosedHistory(proof);
			expect(result).toEqual({
				status: 200,
				body: {
					title: "오늘의 점심",
					expiresAt: storedSnapshot(context).expiresAt,
					draws: [last, draw],
				},
			});
			expect(Object.keys(result.body).sort()).toEqual([
				"draws",
				"expiresAt",
				"title",
			]);
		}
		expect(context.storage.values).toEqual(before);
		expect(context.storage.alarm).toBe(alarm);
		vi.setSystemTime(storedSnapshot(context).expiresAt);
		expect((await restored.getClosedHistory({ hostToken })).status).toBe(410);
		await restored.onAlarm();
		expect(context.storage.values.size).toBe(0);
		expect((await restored.getClosedHistory({ guestToken })).status).toBe(410);
	});

	it("keeps a room usable on closure save failure and permits a retry", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const before = storedSnapshot(context);
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("save failure"),
		);
		await send(server, host, { type: "room-close", id: "close-retry" });
		expect(hasError(host, "SAVE_FAILED")).toBe(true);
		expect(host.closed).toBe(false);
		expect(storedSnapshot(context)).toEqual(before);
		await send(server, host, { type: "room-close", id: "close-retry" });
		expect(storedSnapshot(context).status).toBe("closed");
	});

	it("rejects closure while entropy is being fetched", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		entropy.mockImplementationOnce(() => new Promise(() => {}));
		await send(server, host, { type: "start", id: "pending-draw" });
		await send(server, host, { type: "room-close", id: "close-drawing" });
		expect(hasError(host, "DRAW_BUSY")).toBe(true);
		expect(storedSnapshot(context).status).toBe("fetching");
		expect(host.closed).toBe(false);
	});

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
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
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
		await returnToWaiting(restored, host);
		await send(restored, host, {
			type: "start",
			id: "after-nickname-migration",
			expectedRevision: currentRevision(host),
			confirmReset: true,
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
		expect(
			(await server.onRequest(new Request("https://room.internal/"))).status,
		).toBe(404);
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
			{ candidateIds: ["unknown-candidate"] },
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
			type: "room-edit",
			id: "forged-candidates",
			baseListVersion: latestSnapshot(host).snapshot.listVersion,
			candidates: candidates.slice(0, 2),
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
			type: "room-edit",
			id: "fetching-candidates",
			baseListVersion: latestSnapshot(first).snapshot.listVersion,
			candidates: candidates.slice(0, 2),
		});
		expect(hasError(first, "DRAW_BUSY")).toBe(true);
		complete({ numbers: [2], source: "quantum" });
		await context.drain();
		await send(server, second, { type: "start", id: "same-request" });
		expect(entropy).toHaveBeenCalledTimes(1);
		expect(latestSnapshot(second).snapshot.draw?.winnerIndex).toBe(2);
		expect(systemEvents(second, "draw-started")).toHaveLength(1);
	});

	it("varies stops for repeated winners and restores the exact shared angle on wake", async () => {
		vi.spyOn(wheel, "randomWheelLandingFraction")
			.mockReturnValueOnce(0.15)
			.mockReturnValueOnce(0.85);
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await send(server, host, { type: "start", id: "offset-first" });
		await context.drain();
		const first = latestSnapshot(host).snapshot.draw;
		if (!first) throw new Error("Expected a draw");
		expect(first.durationMs).toBe(4000);
		expect(first.landingFraction).toBe(0.15);
		vi.setSystemTime(first.startedAt + first.durationMs);
		await returnToWaiting(server, host);
		await send(server, host, {
			type: "start",
			id: "offset-second",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
		await context.drain();
		const second = latestSnapshot(host).snapshot.draw;
		if (!second) throw new Error("Expected a second draw");
		expect(second.winnerIndex).toBe(first.winnerIndex);
		expect(second.landingFraction).toBe(0.85);
		expect(second.toRotation).not.toBe(first.toRotation);
		expect(latestSnapshot(host).snapshot.history[0]).toEqual(first);
		const restored = createServer(context);
		await restored.onStart();
		const late = await connect(restored, context, "새 참가자");
		expect(latestSnapshot(late).snapshot.draw).toEqual(second);
		expect(latestSnapshot(late).snapshot.history[0]).toEqual(first);
	});

	it("shares canonical timing and immutable candidates, then archives only on an explicit return to waiting", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await send(server, host, { type: "start", id: "first-draw" });
		await context.drain();
		const draw = latestSnapshot(host).snapshot.draw;
		expect(draw).not.toBeNull();
		expect(draw?.startedAt).toBe(Date.now() + 1500);
		expect(draw?.durationMs).toBe(4000);
		expect(draw?.fromRotation).toBe(0);
		expect(draw?.landingFraction).toBeGreaterThanOrEqual(0.1);
		expect(draw?.landingFraction).toBeLessThanOrEqual(0.9);
		expect(draw?.toRotation).toBe(
			wheel.getWheelRotation(
				0,
				draw?.winnerIndex ?? 0,
				draw?.candidates.length ?? 1,
				draw?.landingFraction,
			),
		);
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		const late = await connect(server, context, "늦은 참가자");
		expect(latestSnapshot(late).snapshot.draw).toEqual(draw);
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs - 1);
		await server.onAlarm();
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		vi.advanceTimersByTime(1);
		await server.onAlarm();
		await server.onAlarm();
		expect(latestSnapshot(host).snapshot.status).toBe("result");
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(systemEvents(host, "draw-finished")).toHaveLength(1);
		expect(systemEvents(host, "draw-finished")[0].text).toContain(
			candidates[1].name,
		);
		await send(server, host, {
			type: "room-edit",
			id: "next-round-candidates",
			baseListVersion: latestSnapshot(host).snapshot.listVersion,
			candidates: candidates.slice(0, 2),
		});
		const snapshot = latestSnapshot(host).snapshot;
		expect(hasError(host, "PHASE_CONFLICT")).toBe(true);
		expect(snapshot.listVersion).toBe(1);
		expect(snapshot.candidates).toHaveLength(3);
		expect(snapshot.draw?.candidates).toEqual(candidates);
		expect(snapshot.history).toEqual([]);
		await send(server, host, { type: "start", id: "result-cannot-start" });
		expect(entropy).toHaveBeenCalledTimes(1);
		expect(latestSnapshot(host).snapshot.draw).toEqual(draw);
		await returnToWaiting(server, host);
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		expect(latestSnapshot(host).snapshot.history).toEqual([draw]);
		await editPreparedRoom(server, host, {
			id: "prepared-next-round-candidates",
			candidates: candidates.slice(0, 2),
		});
		await send(server, host, {
			type: "start",
			id: "second-draw",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
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
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
		await server.onAlarm();
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(latestSnapshot(host).snapshot.draw).toEqual(draw);
		await returnToWaiting(restored, host);
		await send(restored, host, {
			type: "start",
			id: "archive-captured-metadata",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
		expect(latestSnapshot(host).snapshot.history[0]).toEqual(draw);
		await context.drain();
	});

	it("restores a legacy draw without fabricating missing participant or probability metadata", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "현재 방장", hostToken);
		await send(server, host, { type: "start", id: "legacy-draw" });
		await context.drain();
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
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

	it("sends small ACK/deltas to negotiated clients and snapshots to legacy sockets", async () => {
		const { server, context } = await room();
		const sender = await connect(server, context, "측정");
		const peer = await connect(server, context, "동료");
		const legacy = await connect(server, context, "이전버전");
		// Negotiate through the actual join parser/state, not test-only state mutation.
		const modern = await connect(server, context);
		await send(server, modern, {
			type: "join",
			name: "신규",
			chatProtocol: "delta-v1",
		});
		expect(modern.state?.chatProtocol).toBe("delta-v1");
		sender.setState({ ...sender.state, chatProtocol: "delta-v1" });
		peer.setState({ ...peer.state, chatProtocol: "delta-v1" });
		const sync = vi.spyOn(context.storage, "sync");
		await send(server, sender, {
			type: "chat",
			id: "delta-chat",
			text: "작은 메시지",
		});
		expect(messages(sender).at(-1)).toMatchObject({
			type: "chat-ack",
			message: { id: "delta-chat" },
		});
		expect(messages(peer).at(-1)).toMatchObject({
			type: "chat-message",
			message: { id: "delta-chat" },
		});
		expect(messages(modern).at(-1)?.type).toBe("chat-message");
		expect(latestSnapshot(legacy).snapshot.messages.at(-1)?.id).toBe(
			"delta-chat",
		);
		expect(sender.sent.at(-1)).not.toContain('"snapshot"');
		expect(sync).not.toHaveBeenCalled();
		// A duplicate recovers a full authoritative snapshot without re-broadcast.
		const peerCount = peer.sent.length;
		await send(server, sender, {
			type: "chat",
			id: "delta-chat",
			text: "duplicate",
		});
		expect(
			latestSnapshot(sender).snapshot.messages.filter(
				(x) => x.id === "delta-chat",
			),
		).toHaveLength(1);
		expect(peer.sent).toHaveLength(peerCount);
		const restored = createServer(context);
		const reconnected = await connect(restored, context, "재접속");
		expect(
			latestSnapshot(reconnected).snapshot.messages.some(
				(x) => x.id === "delta-chat",
			),
		).toBe(true);
	});

	it("waits for debug disk sync before ACK or peer delivery and includes flush timing only on the sender", async () => {
		const { server, context } = await room();
		const sender = await connect(server, context, "측정");
		const peer = await connect(server, context, "동료");
		sender.setState({ ...sender.state, chatProtocol: "delta-v1" });
		peer.setState({ ...peer.state, chatProtocol: "delta-v1" });
		vi.spyOn(console, "info").mockImplementation(() => {});
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.spyOn(context.storage, "sync").mockImplementation(() => blocked);
		const senderCount = sender.sent.length,
			peerCount = peer.sent.length;
		const diagnosticId = crypto.randomUUID();
		const pending = send(server, sender, {
			type: "chat",
			id: "flush-chat",
			text: "flush",
			diagnosticId,
		});
		await vi.waitFor(() => expect(context.storage.sync).toHaveBeenCalledOnce());
		expect(sender.sent).toHaveLength(senderCount);
		expect(peer.sent).toHaveLength(peerCount);
		await vi.advanceTimersByTimeAsync(120);
		release();
		await pending;
		const ack = messages(sender).at(-1);
		expect(ack).toMatchObject({
			type: "chat-ack",
			chatTrace: { diagnosticId, syncMs: expect.any(Number) },
		});
		if (ack?.type !== "chat-ack") throw new Error("Missing ACK");
		expect(ack.chatTrace?.syncMs).toBeGreaterThanOrEqual(120);
		expect(messages(peer).at(-1)).not.toHaveProperty("chatTrace");
		expect(JSON.stringify([...context.storage.values])).not.toContain(
			diagnosticId,
		);
	});

	it("does not acknowledge or broadcast when debug disk sync fails", async () => {
		const { server, context } = await room();
		const sender = await connect(server, context, "측정");
		sender.setState({ ...sender.state, chatProtocol: "delta-v1" });
		const before = sender.sent.length;
		vi.spyOn(context.storage, "sync").mockRejectedValue(
			new Error("disk failure"),
		);
		await expect(
			send(server, sender, {
				type: "chat",
				id: "failed-flush",
				text: "flush",
				diagnosticId: crypto.randomUUID(),
			}),
		).rejects.toThrow("disk failure");
		expect(sender.sent).toHaveLength(before);
	});

	it.each([
		undefined,
		"delta-v1",
	] as const)("rolls back a failed chat save without evicting history or consuming its retry (%s)", async (chatProtocol) => {
		const { server, context } = await room();
		const sender = await connect(server, context, "작성자");
		const other = await connect(server, context, "다른사람");
		if (chatProtocol) sender.setState({ ...sender.state, chatProtocol });
		for (let index = 0; index < 100; index++) {
			vi.advanceTimersByTime(750);
			await send(server, sender, {
				type: "chat",
				id: `retained-${index}`,
				text: `메시지${index}`,
			});
		}
		const before = structuredClone(latestSnapshot(other).snapshot.messages);
		const socketBefore = structuredClone(sender.state);
		const otherSent = other.sent.length;
		vi.advanceTimersByTime(750);
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("unavailable"),
		);
		const command = {
			type: "chat",
			id: "retry-after-save",
			text: "다시 보낼 메시지",
		};
		await expect(send(server, sender, command)).resolves.toBeUndefined();
		expect(messages(sender).at(-1)).toMatchObject({
			type: "error",
			code: "SAVE_FAILED",
			requestId: command.id,
		});
		expect(sender.state).toEqual(socketBefore);
		expect(other.sent).toHaveLength(otherSent);
		expect(storedSnapshot(context).messages).toEqual(before);
		await send(server, sender, {
			type: "chat",
			id: "retained-99",
			text: "duplicate",
		});
		expect(latestSnapshot(sender).snapshot.messages).toEqual(before);
		await send(server, sender, command);
		await send(server, sender, command);
		const after = latestSnapshot(other).snapshot.messages;
		expect(after).toHaveLength(100);
		expect(after.slice(0, -1)).toEqual(before.slice(1));
		expect(after.at(-1)).toMatchObject({ id: command.id, text: command.text });
		expect(after.filter((entry) => entry.id === command.id)).toHaveLength(1);
		expect(storedSnapshot(context).messages).toEqual(after);
		await createServer(context).onStart();
		expect(latestSnapshot(sender).snapshot.messages).toEqual(after);
	});

	it("returns opt-in timings only to the sender after storage and never persists telemetry", async () => {
		const { server, context } = await room();
		const sender = await connect(server, context, "측정");
		const other = await connect(server, context, "다른사람");
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const diagnosticId = crypto.randomUUID();
		const originalPut = context.storage.put.bind(context.storage);
		let release!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.spyOn(context.storage, "put").mockImplementation(async (key, value) => {
			await blocked;
			await originalPut(key, value);
		});
		const before = sender.sent.length;
		const pending = send(server, sender, {
			type: "chat",
			id: "traced-message",
			text: "private diagnostic text",
			diagnosticId,
		});
		await vi.waitFor(() => expect(context.storage.put).toHaveBeenCalled());
		expect(sender.sent).toHaveLength(before);
		await vi.advanceTimersByTimeAsync(200);
		release();
		await pending;
		expect(latestSnapshot(sender).chatTrace).toMatchObject({ diagnosticId });
		expect(latestSnapshot(sender).chatTrace?.saveMs).toBeGreaterThanOrEqual(
			200,
		);
		const raw = JSON.parse(sender.sent.at(-1) as string);
		raw.chatTrace.queueMs = -1;
		expect(parseServerMessage(JSON.stringify(raw))).toMatchObject({
			type: "snapshot",
		});
		expect(
			(
				parseServerMessage(JSON.stringify(raw)) as Extract<
					ServerMessage,
					{ type: "snapshot" }
				>
			).chatTrace,
		).toBeUndefined();
		expect(latestSnapshot(other).chatTrace).toBeUndefined();
		expect(JSON.stringify([...context.storage.values])).not.toContain(
			diagnosticId,
		);
		expect(JSON.stringify(info.mock.calls)).toContain(diagnosticId);
		expect(JSON.stringify(info.mock.calls)).not.toContain(
			"private diagnostic text",
		);
		expect(JSON.stringify(info.mock.calls)).not.toContain(context.id.name);
		// Telemetry is transient; later snapshots must not replay it.
		await send(server, sender, {
			type: "chat",
			id: "traced-message",
			text: "duplicate",
		});
		expect(latestSnapshot(sender).chatTrace).toBeUndefined();
		expect(
			latestSnapshot(sender).snapshot.messages.filter(
				(entry) => entry.id === "traced-message",
			),
		).toHaveLength(1);
	});

	it("ignores malformed opt-in IDs and does not instrument ordinary chat or rejected chat", async () => {
		const { server, context } = await room();
		const sender = await connect(server, context, "측정");
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		await send(server, sender, {
			type: "chat",
			id: "plain-chat",
			text: "hello",
			diagnosticId: "private invalid value",
		});
		expect(latestSnapshot(sender).chatTrace).toBeUndefined();
		await send(server, sender, {
			type: "chat",
			id: "too-fast",
			text: "hello",
			diagnosticId: crypto.randomUUID(),
		});
		expect(hasError(sender, "CHAT_RATE_LIMIT")).toBe(true);
		expect(info).not.toHaveBeenCalled();
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
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot.history).toEqual([]);
		expect(latestSnapshot(host).snapshot.draw?.id).toBe("draw-0");
		for (let index = 1; index <= 20; index++) {
			await returnToWaiting(restored, host);
			await send(restored, host, {
				type: "start",
				id: `draw-${index}`,
				expectedRevision: currentRevision(host),
				confirmReset: true,
			});
			await context.drain();
			vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
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
				type: "room-edit",
				id: "presence-candidates",
				baseListVersion: latestSnapshot(host).snapshot.listVersion,
				candidates: candidates.slice(0, 2),
			},
			{ type: "start", id: "presence-draw" },
		] as const) {
			vi.advanceTimersByTime(1000);
			if (message.type === "room-edit")
				await editPreparedRoom(server, host, message);
			else await send(server, host, message);
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
			vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
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

	it.each([
		true,
		false,
	])("rejects new identities joining after the draw request (already finished: %s), including after restoration", async (finished) => {
		const { server, context, host, draw } = await votingRoom(finished);
		const lateProof = "late-arrival-proof-token";
		const late = await connect(
			server,
			context,
			"늦은참가자",
			undefined,
			undefined,
			lateProof,
		);
		if (!finished) {
			vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
			await server.onAlarm();
		}
		await send(server, late, {
			type: "vote",
			id: "late-vote",
			drawId: draw.id,
			vote: "up",
		});
		expect(voteErrors(late, "late-vote")).toMatchObject([
			{ code: "VOTE_NOT_ELIGIBLE" },
		]);
		expect(latestSnapshot(host).snapshot.draw?.votes).toEqual([]);
		const restored = createServer(context);
		await restored.onStart();
		const returned = await connect(
			restored,
			context,
			"늦은참가자",
			undefined,
			undefined,
			lateProof,
		);
		await send(restored, returned, {
			type: "vote",
			id: "late-restored",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(returned, "late-restored")).toMatchObject([
			{ code: "VOTE_NOT_ELIGIBLE" },
		]);
	});
	it("only lets the host close completed voting, persists it for all clients, and ignores stale repeats", async () => {
		const { server, context, host, guest, draw } = await votingRoom(false);
		await send(server, guest, {
			type: "next",
			id: "forged-next",
			drawId: draw.id,
		});
		expect(voteErrors(guest, "forged-next")).toMatchObject([
			{ code: "HOST_REQUIRED" },
		]);
		await send(server, host, {
			type: "next",
			id: "early-next",
			drawId: draw.id,
		});
		expect(voteErrors(host, "early-next")).toMatchObject([
			{ code: "VOTE_NOT_READY" },
		]);
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
		await server.onAlarm();
		await send(server, guest, {
			type: "vote",
			id: "before-close",
			drawId: draw.id,
			vote: "up",
		});
		const frozen = structuredClone(latestSnapshot(host).snapshot.draw);
		await send(server, host, {
			type: "next",
			id: "close-voting",
			drawId: draw.id,
		});
		for (const client of [host, guest])
			expect(latestSnapshot(client).snapshot).toMatchObject({
				draw: null,
				status: "waiting",
				history: [frozen],
			});
		await send(server, guest, {
			type: "vote",
			id: "after-close",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(guest, "after-close")).toMatchObject([
			{ code: "VOTE_CLOSED" },
		]);
		const restored = createServer(context);
		await restored.onStart();
		await send(restored, host, {
			type: "start",
			id: "new-after-close",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
		await context.drain();
		await send(restored, host, {
			type: "next",
			id: "close-voting",
			drawId: draw.id,
		});
		expect(latestSnapshot(host).snapshot.draw?.id).toBe("new-after-close");
		expect(latestSnapshot(host).snapshot.history).toEqual([frozen]);
	});
	it.each([
		"vote-first",
		"close-first",
	])("serializes closing and a racing ballot: %s", async (order) => {
		const { server, context, host, guest, draw } = await votingRoom();
		const ballot = () =>
			send(server, guest, {
				type: "vote",
				id: "racing-vote",
				drawId: draw.id,
				vote: "up",
			});
		const close = () =>
			send(server, host, { type: "next", id: "racing-next", drawId: draw.id });
		await Promise.all(
			order === "vote-first" ? [ballot(), close()] : [close(), ballot()],
		);
		expect(latestSnapshot(host).snapshot.draw).toBeNull();
		expect(latestSnapshot(host).snapshot.history[0].votes).toHaveLength(
			order === "vote-first" ? 1 : 0,
		);
		const frozen = structuredClone(latestSnapshot(host).snapshot.history);
		await send(server, host, {
			type: "next",
			id: "repeat-next",
			drawId: draw.id,
		});
		await context.drain();
		expect(latestSnapshot(host).snapshot.history).toEqual(frozen);
	});

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

	it("rejects unjoined users, unknown rounds and pre-result votes from either role, but accepts exactly at reveal", async () => {
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
			{ code: "VOTE_NOT_READY" },
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
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs - 1);
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
		expect(latestSnapshot(host).snapshot.status).toBe("result");
	});

	it("persists the host's single authoritative vote across host tabs, wake and archival", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		const otherHost = await connect(server, context, "방장", hostToken);
		const participantId = latestSnapshot(host).self?.id;
		vi.advanceTimersByTime(450);
		const votedAt = Date.now();
		await send(server, host, {
			type: "vote",
			id: "host-first-vote",
			drawId: draw.id,
			vote: "up",
			participantId: latestSnapshot(guest).self?.id,
			name: "위조참가자",
			timestamp: 0,
			reactionMs: 0,
		});
		const expected = [
			{
				participantId,
				name: "방장",
				vote: "up",
				timestamp: votedAt,
				reactionMs: 450,
			},
		];
		for (const client of [host, otherHost, guest])
			expect(latestSnapshot(client).snapshot.draw?.votes).toEqual(expected);
		await send(server, otherHost, {
			type: "vote",
			id: "host-second-vote",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(otherHost, "host-second-vote")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
		const restored = createServer(context);
		await restored.onStart();
		const returned = await connect(restored, context, "방장", hostToken);
		expect(latestSnapshot(returned).self?.id).toBe(participantId);
		expect(latestSnapshot(returned).snapshot.draw?.votes).toEqual(expected);
		await send(restored, returned, {
			type: "vote",
			id: "host-after-wake",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(returned, "host-after-wake")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
		await send(restored, returned, {
			type: "next",
			id: "host-close-after-own-vote",
			drawId: draw.id,
		});
		await send(restored, returned, {
			type: "vote",
			id: "host-archived-vote",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(returned, "host-archived-vote")).toMatchObject([
			{ code: "VOTE_CLOSED" },
		]);
		expect(latestSnapshot(returned).snapshot.history[0].votes).toEqual(
			expected,
		);
	});

	it("sends only persisted vote deltas to opted-in sockets and full results to legacy and reconnecting sockets", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		const peer = await connect(server, context);
		await send(server, peer, {
			type: "join",
			name: "관찰",
			voteProtocol: "delta-v1",
		});
		expect(peer.state?.voteProtocol).toBe("delta-v1");
		host.setState({ ...host.state, voteProtocol: "delta-v1" });
		const ballot = {
			type: "vote",
			id: "delta-ballot",
			drawId: draw.id,
			vote: "up",
		};
		const peerBefore = messages(peer).length;
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("vote write failed"),
		);
		await send(server, host, ballot);
		expect(messages(peer)).toHaveLength(peerBefore);
		expect(voteErrors(host, ballot.id)).toMatchObject([
			{ code: "SAVE_FAILED" },
		]);
		const hostBefore = messages(host).length;
		await send(server, host, ballot);
		const recorded = storedSnapshot(context).draw?.votes?.[0];
		for (const [socket, offset] of [
			[host, hostBefore],
			[peer, peerBefore],
		] as const) {
			expect(messages(socket).slice(offset)).toEqual([
				{
					type: "vote-recorded",
					roomId: context.id.name,
					drawId: draw.id,
					voteCount: 1,
					vote: recorded,
				},
			]);
		}
		expect(latestSnapshot(guest).snapshot.draw?.votes).toEqual([recorded]);
		const returned = await connect(server, context);
		await send(server, returned, {
			type: "join",
			name: "방장",
			hostToken,
			voteProtocol: "delta-v1",
		});
		expect(latestSnapshot(returned).snapshot.draw?.votes).toEqual([recorded]);
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

	it("keeps voting open without a timer until explicit waiting return archives and freezes the complete result", async () => {
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
		await returnToWaiting(server, host);
		await send(server, host, {
			type: "start",
			id: "vote-draw-2",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
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
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
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
		"close-first",
	])("serializes a return-to-waiting race so archived votes never change: %s", async (order) => {
		const { server, context, host, guest, draw } = await votingRoom();
		const vote = () =>
			send(server, guest, {
				type: "vote",
				id: "racing-choice",
				drawId: draw.id,
				vote: "up",
			});
		const close = () =>
			send(server, host, {
				type: "next",
				id: "racing-close-result",
				drawId: draw.id,
			});
		await Promise.all(
			order === "vote-first" ? [vote(), close()] : [close(), vote()],
		);
		await context.drain();
		const archived = latestSnapshot(host).snapshot.history[0];
		expect(archived.id).toBe(draw.id);
		expect(archived.votes?.length ?? 0).toBe(order === "vote-first" ? 1 : 0);
		if (order === "close-first")
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
		await returnToWaiting(server, host);
		entropy.mockRejectedValueOnce(new Error("test entropy failure"));
		await send(server, host, {
			type: "start",
			id: "failed-next-draw",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
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
		await send(server, host, {
			type: "start",
			id: "fresh-next-draw",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
		await context.drain();
		expect(latestSnapshot(host).snapshot.history).toEqual([frozen]);
	});

	it("prepares the next round when a legacy current result is already archived, preserving that record", async () => {
		const { context, host, draw } = await votingRoom();
		const saved = context.storage.values.get("lunch-room:v1") as {
			snapshot: RoomSnapshot;
		};
		saved.snapshot.history = [structuredClone(draw)];
		context.storage.values.set("lunch-room:v1", saved);
		const restored = createServer(context);
		await restored.onStart();
		await send(restored, host, {
			type: "next",
			id: "legacy-next",
			drawId: draw.id,
		});
		expect(latestSnapshot(host).snapshot).toMatchObject({
			draw: null,
			status: "waiting",
			history: [draw],
		});
		await send(restored, host, {
			type: "next",
			id: "legacy-next-repeat",
			drawId: draw.id,
		});
		expect(latestSnapshot(host).snapshot.history).toEqual([draw]);
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
		await returnToWaiting(restored, host);
		await send(restored, host, {
			type: "start",
			id: "after-legacy-history",
			expectedRevision: currentRevision(host),
			confirmReset: true,
		});
		await context.drain();
		expect(latestSnapshot(host).snapshot.history).toEqual([draw]);
	});

	it("retains an eligible nonvoter identity through roster eviction and server reload", async () => {
		const { server, context, host, guest, draw } = await votingRoom();
		const participantId = latestSnapshot(guest).self?.id;
		guest.closed = true;
		await server.onClose(socketConnection(guest));
		for (let index = 0; index < 65; index++) {
			vi.advanceTimersByTime(1);
			const newcomer = await connect(
				server,
				context,
				`대기자${index}`,
				undefined,
				undefined,
				`nonvoter-guest-proof-${index}`,
			);
			newcomer.closed = true;
			await server.onClose(socketConnection(newcomer));
		}
		expect(
			latestSnapshot(host).snapshot.members?.some(
				(entry) => entry.id === participantId,
			),
		).toBe(false);
		const restored = createServer(context);
		await restored.onStart();
		const returned = await connect(
			restored,
			context,
			"돌아온참가자",
			undefined,
			undefined,
			guestProof,
		);
		expect(latestSnapshot(returned).self?.id).toBe(participantId);
		await send(restored, returned, {
			type: "vote",
			id: "eligible-after-eviction",
			drawId: draw.id,
			vote: "up",
		});
		expect(latestSnapshot(returned).snapshot.draw?.votes).toMatchObject([
			{ participantId, vote: "up" },
		]);
		await send(restored, returned, {
			type: "vote",
			id: "evicted-voter-repeat",
			drawId: draw.id,
			vote: "down",
		});
		expect(voteErrors(returned, "evicted-voter-repeat")).toMatchObject([
			{ code: "VOTE_ALREADY_CAST" },
		]);
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

function withoutPresence(snapshot: RoomSnapshot): RoomSnapshot {
	const copy = structuredClone(snapshot);
	delete copy.members;
	return copy;
}
describe("LunchRoomServer entry info read", () => {
	const request = () =>
		new Request("https://lunch-room.internal/_internal/lunch-room/entry-info");
	it("returns the current title without joining, saving, extending TTL, or refreshing activity", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await editPreparedRoom(server, host, {
			id: "entry-title-change",
			title: "변경한 방 이름",
		});
		const before = structuredClone(context.storage.values);
		const stateBefore = structuredClone(host.state);
		const alarmBefore = context.storage.alarm;
		const sentBefore = host.sent.length;
		const response = await server.onRequest(request());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ title: "변경한 방 이름" });
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(context.storage.values).toEqual(before);
		expect(context.storage.alarm).toBe(alarmBefore);
		expect(context.sockets.size).toBe(1);
		expect(host.state).toEqual(stateBefore);
		expect(host.sent).toHaveLength(sentBefore);
		expect(entropy).not.toHaveBeenCalled();
	});
	it("loads a saved title without exposing roster/proofs or changing its stored data", async () => {
		const { context } = await room();
		const before = structuredClone(context.storage.values);
		const restored = createServer(context);
		expect(await restored.getEntryInfo()).toEqual({
			status: 200,
			body: { title: "오늘의 점심" },
		});
		expect(context.storage.values).toEqual(before);
		expect(context.sockets.size).toBe(0);
	});
	it("reports missing and expired rooms without request-driven expiry mutations", async () => {
		const missingContext = new HarnessContext();
		const missing = createServer(missingContext);
		expect((await missing.onRequest(request())).status).toBe(404);
		expect(missingContext.storage.values.size).toBe(0);
		const { server, context } = await room();
		const before = structuredClone(context.storage.values);
		vi.setSystemTime(latestExpiry(context));
		const expired = await server.onRequest(request());
		expect(expired.status).toBe(410);
		expect(await expired.json()).toEqual({
			code: "ROOM_EXPIRED",
			error: "방이 만료됐습니다.",
		});
		expect(context.storage.values).toEqual(before);
		expect(context.storage.deleteCount).toBe(0);
	});
});

describe("LunchRoomServer internal nickname HTTP", () => {
	const request = (body: unknown, init: RequestInit = {}) =>
		new Request(
			"https://lunch-room.internal/_internal/lunch-room/nickname-availability",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				...init,
			},
		);

	it("reuses proven-identity checks and exposes only the result without joining or saving", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const before = structuredClone(context.storage.values);
		const stateBefore = structuredClone(host.state);
		const alarmBefore = context.storage.alarm;
		const sentBefore = host.sent.length;
		const response = await server.onRequest(
			request({ name: " 방장 ", hostToken }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ name: "방장", available: true });
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Server-Timing")).toMatch(
			/^nickname;dur=[\d.]+$/,
		);
		expect(context.storage.values).toEqual(before);
		expect(context.storage.alarm).toBe(alarmBefore);
		expect(context.sockets.size).toBe(1);
		expect(host.state).toEqual(stateBefore);
		expect(host.sent.length).toBe(sentBefore);
		const rejected = await server.onRequest(
			request({ name: "방장", hostToken: "b".repeat(64) }),
		);
		expect(rejected.status).toBe(403);
		expect(await rejected.json()).toEqual({
			code: "HOST_AUTH_FAILED",
			error: "방장 인증을 확인해 주세요.",
		});
	});

	it("loads persisted identities after a restart and retains authoritative join collision checks", async () => {
		const { server, context } = await room();
		const guestToken = "g".repeat(64);
		await connect(server, context, "동료", undefined, undefined, guestToken);
		const restored = createServer(context);
		// Server.fetch performs this hook before entering onRequest.
		await restored.onStart();
		const response = await restored.onRequest(
			request({ name: "동료", guestToken }),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ name: "동료", available: true });
		const checked = await restored.onRequest(request({ name: "새참가자" }));
		expect(await checked.json()).toEqual({ name: "새참가자", available: true });
		await connect(restored, context, "새참가자");
		const collision = await connect(restored, context, "새참가자");
		expect(hasError(collision, "NICKNAME_TAKEN")).toBe(true);
	});

	it("bounds and validates internal requests and rejects unrelated HTTP paths", async () => {
		const { server } = await room();
		for (const input of [
			new Request(
				"https://lunch-room.internal/_internal/lunch-room/nickname-availability",
			),
			new Request("https://lunch-room.internal/initialize", { method: "POST" }),
		])
			expect((await server.onRequest(input)).status).toBe(404);
		expect(
			(
				await server.onRequest(
					request({}, { headers: { "Content-Type": "text/plain" } }),
				)
			).status,
		).toBe(415);
		for (const body of ["{", "", new Uint8Array([0xff])])
			expect((await server.onRequest(request({}, { body }))).status).toBe(400);
		expect(
			(
				await server.onRequest(
					request({ name: "새이름", extra: "한".repeat(1400) }),
				)
			).status,
		).toBe(413);
	});

	it("returns the missing and expired room status through HTTP", async () => {
		const missing = await createServer(new HarnessContext()).onRequest(
			request({ name: "이름" }),
		);
		expect(missing.status).toBe(404);
		const { server, context } = await room();
		vi.setSystemTime(latestExpiry(context));
		const expired = await server.onRequest(request({ name: "이름" }));
		expect(expired.status).toBe(410);
		expect(await expired.json()).toMatchObject({ code: "ROOM_EXPIRED" });
	});
});

describe("LunchRoomServer alarm write coalescing", () => {
	it("keeps chat durable while skipping an unchanged alarm and writes a new activity deadline", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const setAlarm = vi.spyOn(context.storage, "setAlarm");
		const put = vi.spyOn(context.storage, "put");
		await send(server, host, {
			type: "chat",
			id: "first-chat",
			text: "첫 메시지",
		});
		expect(put).toHaveBeenCalledOnce();
		expect(setAlarm).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1000);
		await send(server, host, {
			type: "chat",
			id: "next-chat",
			text: "두 번째",
		});
		expect(put).toHaveBeenCalledTimes(2);
		expect(setAlarm).toHaveBeenCalledExactlyOnceWith(
			Date.now() + lunchRoomLimits.awayAfterMs,
		);
	});

	it("retries failed alarm writes rather than caching their deadline", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		vi.advanceTimersByTime(1000);
		const setAlarm = vi
			.spyOn(context.storage, "setAlarm")
			.mockRejectedValueOnce(new Error("temporary alarm failure"));
		await expect(
			send(server, host, { type: "activity" }),
		).resolves.toBeUndefined();
		await context.drain();
		expect(setAlarm).toHaveBeenCalledTimes(2);
		expect(context.storage.alarm).toBe(Date.now() + 1000);
		await send(server, host, { type: "activity" });
		expect(setAlarm).toHaveBeenCalledTimes(3);
		expect(context.storage.alarm).toBe(
			Date.now() + lunchRoomLimits.awayAfterMs,
		);
	});

	it("re-arms consumed alarms and reconstructs the cache after a restart", async () => {
		const { server, context } = await room();
		await connect(server, context, "방장", hostToken);
		const deadline = context.storage.alarm;
		const setAlarm = vi.spyOn(context.storage, "setAlarm");
		await server.onAlarm();
		expect(setAlarm).toHaveBeenCalledExactlyOnceWith(deadline);
		await createServer(context).onStart();
		expect(setAlarm).toHaveBeenCalledTimes(2);
		expect(context.storage.alarm).toBe(deadline);
	});
});

function storedSnapshot(context: HarnessContext) {
	return (
		context.storage.values.get("lunch-room:v1") as {
			snapshot: RoomSnapshot;
		}
	).snapshot;
}
function latestExpiry(context: HarnessContext) {
	return storedSnapshot(context).expiresAt;
}

describe("empty setup and independent game filter service", () => {
	const enterPreparation = async (
		server: LunchRoomServer,
		host: TestSocket,
	) => {
		await send(server, host, {
			type: "intake",
			id: crypto.randomUUID(),
			action: "edit",
			expectedRevision: currentRevision(host),
		});
		expect(latestSnapshot(host).snapshot.status).toBe("editing");
	};
	const filter = async (
		server: LunchRoomServer,
		host: TestSocket,
		id: string,
		value: NonNullable<RoomSnapshot["gameFilter"]>,
	) => {
		await send(server, host, {
			type: "game-filter",
			id,
			expectedRevision: currentRevision(host),
			filter: value,
		});
	};

	it("restores a room created with the maximum custom list and its inclusion flags", async () => {
		const { input } = await room(false);
		const context = new HarnessContext();
		const candidates = Array.from(
			{ length: lunchRoomLimits.maxCandidates },
			(_, index) => ({
				id: `saved-${index}`,
				name: "같은 이름",
				category: "팀 메뉴",
				included: index % 2 === 0,
			}),
		);
		await createServer(context).initialize({
			...input,
			candidateIds: [],
			candidates,
		});
		const restored = createServer(context);
		await restored.onStart();
		const host = await connect(restored, context, "방장", hostToken);
		expect(latestSnapshot(host).snapshot.candidates).toEqual(candidates);
	});

	it("creates empty rooms, keeps empty preparation editable and captures custom classifications in a one-candidate draw", async () => {
		const { input } = await room(false);
		for (const selection of [undefined, []]) {
			const context = new HarnessContext();
			context.finalizeInitialEditOnHostJoin = false;
			const server = createServer(context);
			await server.initialize({ ...input, candidateIds: selection });
			const host = await connect(server, context, "방장", hostToken);
			expect(latestSnapshot(host).snapshot).toMatchObject({
				status: "editing",
				candidates: [],
				gameFilter: { categories: null, excludedIds: [] },
			});
			await send(server, host, {
				type: "intake",
				id: "empty-finalize",
				action: "finalize",
				expectedRevision: currentRevision(host),
			});
			expect(hasError(host, "NO_CANDIDATES")).toBe(true);
			expect(storedSnapshot(context).status).toBe("editing");
			await send(server, host, {
				type: "room-edit",
				id: "add-custom",
				baseListVersion: 1,
				candidates: [
					{ id: "my-menu", name: "우리 메뉴", category: "  팀 메뉴  " },
				],
			});
			await send(server, host, {
				type: "intake",
				id: "custom-finalize",
				action: "finalize",
				expectedRevision: currentRevision(host),
			});
			entropy.mockResolvedValue({ numbers: [0], source: "csprng" });
			await send(server, host, {
				type: "start",
				id: "custom-draw",
				expectedRevision: currentRevision(host),
			});
			await context.drain();
			expect(latestSnapshot(host).snapshot.draw?.candidates).toMatchObject([
				{ id: "my-menu", name: "우리 메뉴", category: "팀 메뉴" },
			]);
			expect(latestSnapshot(host).snapshot.draw?.gameFilter).toEqual({
				categories: null,
				excludedIds: [],
			});
		}
	});

	it("rejects waiting filter changes and applies revisioned host-only preparation filters without changing the source list across replay, failure, wake and join", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		const waiting = structuredClone(latestSnapshot(host).snapshot);
		await filter(server, host, "waiting-filter-denied", {
			categories: [],
			excludedIds: [],
		});
		expect(hasError(host, "PHASE_CONFLICT")).toBe(true);
		expect(storedSnapshot(context).gameFilter).toEqual(waiting.gameFilter);
		expect(storedSnapshot(context).revision).toBe(waiting.revision);
		await enterPreparation(server, host);
		const before = structuredClone(latestSnapshot(host).snapshot);
		const command = {
			type: "game-filter",
			id: "filter-update",
			expectedRevision: currentRevision(host),
			filter: { categories: ["편의점"], excludedIds: [candidates[1].id] },
		};
		await send(server, guest, command);
		expect(hasError(guest, "HOST_REQUIRED")).toBe(true);
		await send(server, host, command);
		const after = structuredClone(latestSnapshot(host).snapshot);
		expect(after.status).toBe("editing");
		expect(after.candidates).toEqual(before.candidates);
		expect(after.listVersion).toBe(before.listVersion);
		expect(after.revision).toBe((before.revision ?? before.listVersion) + 1);
		expect(after.excludedIds).toEqual(before.excludedIds);
		expect(getEligibleRoomCandidates(after).map((item) => item.id)).toEqual([
			candidates[0].id,
		]);
		await send(server, host, command);
		expect(latestSnapshot(host).snapshot.revision).toBe(after.revision);
		await send(server, host, { ...command, id: "stale-filter" });
		expect(hasError(host, "REVISION_CONFLICT")).toBe(true);
		await filter(server, host, "unknown-filter-id", {
			categories: null,
			excludedIds: ["missing-id"],
		});
		expect(hasError(host, "FILTER_CANDIDATES_CHANGED")).toBe(true);
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("unavailable"),
		);
		await filter(server, host, "failed-filter", {
			categories: null,
			excludedIds: [],
		});
		expect(hasError(host, "SAVE_FAILED")).toBe(true);
		expect(latestSnapshot(host).snapshot.gameFilter).toEqual(after.gameFilter);
		expect(storedSnapshot(context).gameFilter).toEqual(after.gameFilter);
		const resumed = createServer(context);
		await resumed.onStart();
		expect(latestSnapshot(host).snapshot.gameFilter).toEqual(after.gameFilter);
		const joined = await connect(resumed, context, "새참가자");
		expect(latestSnapshot(joined).snapshot.gameFilter).toEqual(
			after.gameFilter,
		);
		expect(latestSnapshot(joined).snapshot.candidates).toEqual(
			after.candidates,
		);
	});

	it("allows zero-result filters with direct reset recovery and preserves the draw's filter copy", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await enterPreparation(server, host);
		await filter(server, host, "zero-filter", {
			categories: [],
			excludedIds: [],
		});
		await send(server, host, {
			type: "intake",
			action: "finalize",
			id: "empty-filter-finalize",
			expectedRevision: currentRevision(host),
		});
		expect(hasError(host, "NO_CANDIDATES")).toBe(true);
		expect(entropy).not.toHaveBeenCalled();
		await filter(server, host, "restore-filter", {
			categories: null,
			excludedIds: [candidates[0].id],
		});
		await send(server, host, {
			type: "intake",
			action: "finalize",
			id: "filtered-finalize",
			expectedRevision: currentRevision(host),
		});
		entropy.mockResolvedValue({ numbers: [0], source: "quantum" });
		await send(server, host, {
			type: "start",
			id: "filtered-draw",
			expectedRevision: currentRevision(host),
		});
		await filter(server, host, "fetching-filter", {
			categories: null,
			excludedIds: [],
		});
		expect(hasError(host, "DRAW_BUSY")).toBe(true);
		await context.drain();
		const draw = structuredClone(latestSnapshot(host).snapshot.draw);
		expect(draw?.candidates.map((item) => item.id)).toEqual([
			candidates[1].id,
			candidates[2].id,
		]);
		expect(draw?.gameFilter).toEqual({
			categories: null,
			excludedIds: [candidates[0].id],
		});
		await filter(server, host, "drawing-filter", {
			categories: null,
			excludedIds: [],
		});
		expect(hasError(host, "DRAW_BUSY")).toBe(true);
		vi.setSystemTime((draw?.startedAt ?? 0) + lunchRoomLimits.drawDurationMs);
		await server.onAlarm();
		const resultFilter = structuredClone(
			latestSnapshot(host).snapshot.gameFilter,
		);
		await filter(server, host, "result-filter-denied", {
			categories: null,
			excludedIds: [],
		});
		expect(hasError(host, "PHASE_CONFLICT")).toBe(true);
		expect(latestSnapshot(host).snapshot.draw).toEqual(draw);
		expect(latestSnapshot(host).snapshot.gameFilter).toEqual(resultFilter);
		await returnToWaiting(server, host);
		await filter(server, host, "next-waiting-filter-denied", {
			categories: null,
			excludedIds: [],
		});
		expect(latestSnapshot(host).snapshot.gameFilter).toEqual(resultFilter);
		await enterPreparation(server, host);
		await filter(server, host, "next-game-filter", {
			categories: null,
			excludedIds: [],
		});
		expect(
			latestSnapshot(host).snapshot.history.find(
				(item) => item.id === draw?.id,
			),
		).toEqual(draw);
		expect(latestSnapshot(host).snapshot.gameFilter).toEqual({
			categories: null,
			excludedIds: [],
		});
	});

	it("migrates legacy exclusions only through explicit filter writes and prunes deleted IDs", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await editPreparedRoom(server, host, {
			id: "legacy-edit",
			candidates: candidates.map((item, index) => ({
				...item,
				included: index !== 0,
			})),
		});
		expect(
			getEligibleRoomCandidates(latestSnapshot(host).snapshot),
		).toHaveLength(2);
		await enterPreparation(server, host);
		await filter(server, host, "keep-legacy-filter", {
			categories: null,
			excludedIds: [candidates[0].id, candidates[1].id],
		});
		expect(
			getEligibleRoomCandidates(latestSnapshot(host).snapshot).map(
				(item) => item.id,
			),
		).toEqual([candidates[2].id]);
		await filter(server, host, "reset-legacy-filter", {
			categories: null,
			excludedIds: [],
		});
		expect(
			getEligibleRoomCandidates(latestSnapshot(host).snapshot),
		).toHaveLength(3);
		await filter(server, host, "exclude-delete", {
			categories: null,
			excludedIds: [candidates[1].id],
		});
		await editPreparedRoom(server, host, {
			id: "delete-filtered",
			candidates: [latestSnapshot(host).snapshot.candidates[0]],
		});
		expect(storedSnapshot(context).gameFilter?.excludedIds).toEqual([]);
		expect(
			getEligibleRoomCandidates(latestSnapshot(host).snapshot),
		).toHaveLength(1);
	});

	it("allows only the host to change filters in editing, collecting and reviewing", async () => {
		const { server, context } = await room(false);
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		for (const phase of ["editing", "collecting", "reviewing"]) {
			if (phase !== "editing")
				await send(server, host, {
					type: "intake",
					id: `filter-stage-${phase}`,
					action: phase === "collecting" ? "open" : "close",
					expectedRevision: currentRevision(host),
				});
			const before = structuredClone(latestSnapshot(host).snapshot);
			await filter(server, host, `host-filter-${phase}`, {
				categories: null,
				excludedIds: [candidates[0].id],
			});
			expect(latestSnapshot(host).snapshot.status).toBe(phase);
			expect(latestSnapshot(host).snapshot.listVersion).toBe(
				before.listVersion,
			);
			expect(latestSnapshot(host).snapshot.candidates).toEqual(
				before.candidates,
			);
			await send(server, guest, {
				type: "game-filter",
				id: `guest-filter-${phase}`,
				expectedRevision: currentRevision(guest),
				filter: { categories: null, excludedIds: [] },
			});
			expect(hasError(guest, "HOST_REQUIRED")).toBe(true);
			expect(latestSnapshot(host).snapshot.gameFilter?.excludedIds).toEqual([
				candidates[0].id,
			]);
		}
	});
});

describe("LunchRoomServer game lifecycle", () => {
	const revision = (socket: TestSocket) => {
		const snapshot = latestSnapshot(socket).snapshot;
		return snapshot.revision ?? snapshot.listVersion;
	};
	const requestErrors = (socket: TestSocket, requestId: string) =>
		messages(socket).filter(
			(message) => message.type === "error" && message.requestId === requestId,
		);
	const acknowledgements = (socket: TestSocket, requestId: string) =>
		messages(socket).filter(
			(message) => message.type === "ack" && message.requestId === requestId,
		);
	async function transition(
		server: LunchRoomServer,
		host: TestSocket,
		action: "edit" | "open" | "close" | "finalize",
		id: string,
	) {
		await send(server, host, {
			type: "intake",
			id,
			action,
			expectedRevision: revision(host),
		});
	}
	async function replaceList(
		server: LunchRoomServer,
		host: TestSocket,
		count: number,
		id = "replace-list",
	) {
		await editPreparedRoom(server, host, {
			id,
			candidates: Array.from({ length: count }, (_, index) => ({
				id: `choice-${index + 1}`,
				name: `${index + 1}번`,
				category: "확인 불가",
				included: true,
			})),
		});
		expect(requestErrors(host, id)).toEqual([]);
	}
	async function setExclusion(
		server: LunchRoomServer,
		host: TestSocket,
		value: boolean,
		id: string,
	) {
		await send(server, host, {
			type: "options",
			id,
			expectedRevision: revision(host),
			excludeDrawn: value,
		});
		expect(requestErrors(host, id)).toEqual([]);
	}
	async function drawResult(
		server: LunchRoomServer,
		context: HarnessContext,
		host: TestSocket,
		id: string,
		confirmReset = false,
	) {
		await send(server, host, {
			type: "start",
			id,
			expectedRevision: revision(host),
			confirmReset,
		});
		await context.drain();
		expect(latestSnapshot(host).snapshot.status).toBe("drawing");
		vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
		await server.onAlarm();
		expect(latestSnapshot(host).snapshot.status).toBe("result");
		const draw = latestSnapshot(host).snapshot.draw;
		if (!draw) throw new Error("Expected draw result");
		return structuredClone(draw);
	}

	it("runs two consecutive OFF games without reset approval and keeps host, guest and durable exclusions empty", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		const initial = structuredClone(latestSnapshot(host).snapshot.candidates);
		for (let round = 1; round <= 2; round++) {
			const current = await drawResult(
				server,
				context,
				host,
				`consecutive-off-${round}`,
			);
			expect(current.excludeDrawn).toBe(false);
			expect(current.candidates).toEqual(initial);
			expect(current.roundNumber).toBe(round);
			for (const state of [
				latestSnapshot(host).snapshot,
				latestSnapshot(guest).snapshot,
				storedSnapshot(context),
			]) {
				expect(state.excludedIds).toEqual([]);
				expect(state.exclusionRecords).toEqual([]);
			}
			await returnToWaiting(server, host);
			expect(latestSnapshot(host).snapshot).toMatchObject({
				status: "waiting",
				draw: null,
				excludedIds: [],
				exclusionRecords: [],
				drawCount: round,
			});
			expect(latestSnapshot(host).snapshot.history[0]).toEqual(current);
		}
		expect(entropy).toHaveBeenCalledTimes(2);
	});
	it("rolls back a failed OFF switch save, preserves two current exclusions through toggles and restart, and clears only on OFF next", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await setExclusion(server, host, true, "on-for-off-save");
		const first = await drawResult(
			server,
			context,
			host,
			"first-on-before-off-save",
		);
		await returnToWaiting(server, host);
		const original = await drawResult(
			server,
			context,
			host,
			"off-save-original",
		);
		const before = structuredClone(storedSnapshot(context));
		const command = {
			type: "options",
			id: "retry-disable",
			excludeDrawn: false,
			expectedRevision: revision(host),
		};
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("save failed"),
		);
		await send(server, host, command);
		expect(requestErrors(host, "retry-disable")).toMatchObject([
			{ code: "SAVE_FAILED" },
		]);
		expect(storedSnapshot(context)).toEqual(before);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(
			before.excludedIds,
		);
		await send(server, host, command);
		expect(acknowledgements(host, "retry-disable")).toHaveLength(1);
		expect(storedSnapshot(context)).toMatchObject({
			excludeDrawn: false,
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			draw: original,
		});
		expect(before.excludedIds).toHaveLength(2);
		await setExclusion(server, host, true, "on-again-before-next");
		expect(storedSnapshot(context).excludedIds).toEqual(before.excludedIds);
		await setExclusion(server, host, false, "off-again-before-next");
		expect(storedSnapshot(context).excludedIds).toEqual(before.excludedIds);
		const restored = createServer(context);
		await restored.onStart();
		expect(storedSnapshot(context)).toMatchObject({
			excludeDrawn: false,
			draw: original,
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
		});
		await returnToWaiting(restored, host);
		expect(storedSnapshot(context)).toMatchObject({
			excludedIds: [],
			exclusionRecords: [],
			history: [original, first],
		});
	});
	it("migrates a legacy OFF winner ledger to empty storage while retaining its result and round counter", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const original = await drawResult(
			server,
			context,
			host,
			"legacy-off-winner",
		);
		await returnToWaiting(server, host);
		const saved = structuredClone(
			context.storage.values.get("lunch-room:v1"),
		) as { snapshot: RoomSnapshot };
		saved.snapshot.excludedIds = [original.candidates[original.winnerIndex].id];
		saved.snapshot.exclusionRecords = [
			{
				candidateId: saved.snapshot.excludedIds[0],
				drawId: original.id,
				drawnAt: original.startedAt + original.durationMs,
				roundNumber: original.roundNumber,
			},
		];
		context.storage.values.set("lunch-room:v1", saved);
		const restored = createServer(context);
		await restored.onStart();
		expect(storedSnapshot(context)).toMatchObject({
			excludeDrawn: false,
			excludedIds: [],
			exclusionRecords: [],
			drawCount: 1,
			history: [original],
		});
	});

	it("adds the current result on enabling after reset, rejects guests and rolls back failed option saves", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		const completed = await drawResult(
			server,
			context,
			host,
			"late-enable-result",
		);
		await send(server, host, {
			type: "reset-exclusions",
			id: "late-enable-reset",
			expectedRevision: revision(host),
		});
		expect(storedSnapshot(context).excludedIds).toEqual([]);
		await send(server, guest, {
			type: "options",
			id: "late-enable-guest",
			expectedRevision: revision(host),
			excludeDrawn: true,
		});
		expect(requestErrors(guest, "late-enable-guest")).toMatchObject([
			{ code: "HOST_REQUIRED" },
		]);
		const command = {
			type: "options",
			id: "late-enable-host",
			expectedRevision: revision(host),
			excludeDrawn: true,
		};
		const put = vi
			.spyOn(context.storage, "put")
			.mockRejectedValueOnce(new Error("storage unavailable"));
		await send(server, host, command);
		expect(requestErrors(host, command.id)).toMatchObject([
			{ code: "SAVE_FAILED" },
		]);
		expect(storedSnapshot(context)).toMatchObject({
			excludeDrawn: false,
			excludedIds: [],
			exclusionRecords: [],
			draw: completed,
			drawCount: 1,
		});
		put.mockRestore();
		await send(server, host, command);
		const acceptedRevision = revision(host);
		await send(server, host, command);
		expect(revision(host)).toBe(acceptedRevision);
		const winnerId = completed.candidates[completed.winnerIndex].id;
		for (const socket of [host, guest]) {
			const current = latestSnapshot(socket).snapshot;
			expect(current.excludedIds).toEqual([winnerId]);
			expect(current.exclusionRecords).toHaveLength(1);
			expect(current.draw).toEqual(completed);
			expect(
				getEligibleRoomCandidates(current).some(
					(candidate) => candidate.id === winnerId,
				),
			).toBe(false);
		}
		await returnToWaiting(server, host);
		expect(latestSnapshot(guest).snapshot.history).toEqual([completed]);
		expect(latestSnapshot(guest).snapshot.excludedIds).toEqual([winnerId]);
	});

	it("creates a room in editing and reaches the first roulette only after the host finalizes", async () => {
		const { server, context } = await room(false);
		expect(storedSnapshot(context)).toMatchObject({
			status: "editing",
			intakeId: null,
			draw: null,
			history: [],
		});
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "새 참가자");
		const initial = structuredClone(latestSnapshot(host).snapshot);
		expect(latestSnapshot(guest).snapshot.status).toBe("editing");
		await send(server, host, {
			type: "start",
			id: "initial-edit-start",
			expectedRevision: revision(host),
		});
		expect(requestErrors(host, "initial-edit-start")).toMatchObject([
			{ code: "DRAW_BUSY" },
		]);
		await send(server, guest, {
			type: "recommend",
			id: "initial-edit-recommend",
			name: "접수 전 후보",
			intakeId: "not-opened",
		});
		expect(requestErrors(guest, "initial-edit-recommend")).toMatchObject([
			{ code: "INTAKE_CLOSED" },
		]);
		await send(server, guest, {
			type: "room-edit",
			id: "initial-edit-guest",
			baseListVersion: initial.listVersion,
			title: "참가자 수정",
		});
		expect(requestErrors(guest, "initial-edit-guest")).toMatchObject([
			{ code: "HOST_REQUIRED" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(initial);
		await send(server, host, {
			type: "room-edit",
			id: "initial-edit-title",
			baseListVersion: initial.listVersion,
			title: "첫 게임 준비",
		});
		expect(acknowledgements(host, "initial-edit-title")).toHaveLength(1);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "editing",
			title: "첫 게임 준비",
			draw: null,
		});
		await transition(server, host, "finalize", "first-finalize");
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			intakeId: null,
			draw: null,
			history: [],
		});
		expect(latestSnapshot(guest).snapshot.status).toBe("waiting");
		expect(entropy).not.toHaveBeenCalled();
	});

	it("requires editing for host candidate changes while preserving game-between option and reset shortcuts", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		const waiting = structuredClone(latestSnapshot(host).snapshot);
		await send(server, host, {
			type: "room-edit",
			id: "waiting-direct-edit",
			baseListVersion: waiting.listVersion,
			title: "대기 중 수정",
			candidates: candidates.slice(0, 2),
		});
		expect(requestErrors(host, "waiting-direct-edit")).toMatchObject([
			{ code: "PHASE_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(waiting);
		expect(storedSnapshot(context)).toMatchObject({
			...waiting,
			participants: [],
		});
		await setExclusion(server, host, true, "waiting-quick-option");
		const draw = await drawResult(
			server,
			context,
			host,
			"editing-boundary-result",
		);
		const result = structuredClone(latestSnapshot(host).snapshot);
		await send(server, host, {
			type: "room-edit",
			id: "result-direct-edit",
			baseListVersion: result.listVersion,
			candidates: candidates.slice(0, 2),
		});
		await transition(server, host, "edit", "result-edit-entry");
		expect(requestErrors(host, "result-direct-edit")).toMatchObject([
			{ code: "PHASE_CONFLICT" },
		]);
		expect(requestErrors(host, "result-edit-entry")).toMatchObject([
			{ code: "PHASE_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(result);
		await setExclusion(server, host, false, "result-quick-option");
		await send(server, host, {
			type: "reset-exclusions",
			id: "result-quick-reset",
			expectedRevision: revision(host),
		});
		expect(acknowledgements(host, "result-quick-reset")).toHaveLength(1);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "result",
			draw,
			excludedIds: [],
			history: [],
		});
		await returnToWaiting(server, host);
		const beforeEntry = structuredClone(latestSnapshot(host).snapshot);
		await send(server, guest, {
			type: "intake",
			id: "guest-edit-entry",
			action: "edit",
			expectedRevision: revision(guest),
		});
		expect(requestErrors(guest, "guest-edit-entry")).toMatchObject([
			{ code: "HOST_REQUIRED" },
		]);
		await transition(server, host, "edit", "host-edit-entry");
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "editing",
			intakeId: null,
			draw: null,
			history: [draw],
		});
		expect(latestSnapshot(host).snapshot.candidates).toEqual(
			beforeEntry.candidates,
		);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(
			beforeEntry.excludedIds,
		);
		await transition(server, host, "open", "editing-open-intake");
		expect(latestSnapshot(host).snapshot.status).toBe("collecting");
		expect(latestSnapshot(host).snapshot.intakeId).toEqual(expect.any(String));
		expect(latestSnapshot(guest).snapshot.status).toBe("collecting");
	});

	it("changes room-title settings independently in waiting and result without modifying candidates, ledger, versions or history", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "참가자");
		await setExclusion(server, host, true, "settings-no-repeat");
		for (const status of ["waiting", "result"] as const) {
			if (status === "result")
				await drawResult(server, context, host, "settings-result");
			const before = withoutPresence(latestSnapshot(host).snapshot);
			const message = {
				type: "room-edit",
				id: `settings-title-${status}`,
				baseListVersion: 999,
				title: `별도 설정 ${status}`,
			};
			await send(server, host, message);
			expect(acknowledgements(host, message.id)).toHaveLength(1);
			expect(withoutPresence(latestSnapshot(host).snapshot)).toEqual({
				...before,
				title: message.title,
			});
			expect(storedSnapshot(context)).toMatchObject({
				...before,
				title: message.title,
				participants: [],
			});
			await send(server, guest, {
				...message,
				id: `guest-settings-${status}`,
				title: "권한 없는 변경",
			});
			expect(requestErrors(guest, `guest-settings-${status}`)).toMatchObject([
				{ code: "HOST_REQUIRED" },
			]);
			expect(latestSnapshot(host).snapshot.title).toBe(message.title);
			await send(server, host, {
				...message,
				id: `candidate-settings-${status}`,
				candidates: [],
				title: "후보 포함 우회",
			});
			expect(requestErrors(host, `candidate-settings-${status}`)).toMatchObject(
				[{ code: "PHASE_CONFLICT" }],
			);
			expect(withoutPresence(latestSnapshot(host).snapshot)).toEqual({
				...before,
				title: message.title,
			});
		}
	});
	it("blocks independent title settings during entropy fetching and roulette drawing", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		let complete: (value: { numbers: number[]; source: "quantum" }) => void =
			() => {};
		entropy.mockReturnValueOnce(
			new Promise((resolve) => {
				complete = resolve;
			}),
		);
		await send(server, host, { type: "start", id: "title-settings-draw" });
		expect(latestSnapshot(host).snapshot.status).toBe("fetching");
		for (const status of ["fetching", "drawing"] as const) {
			if (status === "drawing") {
				complete({ numbers: [1], source: "quantum" });
				await context.drain();
			}
			const before = withoutPresence(latestSnapshot(host).snapshot);
			await send(server, host, {
				type: "room-edit",
				id: `busy-title-${status}`,
				baseListVersion: before.listVersion,
				title: "진행 중 변경",
			});
			expect(requestErrors(host, `busy-title-${status}`)).toMatchObject([
				{ code: "DRAW_BUSY" },
			]);
			expect(withoutPresence(latestSnapshot(host).snapshot)).toEqual(before);
		}
	});
	it("acknowledges a retried editing command after finalization without reopening or applying it twice", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await transition(server, host, "edit", "retry-edit-entry");
		const original = latestSnapshot(host).snapshot;
		const command = {
			type: "room-edit",
			id: "retry-edit-command",
			baseListVersion: original.listVersion,
			candidates: original.candidates.map((candidate, index) => ({
				...candidate,
				name: index === 0 ? "첫 후보 수정" : candidate.name,
			})),
		};
		await send(server, host, command);
		expect(acknowledgements(host, command.id)).toHaveLength(1);
		await transition(server, host, "finalize", "retry-edit-finalize");
		const finalized = structuredClone(latestSnapshot(host).snapshot);
		await send(server, host, command);
		expect(acknowledgements(host, command.id)).toHaveLength(2);
		expect(requestErrors(host, command.id)).toEqual([]);
		expect(latestSnapshot(host).snapshot).toEqual(finalized);
		expect(storedSnapshot(context)).toMatchObject({
			...finalized,
			participants: [],
		});
		await send(server, host, { ...command, title: "동일 ID 다른 내용" });
		expect(requestErrors(host, command.id)).toMatchObject([
			{ code: "REQUEST_ID_REUSED" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(finalized);
		expect(entropy).not.toHaveBeenCalled();
	});

	it("rejects stale or duplicate editing entry and restores editing after a server restart", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const oldRevision = revision(host);
		await setExclusion(server, host, true, "edit-entry-new-condition");
		await send(server, host, {
			type: "intake",
			id: "stale-edit-entry",
			action: "edit",
			expectedRevision: oldRevision,
		});
		expect(requestErrors(host, "stale-edit-entry")).toMatchObject([
			{ code: "REVISION_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		await transition(server, host, "edit", "editing-restore-entry");
		const editing = structuredClone(latestSnapshot(host).snapshot);
		await transition(server, host, "edit", "editing-duplicate-entry");
		expect(requestErrors(host, "editing-duplicate-entry")).toMatchObject([
			{ code: "PHASE_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(editing);
		await createServer(context).onStart();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "editing",
			intakeId: null,
			draw: null,
		});
		expect(storedSnapshot(context).status).toBe("editing");
		expect(entropy).not.toHaveBeenCalled();
	});

	it("keeps simultaneous same-name recommendations separate and deduplicates retries per participant", async () => {
		const { server, context } = await room(false);
		const host = await connect(server, context, "방장", hostToken);
		const first = await connect(server, context, "참가자 A");
		const second = await connect(server, context, "참가자 B");
		await transition(server, host, "open", "shared-additions-open");
		const recommendation = {
			type: "recommend",
			id: "same-request-key",
			intakeId: latestSnapshot(host).snapshot.intakeId,
			name: "라면",
		};
		await Promise.all([
			send(server, first, recommendation),
			send(server, second, recommendation),
		]);
		await send(server, first, recommendation);

		const added = storedSnapshot(context).candidates.filter(
			(candidate) => candidate.name === "라면",
		);
		expect(added).toHaveLength(2);
		expect(added.map(({ ownerId }) => ownerId)).toEqual([
			latestSnapshot(first).self?.id,
			latestSnapshot(second).self?.id,
		]);
		expect(added.map(({ ownerName }) => ownerName)).toEqual([
			"참가자 A",
			"참가자 B",
		]);
		expect(added[0].id).not.toBe(added[1].id);
		expect(acknowledgements(first, recommendation.id)).toHaveLength(2);
		expect(acknowledgements(second, recommendation.id)).toHaveLength(1);

		await send(server, first, {
			type: "remove-candidate",
			id: "remove-other-ramen",
			intakeId: recommendation.intakeId,
			candidateId: added[1].id,
		});
		expect(requestErrors(first, "remove-other-ramen")).toMatchObject([
			{ code: "CANDIDATE_FORBIDDEN" },
		]);
		expect(
			storedSnapshot(context).candidates.filter(({ name }) => name === "라면"),
		).toEqual(added);
	});

	it("opens recommendations, closes on the same list, reopens with a fresh session and finalizes without drawing", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "추천손님");
		await send(server, guest, {
			type: "intake",
			id: "guest-open",
			action: "open",
			expectedRevision: revision(guest),
		});
		expect(requestErrors(guest, "guest-open")).toMatchObject([
			{ code: "HOST_REQUIRED" },
		]);
		await transition(server, host, "open", "open-intake");
		const firstIntake = latestSnapshot(guest).snapshot.intakeId;
		expect(firstIntake).toBeTruthy();
		expect(latestSnapshot(host).snapshot.status).toBe("collecting");
		const recommend = {
			type: "recommend",
			id: "guest-udon",
			intakeId: firstIntake,
			name: "우동",
			ownerId: "forged",
			ownerName: "위조",
		};
		await send(server, guest, recommend);
		const own = latestSnapshot(host).snapshot.candidates.find(
			(candidate) => candidate.name === "우동",
		);
		expect(own).toMatchObject({
			ownerId: latestSnapshot(guest).self?.id,
			ownerName: "추천손님",
			included: true,
		});
		await send(server, guest, recommend);
		expect(
			latestSnapshot(host).snapshot.candidates.filter(
				(candidate) => candidate.name === "우동",
			),
		).toHaveLength(1);
		expect(acknowledgements(guest, "guest-udon")).toHaveLength(2);
		await send(server, guest, { ...recommend, name: "다른 후보" });
		expect(requestErrors(guest, "guest-udon")).toMatchObject([
			{ code: "REQUEST_ID_REUSED" },
		]);
		await send(server, guest, {
			type: "remove-candidate",
			id: "remove-someone-else",
			candidateId: candidates[0].id,
			intakeId: firstIntake,
		});
		expect(requestErrors(guest, "remove-someone-else")).toMatchObject([
			{ code: "CANDIDATE_FORBIDDEN" },
		]);
		await send(server, host, {
			type: "start",
			id: "collecting-cannot-start",
			expectedRevision: revision(host),
		});
		expect(requestErrors(host, "collecting-cannot-start")).toHaveLength(1);
		await transition(server, host, "close", "close-intake");
		const closed = latestSnapshot(host).snapshot;
		expect(closed.status).toBe("reviewing");
		expect(closed.candidates).toHaveLength(4);
		await send(server, guest, {
			type: "remove-candidate",
			id: "closed-own-delete",
			candidateId: own?.id,
			intakeId: firstIntake,
		});
		await send(server, guest, {
			type: "recommend",
			id: "closed-new",
			name: "라면",
			intakeId: firstIntake,
		});
		expect(requestErrors(guest, "closed-own-delete")).toMatchObject([
			{ code: "INTAKE_CLOSED" },
		]);
		expect(requestErrors(guest, "closed-new")).toMatchObject([
			{ code: "INTAKE_CLOSED" },
		]);
		await transition(server, host, "open", "reopen-intake");
		const secondIntake = latestSnapshot(guest).snapshot.intakeId;
		expect(secondIntake).not.toBe(firstIntake);
		await send(server, guest, {
			type: "recommend",
			id: "late-old-session",
			name: "라면",
			intakeId: firstIntake,
		});
		expect(requestErrors(guest, "late-old-session")).toMatchObject([
			{ code: "INTAKE_CLOSED" },
		]);
		await send(server, guest, {
			type: "remove-candidate",
			id: "delete-own",
			candidateId: own?.id,
			intakeId: secondIntake,
		});
		expect(latestSnapshot(host).snapshot.candidates).toHaveLength(3);
		await transition(server, host, "finalize", "finalize-directly");
		expect(latestSnapshot(guest).snapshot).toMatchObject({
			status: "waiting",
			intakeId: null,
			draw: null,
			history: [],
		});
		expect(entropy).not.toHaveBeenCalled();
	});

	it.each([
		"recommend-first",
		"finalize-first",
	] as const)("serializes recommendation and finalization without losing a submitted candidate: %s", async (order) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "추천손님");
		await transition(server, host, "open", "race-open");
		const initial = latestSnapshot(host).snapshot;
		const recommend = () =>
			send(server, guest, {
				type: "recommend",
				id: "race-recommend",
				name: "우동",
				intakeId: initial.intakeId,
			});
		const finalize = () =>
			send(server, host, {
				type: "intake",
				id: "race-finalize",
				action: "finalize",
				expectedRevision: initial.revision,
			});
		await Promise.all(
			order === "recommend-first"
				? [recommend(), finalize()]
				: [finalize(), recommend()],
		);
		if (order === "recommend-first") {
			expect(latestSnapshot(host).snapshot.status).toBe("collecting");
			expect(
				latestSnapshot(host).snapshot.candidates.some(
					(candidate) => candidate.name === "우동",
				),
			).toBe(true);
			expect(requestErrors(host, "race-finalize")).toMatchObject([
				{ code: "REVISION_CONFLICT" },
			]);
			await transition(server, host, "finalize", "race-finalize-current");
		} else {
			expect(
				latestSnapshot(host).snapshot.candidates.some(
					(candidate) => candidate.name === "우동",
				),
			).toBe(false);
			expect(requestErrors(guest, "race-recommend")).toMatchObject([
				{ code: "INTAKE_CLOSED" },
			]);
		}
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		expect(entropy).not.toHaveBeenCalled();
	});

	it("preserves new recommendations during a title-only edit and rejects a stale replacement atomically", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "추천손님");
		await transition(server, host, "open", "draft-open");
		const baseline = structuredClone(latestSnapshot(host).snapshot);
		await send(server, guest, {
			type: "recommend",
			id: "draft-new-candidate",
			name: "우동",
			intakeId: baseline.intakeId,
		});
		await send(server, host, {
			type: "room-edit",
			id: "title-only",
			baseListVersion: baseline.listVersion,
			title: "새 방 제목",
		});
		const current = latestSnapshot(host).snapshot;
		expect(current.title).toBe("새 방 제목");
		expect(current.candidates).toHaveLength(4);
		await send(server, host, {
			type: "room-edit",
			id: "stale-list",
			baseListVersion: baseline.listVersion,
			title: "덮어쓸 제목",
			candidates: baseline.candidates,
		});
		expect(requestErrors(host, "stale-list")).toMatchObject([
			{ code: "LIST_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot.title).toBe("새 방 제목");
		expect(latestSnapshot(host).snapshot.candidates).toEqual(
			current.candidates,
		);
		await send(server, host, {
			type: "room-edit",
			id: "same-id-rename",
			baseListVersion: current.listVersion,
			candidates: current.candidates.map((candidate) => ({
				...candidate,
				name: candidate.name === "우동" ? "우동 이름 수정" : candidate.name,
				ownerId: "forged-owner",
			})),
		});
		const renamed = latestSnapshot(host).snapshot.candidates.find(
			(candidate) => candidate.name === "우동 이름 수정",
		);
		expect(renamed).toMatchObject({
			id: current.candidates[3].id,
			ownerId: latestSnapshot(guest).self?.id,
		});
	});

	it("accumulates ON winners, keeps OFF exclusions empty, and permits an OFF draw without confirmation", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "손님");
		await replaceList(server, host, 10);
		await setExclusion(server, host, true, "on-initial");
		entropy.mockResolvedValue({ numbers: [0], source: "quantum" });
		const records: NonNullable<RoomSnapshot["exclusionRecords"]> = [];
		for (let round = 1; round <= 3; round++) {
			const previous = Array.from(
				{ length: round - 1 },
				(_, index) => `choice-${index + 1}`,
			);
			const record = {
				candidateId: `choice-${round}`,
				drawId: `on-${round}`,
				drawnAt: Date.now() + 1500 + lunchRoomLimits.drawDurationMs,
				roundNumber: round,
			};
			await send(server, host, {
				type: "start",
				id: `on-${round}`,
				expectedRevision: revision(host),
			});
			await context.drain();
			expect(latestSnapshot(host).snapshot.excludedIds).toEqual(previous);
			expect(latestSnapshot(guest).snapshot.excludedIds).toEqual(previous);
			expect(latestSnapshot(host).snapshot.exclusionRecords).toEqual(records);
			expect(latestSnapshot(guest).snapshot.exclusionRecords).toEqual(records);
			expect(latestSnapshot(host).snapshot.drawCount).toBe(round);
			expect(storedSnapshot(context)).toMatchObject({
				drawCount: round,
				drawCountIsExact: true,
				draw: { id: `on-${round}`, roundNumber: round },
				exclusionRecords: [...records, record],
			});
			expect(storedSnapshot(context).excludedIds).toEqual([
				...previous,
				`choice-${round}`,
			]);
			vi.advanceTimersByTime(1500 + lunchRoomLimits.drawDurationMs);
			await server.onAlarm();
			records.push(record);
			expect(latestSnapshot(host).snapshot.exclusionRecords).toEqual(records);
			expect(latestSnapshot(guest).snapshot.exclusionRecords).toEqual(records);
			expect(latestSnapshot(host).snapshot.excludedIds).toEqual([
				...previous,
				`choice-${round}`,
			]);
			await returnToWaiting(server, host);
		}
		await setExclusion(server, host, false, "off-between-games");
		expect(latestSnapshot(host).snapshot).toMatchObject({
			exclusionRecords: records,
			excludedIds: records.map((record) => record.candidateId),
			drawCount: 3,
		});
		entropy.mockResolvedValueOnce({ numbers: [3], source: "quantum" });
		const draw = await drawResult(server, context, host, "off-four");
		const offRecord = {
			candidateId: "choice-4",
			drawId: draw.id,
			drawnAt: draw.startedAt + draw.durationMs,
			roundNumber: 4,
		};
		expect(requestErrors(host, "off-four")).toEqual([]);
		expect(draw).toMatchObject({
			excludeDrawn: false,
			excludedIdsBefore: [],
			roundNumber: 4,
		});
		expect(storedSnapshot(context)).toMatchObject({
			excludedIds: [],
			exclusionRecords: [],
			drawCount: 4,
		});
		expect(latestSnapshot(guest).snapshot).toMatchObject({
			excludedIds: [],
			exclusionRecords: [],
			drawCount: 4,
		});
		await setExclusion(server, host, true, "on-after-four");
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "result",
			draw,
			excludedIds: ["choice-4"],
			exclusionRecords: [offRecord],
			drawCount: 4,
		});
		await returnToWaiting(server, host);
		await send(server, host, {
			type: "next",
			id: "next-off-four",
			drawId: "off-four",
		});
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(["choice-4"]);
		expect(latestSnapshot(host).snapshot.exclusionRecords).toEqual([offRecord]);
		expect(storedSnapshot(context).drawCount).toBe(4);
		expect(
			latestSnapshot(host).snapshot.history.filter(
				(entry) => entry.id === "off-four",
			),
		).toHaveLength(1);
	});

	it("keeps manual exclusions and an existing result while resetting the automatic ledger, and does not reinsert on next", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await editPreparedRoom(server, host, {
			id: "manual-setup",
			candidates: candidates.map((candidate, index) => ({
				...candidate,
				included: index !== 0,
			})),
		});
		await setExclusion(server, host, true, "active-ledger-setup");
		entropy.mockResolvedValueOnce({ numbers: [0], source: "quantum" });
		const draw = await drawResult(server, context, host, "reset-result");
		expect(latestSnapshot(host).snapshot.exclusionRecords).toEqual([
			{
				candidateId: draw.candidates[draw.winnerIndex].id,
				drawId: draw.id,
				drawnAt: draw.startedAt + draw.durationMs,
				roundNumber: 1,
			},
		]);
		await setExclusion(server, host, true, "reset-result-on");
		const resetCommand = {
			type: "reset-exclusions",
			id: "manual-reset",
			expectedRevision: revision(host),
		};
		await send(server, host, resetCommand);
		const reset = latestSnapshot(host).snapshot;
		expect(reset).toMatchObject({
			status: "result",
			draw,
			excludedIds: [],
			exclusionRecords: [],
			drawCount: 1,
			history: [],
		});
		expect(
			reset.candidates.find((candidate) => candidate.id === candidates[0].id)
				?.included,
		).toBe(false);
		await send(server, host, resetCommand);
		expect(acknowledgements(host, "manual-reset")).toHaveLength(2);
		expect(revision(host)).toBe(reset.revision);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual([]);
		expect(storedSnapshot(context)).toMatchObject({
			exclusionRecords: [],
			drawCount: 1,
		});
		await returnToWaiting(server, host);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: [],
			exclusionRecords: [],
			drawCount: 1,
			history: [draw],
		});
		const next = await drawResult(server, context, host, "draw-after-reset");
		expect(next.roundNumber).toBe(2);
		expect(storedSnapshot(context)).toMatchObject({
			drawCount: 2,
			exclusionRecords: [
				{
					candidateId: next.candidates[next.winnerIndex].id,
					drawId: next.id,
					drawnAt: next.startedAt + next.durationMs,
					roundNumber: 2,
				},
			],
		});
	});

	it("rejects stale OFF starts and preserves empty exclusions when entropy fails", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await drawResult(server, context, host, "before-failure");
		await returnToWaiting(server, host);
		const before = structuredClone(latestSnapshot(host).snapshot);
		expect(before.drawCount).toBe(1);
		expect(before.exclusionRecords).toEqual([]);
		await setExclusion(server, host, true, "conditions-change-on");
		await setExclusion(server, host, false, "conditions-change-off");
		await send(server, host, {
			type: "start",
			id: "stale-confirmation",
			expectedRevision: before.revision,
			confirmReset: true,
		});
		expect(requestErrors(host, "stale-confirmation")).toMatchObject([
			{ code: "REVISION_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
		});
		let rejectEntropy: (reason: unknown) => void = () => {};
		entropy.mockReturnValueOnce(
			new Promise((_, reject) => {
				rejectEntropy = reject;
			}),
		);
		await send(server, host, {
			type: "start",
			id: "off-entropy-failure",
			expectedRevision: revision(host),
			confirmReset: true,
		});
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "fetching",
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
			history: before.history,
		});
		await send(server, host, {
			type: "reset-exclusions",
			id: "reset-while-fetching",
			expectedRevision: revision(host),
		});
		expect(requestErrors(host, "reset-while-fetching")).toMatchObject([
			{ code: "DRAW_BUSY" },
		]);
		rejectEntropy(new Error("entropy unavailable"));
		await context.drain();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
			history: before.history,
		});
		expect(storedSnapshot(context)).toMatchObject({
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
		});
		await createServer(context).onStart();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
		});
	});

	it("rolls back a failed result save before exposing a new winner or replacing the exclusion ledger", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await setExclusion(server, host, true, "save-failure-on");
		await drawResult(server, context, host, "before-save-failure");
		await returnToWaiting(server, host);
		const before = structuredClone(latestSnapshot(host).snapshot);
		expect(before.drawCount).toBe(1);
		expect(before.exclusionRecords).toHaveLength(1);
		const put = context.storage.put.bind(context.storage);
		let failed = false;
		vi.spyOn(context.storage, "put").mockImplementation(async (key, value) => {
			const saved = value as { snapshot?: RoomSnapshot };
			if (!failed && saved.snapshot?.status === "drawing") {
				failed = true;
				throw new Error("result storage unavailable");
			}
			return put(key, value);
		});
		await send(server, host, {
			type: "start",
			id: "off-save-failure",
			expectedRevision: revision(host),
			confirmReset: true,
		});
		await context.drain();
		expect(failed).toBe(true);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
			history: before.history,
		});
		expect(storedSnapshot(context)).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
		});
		expect(
			messages(host).some(
				(message) =>
					message.type === "snapshot" &&
					message.snapshot.draw?.id === "off-save-failure",
			),
		).toBe(false);
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
		});
		const retry = await drawResult(
			restored,
			context,
			host,
			"successful-after-save-failure",
			true,
		);
		expect(retry.roundNumber).toBe(2);
		expect(storedSnapshot(context)).toMatchObject({
			drawCount: 2,
			exclusionRecords: [
				...(before.exclusionRecords ?? []),
				{
					candidateId: retry.candidates[retry.winnerIndex].id,
					drawId: retry.id,
					drawnAt: retry.startedAt + retry.durationMs,
					roundNumber: 2,
				},
			],
		});
	});

	it("allows empty-list recovery and records one remaining candidate with probability one", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await replaceList(server, host, 0, "empty-list");
		await send(server, host, {
			type: "start",
			id: "empty-start",
			expectedRevision: revision(host),
		});
		expect(latestSnapshot(host).snapshot.status).toBe("editing");
		expect(requestErrors(host, "empty-start")).toMatchObject([
			{ code: "DRAW_BUSY" },
		]);
		await transition(server, host, "finalize", "empty-edit-finish");
		expect(requestErrors(host, "empty-edit-finish")).toMatchObject([
			{ code: "NO_CANDIDATES" },
		]);
		await transition(server, host, "open", "empty-open");
		await transition(server, host, "close", "empty-close");
		await transition(server, host, "finalize", "empty-finalize");
		expect(requestErrors(host, "empty-finalize")).toMatchObject([
			{ code: "NO_CANDIDATES" },
		]);
		expect(latestSnapshot(host).snapshot.status).toBe("reviewing");
		await replaceList(server, host, 1, "single-list");
		await transition(server, host, "finalize", "single-finalize");
		entropy.mockResolvedValueOnce({ numbers: [0], source: "csprng" });
		const draw = await drawResult(server, context, host, "single-draw");
		expect(draw).toMatchObject({
			winnerIndex: 0,
			probabilities: [1],
			source: "csprng",
			toRotation: expect.any(Number),
			landingFraction: expect.any(Number),
		});
		expect(entropy).toHaveBeenCalledExactlyOnceWith(0, 0, 1);
	});

	it.each([
		"editing",
		"collecting",
		"reviewing",
	] as const)("finalizes a selected pool whose winners are exhausted from %s while keeping draws blocked", async (phase) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await replaceList(server, host, 1, "exhausted-list");
		await setExclusion(server, host, true, "exhausted-exclusion-on");
		entropy.mockResolvedValueOnce({ numbers: [0], source: "csprng" });
		await drawResult(server, context, host, "exhausted-draw");
		await returnToWaiting(server, host);
		const before = structuredClone(latestSnapshot(host).snapshot);
		expect(getEligibleRoomCandidates(before)).toHaveLength(0);
		if (phase === "editing")
			await transition(server, host, "edit", "exhausted-edit");
		else {
			await transition(server, host, "open", "exhausted-open");
			if (phase === "reviewing")
				await transition(server, host, "close", "exhausted-close");
		}
		expect(latestSnapshot(host).snapshot.status).toBe(phase);
		await transition(server, host, "finalize", "exhausted-finalize");
		expect(requestErrors(host, "exhausted-finalize")).toEqual([]);
		expect(acknowledgements(host, "exhausted-finalize")).toHaveLength(1);
		expect(latestSnapshot(host).snapshot.status).toBe("waiting");
		expect(
			getEligibleRoomCandidates(latestSnapshot(host).snapshot),
		).toHaveLength(0);
		expect(storedSnapshot(context)).toMatchObject({
			candidates: before.candidates,
			listVersion: before.listVersion,
			excludeDrawn: true,
			excludedIds: before.excludedIds,
			history: before.history,
		});
		await send(server, host, {
			type: "start",
			id: "exhausted-start",
			expectedRevision: revision(host),
		});
		expect(requestErrors(host, "exhausted-start")).toMatchObject([
			{ code: "NO_CANDIDATES" },
		]);
		expect(entropy).toHaveBeenCalledTimes(1);
		expect(storedSnapshot(context).excludedIds).toEqual(before.excludedIds);
		await setExclusion(server, host, false, "exhausted-recover");
		expect(
			getEligibleRoomCandidates(latestSnapshot(host).snapshot),
		).toHaveLength(1);
		expect(storedSnapshot(context).excludedIds).toEqual(before.excludedIds);
	});

	it.each([
		"filter",
		"legacy",
	] as const)("rejects finalizing an entirely manually excluded pool: %s", async (kind) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await transition(server, host, "edit", "manual-empty-edit");
		if (kind === "filter") {
			await send(server, host, {
				type: "game-filter",
				id: "manual-empty-filter",
				expectedRevision: revision(host),
				filter: {
					categories: null,
					excludedIds: candidates.map((candidate) => candidate.id),
				},
			});
		} else {
			await send(server, host, {
				type: "room-edit",
				id: "manual-empty-legacy",
				baseListVersion: latestSnapshot(host).snapshot.listVersion,
				candidates: candidates.map((candidate) => ({
					...candidate,
					included: false,
				})),
			});
		}
		await transition(server, host, "finalize", "manual-empty-finalize");
		expect(requestErrors(host, "manual-empty-finalize")).toMatchObject([
			{ code: "NO_CANDIDATES" },
		]);
		expect(acknowledgements(host, "manual-empty-finalize")).toHaveLength(0);
		expect(storedSnapshot(context).status).toBe("editing");
		expect(entropy).not.toHaveBeenCalled();
	});

	it("keeps the automatic ledger independent of twenty retained history entries and preserves it on wake", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await replaceList(server, host, 25, "history-list");
		await setExclusion(server, host, true, "history-exclusion-on");
		entropy.mockResolvedValue({ numbers: [0], source: "quantum" });
		for (let round = 1; round <= 22; round++) {
			await drawResult(server, context, host, `history-round-${round}`);
			await returnToWaiting(server, host);
		}
		const expected = Array.from(
			{ length: 22 },
			(_, index) => `choice-${index + 1}`,
		);
		expect(latestSnapshot(host).snapshot.history).toHaveLength(20);
		expect(latestSnapshot(host).snapshot.history.at(-1)?.id).toBe(
			"history-round-3",
		);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(expected);
		expect(latestSnapshot(host).snapshot.drawCount).toBe(22);
		expect(latestSnapshot(host).snapshot.exclusionRecords).toHaveLength(22);
		expect(latestSnapshot(host).snapshot.exclusionRecords?.[0]).toMatchObject({
			candidateId: "choice-1",
			drawId: "history-round-1",
			roundNumber: 1,
		});
		const recordsBeforeWake = latestSnapshot(host).snapshot.exclusionRecords;
		await createServer(context).onStart();
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(expected);
		expect(latestSnapshot(host).snapshot.drawCount).toBe(22);
		expect(latestSnapshot(host).snapshot.exclusionRecords).toEqual(
			recordsBeforeWake,
		);
	});

	it.each([
		"exclusion-record",
		"history",
		"current-result",
	] as const)("acknowledges an evicted start ID retained by %s without drawing again", async (retainedBy) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await setExclusion(server, host, true, "active-ledger-setup");
		const id = "evicted-successful-start";
		await drawResult(server, context, host, id);
		if (retainedBy !== "current-result") await returnToWaiting(server, host);
		const saved = structuredClone(
			context.storage.values.get("lunch-room:v1"),
		) as { snapshot: RoomSnapshot; processedStarts: string[] };
		// Results and exclusion records can outlive the bounded start retry cache.
		saved.processedStarts = Array.from(
			{ length: 100 },
			(_, index) => `recent-failed-start-${index}`,
		);
		if (retainedBy === "exclusion-record") saved.snapshot.history = [];
		else {
			saved.snapshot.excludedIds = [];
			saved.snapshot.exclusionRecords = [];
		}
		expect(parseRoomSnapshot(saved.snapshot)).not.toBeNull();
		context.storage.values.set("lunch-room:v1", saved);
		const restored = createServer(context);
		await restored.onStart();
		const before = structuredClone(latestSnapshot(host).snapshot);
		const persisted = structuredClone(storedSnapshot(context));
		const calls = entropy.mock.calls.length;
		const put = vi.spyOn(context.storage, "put");
		for (let retry = 0; retry < 2; retry++) {
			await send(restored, host, {
				type: "start",
				id,
				expectedRevision: 1,
				confirmReset: true,
			});
			await context.drain();
		}
		expect(requestErrors(host, id)).toEqual([]);
		expect(acknowledgements(host, id)).toHaveLength(3);
		expect(entropy).toHaveBeenCalledTimes(calls);
		expect(put).not.toHaveBeenCalled();
		expect(latestSnapshot(host).snapshot).toEqual(before);
		expect(storedSnapshot(context)).toEqual(persisted);
		expect(parseRoomSnapshot(storedSnapshot(context))).not.toBeNull();
	});

	it("retains a recommender's reconnect proof after roster eviction so their candidate remains removable", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const proof = "candidate-owner-reconnect-proof";
		const owner = await connect(
			server,
			context,
			"추천주인",
			undefined,
			undefined,
			proof,
		);
		const ownerId = latestSnapshot(owner).self?.id;
		await transition(server, host, "open", "owner-intake");
		const intakeId = latestSnapshot(owner).snapshot.intakeId;
		await send(server, owner, {
			type: "recommend",
			id: "owner-candidate",
			name: "우동",
			intakeId,
		});
		const candidate = latestSnapshot(host).snapshot.candidates.find(
			(item) => item.ownerId === ownerId,
		);
		owner.closed = true;
		await server.onClose(socketConnection(owner));
		for (let index = 0; index < lunchRoomLimits.maxMembers; index++) {
			vi.advanceTimersByTime(1);
			const transient = await connect(server, context, `손님${index}`);
			transient.closed = true;
			await server.onClose(socketConnection(transient));
		}
		expect(
			latestSnapshot(host).snapshot.members?.some(
				(item) => item.id === ownerId,
			),
		).toBe(false);
		const restored = createServer(context);
		await restored.onStart();
		const returned = await connect(
			restored,
			context,
			"추천주인",
			undefined,
			undefined,
			proof,
		);
		expect(latestSnapshot(returned).self?.id).toBe(ownerId);
		await send(restored, returned, {
			type: "remove-candidate",
			id: "owner-remove-after-wake",
			candidateId: candidate?.id,
			intakeId,
		});
		expect(requestErrors(returned, "owner-remove-after-wake")).toEqual([]);
		expect(
			latestSnapshot(host).snapshot.candidates.some(
				(item) => item.id === candidate?.id,
			),
		).toBe(false);
	});

	it("requires explicit waiting and editing before renaming an excluded candidate, then leaves consecutive OFF draws unexcluded", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await replaceList(server, host, 3, "rename-list");
		await setExclusion(server, host, true, "rename-exclusion-on");
		entropy.mockResolvedValueOnce({ numbers: [0], source: "quantum" });
		const original = await drawResult(
			server,
			context,
			host,
			"rename-winning-draw",
		);
		const before = latestSnapshot(host).snapshot;
		await send(server, host, {
			type: "room-edit",
			id: "rename-winner",
			baseListVersion: before.listVersion,
			candidates: before.candidates.map((candidate, index) => ({
				...candidate,
				name: index === 0 ? "1번 이름 수정" : candidate.name,
				included: index !== 1,
			})),
		});
		expect(requestErrors(host, "rename-winner")).toMatchObject([
			{ code: "PHASE_CONFLICT" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(before);
		await returnToWaiting(server, host);
		await editPreparedRoom(server, host, {
			id: "prepared-rename-winner",
			candidates: before.candidates.map((candidate, index) => ({
				...candidate,
				name: index === 0 ? "1번 이름 수정" : candidate.name,
				included: index !== 1,
			})),
		});
		const edited = latestSnapshot(host).snapshot;
		expect(edited).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: ["choice-1"],
			exclusionRecords: before.exclusionRecords,
			drawCount: 1,
			history: [original],
		});
		expect(edited.candidates[0]).toMatchObject({
			id: "choice-1",
			name: "1번 이름 수정",
		});
		await setExclusion(server, host, false, "rename-exclusion-off");
		entropy.mockResolvedValueOnce({ numbers: [1], source: "quantum" });
		const offFirst = await drawResult(
			server,
			context,
			host,
			"off-first-latest",
		);
		expect(offFirst.candidates.map((candidate) => candidate.id)).toEqual([
			"choice-1",
			"choice-3",
		]);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual([]);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			drawCount: 2,
			exclusionRecords: [],
		});
		await returnToWaiting(server, host);
		entropy.mockResolvedValueOnce({ numbers: [0], source: "quantum" });
		const offSecond = await drawResult(
			server,
			context,
			host,
			"off-second-latest",
		);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual([]);
		expect(storedSnapshot(context)).toMatchObject({
			drawCount: 3,
			exclusionRecords: [],
		});
		expect(offSecond.roundNumber).toBe(3);
		expect(latestSnapshot(host).snapshot.candidates[1].included).toBe(false);
		expect(
			latestSnapshot(host).snapshot.history.find(
				(draw) => draw.id === original.id,
			)?.candidates[0].name,
		).toBe("1번");
	});

	it.each([
		"remove-candidate",
		"room-edit",
	] as const)("prunes only the deleted candidate's draw record without resetting round numbers: %s", async (command) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await replaceList(server, host, 3, "prune-records-list");
		await setExclusion(server, host, true, "prune-records-on");
		entropy.mockResolvedValue({ numbers: [0], source: "quantum" });
		const first = await drawResult(server, context, host, "prune-round-1");
		await returnToWaiting(server, host);
		const second = await drawResult(server, context, host, "prune-round-2");
		expect(latestSnapshot(host).snapshot.exclusionRecords).toHaveLength(2);
		await returnToWaiting(server, host);
		await transition(server, host, "open", "prune-records-intake");
		const before = latestSnapshot(host).snapshot;
		if (command === "remove-candidate") {
			await send(server, host, {
				type: command,
				id: "prune-records-delete",
				candidateId: "choice-1",
				intakeId: before.intakeId,
			});
		} else {
			await send(server, host, {
				type: command,
				id: "prune-records-delete",
				baseListVersion: before.listVersion,
				candidates: before.candidates.filter((item) => item.id !== "choice-1"),
			});
		}
		expect(requestErrors(host, "prune-records-delete")).toEqual([]);
		const expected = {
			excludedIds: ["choice-2"],
			exclusionRecords: [
				{
					candidateId: "choice-2",
					drawId: second.id,
					drawnAt: second.startedAt + second.durationMs,
					roundNumber: 2,
				},
			],
			drawCount: 2,
			drawCountIsExact: true,
			history: [second, first],
		};
		expect(latestSnapshot(host).snapshot).toMatchObject(expected);
		expect(storedSnapshot(context)).toMatchObject(expected);
	});

	it("migrates an old waiting result without inventing an exclusion ledger or mutating the historical draw", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await drawResult(server, context, host, "legacy-phase-draw");
		const saved = structuredClone(
			context.storage.values.get("lunch-room:v1"),
		) as { snapshot: RoomSnapshot };
		saved.snapshot.status = "waiting";
		delete saved.snapshot.revision;
		delete saved.snapshot.intakeId;
		delete saved.snapshot.excludeDrawn;
		delete saved.snapshot.excludedIds;
		delete saved.snapshot.exclusionRecords;
		delete saved.snapshot.drawCount;
		delete saved.snapshot.drawCountIsExact;
		if (!saved.snapshot.draw) throw new Error("Expected old draw");
		delete saved.snapshot.draw.roundNumber;
		delete saved.snapshot.draw.roundNumberIsExact;
		delete saved.snapshot.draw.excludeDrawn;
		delete saved.snapshot.draw.excludedIdsBefore;
		const oldDraw = structuredClone(saved.snapshot.draw);
		context.storage.values.set("lunch-room:v1", saved);
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "result",
			excludeDrawn: false,
			excludedIds: [],
			intakeId: null,
			draw: oldDraw,
		});
		expect(latestSnapshot(host).snapshot.draw).not.toHaveProperty(
			"excludeDrawn",
		);
		await returnToWaiting(restored, host);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			excludedIds: [],
			history: [oldDraw],
		});
	});

	it("restores an interrupted OFF fetch without inventing an exclusion", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await drawResult(server, context, host, "before-interrupted-off");
		await returnToWaiting(server, host);
		const before = structuredClone(latestSnapshot(host).snapshot);
		entropy.mockReturnValueOnce(new Promise(() => {}));
		await send(server, host, {
			type: "start",
			id: "interrupted-off",
			expectedRevision: revision(host),
			confirmReset: true,
		});
		const restored = createServer(context);
		await restored.onStart();
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: before.excludedIds,
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
			history: before.history,
		});
		expect(storedSnapshot(context)).toMatchObject({
			exclusionRecords: before.exclusionRecords,
			drawCount: before.drawCount,
		});
		await send(restored, host, {
			type: "start",
			id: "interrupted-off",
			expectedRevision: revision(host),
			confirmReset: true,
		});
		expect(entropy).toHaveBeenCalledTimes(2);
		await send(restored, host, {
			type: "start",
			id: "fresh-after-interrupted-off",
			expectedRevision: revision(host),
			confirmReset: true,
		});
		await context.tasks.at(-1);
		expect(latestSnapshot(host).snapshot.status).toBe("drawing");
		expect(latestSnapshot(host).snapshot.exclusionRecords).toEqual([]);
		expect(storedSnapshot(context)).toMatchObject({
			drawCount: 2,
			draw: { id: "fresh-after-interrupted-off", roundNumber: 2 },
			exclusionRecords: [],
		});
		expect(entropy).toHaveBeenCalledTimes(3);
	});

	it("rolls back a failed intake save and allows retrying the same command ID", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const command = {
			type: "intake",
			id: "retry-open-save",
			action: "open",
			expectedRevision: revision(host),
		};
		const before = structuredClone(latestSnapshot(host).snapshot);
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("intake storage unavailable"),
		);
		await send(server, host, command);
		expect(requestErrors(host, "retry-open-save")).toMatchObject([
			{ code: "SAVE_FAILED" },
		]);
		expect(latestSnapshot(host).snapshot).toEqual(before);
		expect(acknowledgements(host, "retry-open-save")).toEqual([]);
		await send(server, host, command);
		expect(latestSnapshot(host).snapshot.status).toBe("collecting");
		expect(acknowledgements(host, "retry-open-save")).toHaveLength(1);
	});

	it("rejects recommendations at the supported candidate limit without changing the list or version", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "추천손님");
		await replaceList(
			server,
			host,
			lunchRoomLimits.maxCandidates,
			"maximum-list",
		);
		await transition(server, host, "open", "maximum-open");
		const before = structuredClone(latestSnapshot(host).snapshot);
		await send(server, guest, {
			type: "recommend",
			id: "over-maximum",
			intakeId: before.intakeId,
			name: "추가 후보",
		});
		expect(requestErrors(guest, "over-maximum")).toMatchObject([
			{ code: "CANDIDATE_LIMIT" },
		]);
		expect(latestSnapshot(host).snapshot.candidates).toEqual(before.candidates);
		expect(latestSnapshot(host).snapshot.listVersion).toBe(before.listVersion);
		expect(revision(host)).toBe(before.revision);
	});

	it("rejects unversioned legacy candidate replacement without losing a new recommendation or stored exclusions", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "추천손님");
		await drawResult(server, context, host, "before-legacy-update");
		await returnToWaiting(server, host);
		await transition(server, host, "open", "legacy-intake");
		await send(server, guest, {
			type: "recommend",
			id: "new-before-stale-tab",
			name: "우동",
			intakeId: latestSnapshot(host).snapshot.intakeId,
		});
		await transition(server, host, "finalize", "legacy-finalize");
		const before = structuredClone(latestSnapshot(host).snapshot);
		await send(server, host, {
			type: "candidates",
			ids: candidates.slice(0, 2).map((candidate) => candidate.id),
		});
		expect(hasError(host, "CLIENT_UPGRADE_REQUIRED")).toBe(true);
		expect(storedSnapshot(context).candidates).toEqual(before.candidates);
		expect(storedSnapshot(context).excludedIds).toEqual(before.excludedIds);
		expect(storedSnapshot(context).listVersion).toBe(before.listVersion);
	});

	it.each([
		"collecting",
		"fetching",
		"drawing",
	] as const)("publishes a committed action and keeps entropy running when scheduling the %s alarm fails", async (phase) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(server, context, "손님");
		// Force a changed deadline; unchanged alarms are intentionally coalesced.
		vi.advanceTimersByTime(lunchRoomLimits.awayAfterMs + 1);
		const setAlarm = context.storage.setAlarm.bind(context.storage);
		let failed = false;
		vi.spyOn(context.storage, "setAlarm").mockImplementation(
			async (deadline) => {
				if (!failed && storedSnapshot(context).status === phase) {
					failed = true;
					throw new Error("alarm temporarily unavailable");
				}
				return setAlarm(deadline);
			},
		);
		if (phase === "collecting") {
			await expect(
				transition(server, host, "open", "alarm-open"),
			).resolves.toBeUndefined();
			expect(latestSnapshot(guest).snapshot.status).toBe("collecting");
			expect(acknowledgements(host, "alarm-open")).toHaveLength(1);
		} else {
			await expect(
				send(server, host, {
					type: "start",
					id: "alarm-draw",
					expectedRevision: revision(host),
				}),
			).resolves.toBeUndefined();
			await context.drain();
			expect(entropy).toHaveBeenCalledExactlyOnceWith(0, 2, 1);
			expect(latestSnapshot(guest).snapshot.status).toBe("drawing");
			expect(latestSnapshot(guest).snapshot.draw?.id).toBe("alarm-draw");
			expect(storedSnapshot(context).status).toBe("drawing");
			expect(acknowledgements(host, "alarm-draw")).toHaveLength(1);
		}
		expect(failed).toBe(true);
	});

	it.each([
		"same-isolate",
		"restart",
	] as const)("recovers after both the result commit and failure cleanup saves fail: %s", async (recovery) => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		await drawResult(server, context, host, "before-double-save-failure");
		await returnToWaiting(server, host);
		const before = structuredClone(latestSnapshot(host).snapshot);
		const put = context.storage.put.bind(context.storage);
		let failuresRemaining = 2;
		vi.spyOn(context.storage, "put").mockImplementation(async (key, value) => {
			const saved = value as { snapshot?: RoomSnapshot };
			if (
				failuresRemaining > 0 &&
				["drawing", "waiting"].includes(saved.snapshot?.status ?? "")
			) {
				failuresRemaining--;
				throw new Error("storage temporarily unavailable");
			}
			return put(key, value);
		});
		await send(server, host, {
			type: "start",
			id: "double-save-failure",
			expectedRevision: revision(host),
			confirmReset: true,
		});
		await context.drain();
		expect(failuresRemaining).toBe(0);
		expect(latestSnapshot(host).snapshot).toMatchObject({
			status: "waiting",
			draw: null,
			excludedIds: before.excludedIds,
			history: before.history,
		});
		expect(storedSnapshot(context)).toMatchObject({
			status: "fetching",
			draw: null,
			excludedIds: before.excludedIds,
		});
		expect(
			messages(host).some(
				(message) =>
					message.type === "snapshot" &&
					message.snapshot.draw?.id === "double-save-failure",
			),
		).toBe(false);
		const recovered = recovery === "restart" ? createServer(context) : server;
		if (recovery === "restart") await recovered.onStart();
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(
			before.excludedIds,
		);
		entropy.mockResolvedValueOnce({ numbers: [0], source: "quantum" });
		const fresh = await drawResult(
			recovered,
			context,
			host,
			"fresh-after-double-save",
			true,
		);
		expect(fresh.id).toBe("fresh-after-double-save");
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual([]);
		expect(storedSnapshot(context).excludedIds).toEqual([]);
	});

	it("rolls back a failed result-feedback save and lets the same identified vote retry without changing the round", async () => {
		const { server, context } = await room();
		const host = await connect(server, context, "방장", hostToken);
		const guest = await connect(
			server,
			context,
			"투표손님",
			undefined,
			undefined,
			"vote-save-reconnect-proof",
		);
		const draw = await drawResult(server, context, host, "vote-save-round");
		const before = structuredClone(latestSnapshot(host).snapshot);
		const vote = {
			type: "vote",
			id: "retry-failed-feedback",
			drawId: draw.id,
			vote: "up",
		};
		vi.spyOn(context.storage, "put").mockRejectedValueOnce(
			new Error("feedback storage unavailable"),
		);
		await send(server, guest, vote);
		expect(requestErrors(guest, "retry-failed-feedback")).toMatchObject([
			{ code: "SAVE_FAILED" },
		]);
		expect(latestSnapshot(guest).snapshot.draw).toEqual(draw);
		expect(latestSnapshot(host).snapshot.draw).toEqual(draw);
		expect(storedSnapshot(context).draw).toEqual(draw);
		await send(server, guest, vote);
		const accepted = latestSnapshot(host).snapshot.draw;
		expect(accepted?.votes).toMatchObject([
			{
				participantId: latestSnapshot(guest).self?.id,
				name: "투표손님",
				vote: "up",
			},
		]);
		expect(accepted?.votes).toHaveLength(1);
		expect({ ...accepted, votes: [] }).toEqual(draw);
		expect(latestSnapshot(host).snapshot.candidates).toEqual(before.candidates);
		expect(latestSnapshot(host).snapshot.excludedIds).toEqual(
			before.excludedIds,
		);
		expect(latestSnapshot(host).snapshot.history).toEqual(before.history);
		await createServer(context).onStart();
		expect(latestSnapshot(host).snapshot.draw).toEqual(accepted);
	});
});
