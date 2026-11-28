import { type Connection, Server, type WSMessage } from "partyserver";
import {
	type ChatTrace,
	type ClientMessage,
	canStartRoomDraw,
	clampLunchRoomNickname,
	hasInvalidLunchRoomJoinNickname,
	isLunchRoomId,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	parseClientMessage,
	parseRoomSnapshot,
	type RoomMember,
	type RoomParticipant,
	type RoomSnapshot,
	type RoomSystemEvent,
	resolveCandidateIds,
	type ServerMessage,
	validateCreateRoomInput,
} from "@/lib/lunchRoom";
import {
	nicknameCheckPath,
	readBoundedRoomJson,
	roomEntryInfoPath,
	roomHistoryPath,
} from "@/lib/lunchRoomRequest.server";
import {
	hydrateRoomDrawMetadata,
	visibleRoomExclusions,
} from "@/lib/roomDrawMetadata";
import {
	advanceRoomRound,
	applyRoomCommand,
	beginRoomDraw,
	castRoomVote,
	createRoomSnapshot,
	finishRoomDraw,
	getRoomArchiveDraws,
	type LifecycleCommand,
	prepareRoomDraw,
	queueRoomDriveInput,
	type RoomDriveIntent,
	startRoomSpin,
	updateRoomDrive,
	validateRoomCommand,
} from "@/lib/roomGame";
import { getSpinDeadline } from "@/lib/spinDrive";
import type { EntropyBatch } from "@/services/randomCore";
import {
	drawFromPreparedEntropy,
	type PreparedRoomEntropy,
	reserveRoomEntropy,
	roomEntropyBatchSize,
	roomEntropyTtlMs,
	roomEntropyWordsPerDraw,
} from "@/services/roomEntropy";
import { fetchExternalEntropy } from "@/services/seedPool";

export type RoomEnv = Cloudflare.Env;

interface InitializeRoom {
	roomId: string;
	title: string;
	hostTokenHash: string;
	candidateIds?: string[];
	candidates?: RoomSnapshot["candidates"];
	gameFilter?: RoomSnapshot["gameFilter"];
	startInWaiting?: true;
	createdAt: number;
}

interface StoredRoom {
	snapshot: RoomSnapshot;
	hostTokenHash: string;
	hostParticipantId: string;
	hostName?: string;
	processedStarts: string[];
	pendingStartId: string | null;
	driveControl?: RoomDriveIntent & { drawId: string; socketId: string };
	presentParticipantIds: string[];
	guestTokenIds: Record<string, string>;
	processedCommands?: { key: string; fingerprint: string }[];
	drawEntropy?: PreparedRoomEntropy;
}

interface SocketState {
	socketId: string;
	connectedAt: number;
	participant?: RoomParticipant;
	lastChatAt?: number;
	lastActiveAt?: number;
	closing?: boolean;
	chatProtocol?: "delta-v1";
	voteProtocol?: "delta-v1";
}

interface NicknameAvailabilityResult {
	status: number;
	body: {
		name?: string;
		available?: boolean;
		error?: string;
		code?: string;
	};
}

interface EntryInfoResult {
	status: number;
	body: { title?: string; code?: string; error?: string };
}

const roomKey = "lunch-room:v1";
const joinTimeoutMs = 10_000;
const chatIntervalMs = 750;
const maxPendingConnections = 30;
const maxProcessedStarts = 100;
const maxProcessedCommands = 2000;
const maxGuestTokenMappings =
	lunchRoomLimits.maxMembers * (lunchRoomLimits.maxHistory + 2) +
	lunchRoomLimits.maxParticipants;
const snapshotFrameReserveBytes = 256 * 1024;
const utf8Encoder = new TextEncoder();
const hashPattern = /^[0-9a-f]{64}$/i;
const opaqueIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern = /^[A-Za-z0-9_-]{16,256}$/;

class RoomSnapshotSizeLimitError extends Error {
	constructor() {
		super("Room snapshot exceeds the supported server message size.");
	}
}

export class LunchRoomServer extends Server<RoomEnv> {
	static options = { hibernate: true };
	private room: StoredRoom | null = null;
	private loaded = false;
	private expired = false;
	private mutationQueue: Promise<void> = Promise.resolve();
	private scheduledAlarmAt: number | undefined;
	private checkedSnapshotCapacityKey: string | null = null;
	private drawEntropyRefreshing = false;
	private drawEntropyRetryAt = 0;

	private exclusive<T>(work: () => Promise<T>): Promise<T> {
		const task = this.mutationQueue.then(work);
		this.mutationQueue = task.then(
			() => {},
			() => {},
		);
		return task;
	}

	private async load() {
		if (this.loaded) return;
		const saved = await this.ctx.storage.get<StoredRoom>(roomKey);
		if (saved) {
			const snapshot = parseRoomSnapshot(saved.snapshot);
			if (
				snapshot &&
				hashPattern.test(saved.hostTokenHash) &&
				opaqueIdPattern.test(saved.hostParticipantId) &&
				Array.isArray(saved.processedStarts) &&
				saved.processedStarts.length <= maxProcessedStarts &&
				saved.processedStarts.every((id) => opaqueIdPattern.test(id))
			) {
				this.room = {
					...saved,
					snapshot,
					processedCommands: (Array.isArray(saved.processedCommands)
						? saved.processedCommands
						: []
					)
						.filter(
							(entry) =>
								entry &&
								typeof entry.key === "string" &&
								entry.key.length <= 170 &&
								hashPattern.test(entry.fingerprint),
						)
						.slice(-maxProcessedCommands),
					presentParticipantIds: Array.isArray(saved.presentParticipantIds)
						? saved.presentParticipantIds.filter((id) =>
								opaqueIdPattern.test(id),
							)
						: this.participants().map((participant) => participant.id),
					guestTokenIds: Object.fromEntries(
						Object.entries(saved.guestTokenIds ?? {})
							.filter(
								([hash, id]) =>
									hashPattern.test(hash) &&
									opaqueIdPattern.test(id) &&
									id !== saved.hostParticipantId,
							)
							.slice(0, maxGuestTokenMappings),
					),
				};
				hydrateRoomDrawMetadata(this.room.snapshot);
			}
		}
		if (this.room) this.migrateCurrentNicknames();
		this.loaded = true;
	}

	private migrateCurrentNicknames() {
		if (!this.room) return;
		if (typeof this.room.hostName === "string")
			this.room.hostName = clampLunchRoomNickname(this.room.hostName) || "방장";
		this.room.snapshot.participants = this.room.snapshot.participants.map(
			(participant) => ({
				...participant,
				name: clampLunchRoomNickname(participant.name) || "참가자",
			}),
		);
		this.room.snapshot.members = this.room.snapshot.members?.map((member) => ({
			...member,
			name: clampLunchRoomNickname(member.name) || "참가자",
		}));
		for (const socket of this.getConnections<SocketState>()) {
			const state = socket.state;
			if (!state?.participant) continue;
			const name = clampLunchRoomNickname(state.participant.name) || "참가자";
			if (name !== state.participant.name)
				socket.setState({
					...state,
					participant: { ...state.participant, name },
				});
		}
	}

	async onStart() {
		await this.exclusive(async () => {
			// A new/woken isolate must establish its own alarm cache.
			this.scheduledAlarmAt = undefined;
			await this.load();
			if (!this.room) {
				await this.ctx.storage.deleteAlarm();
				return;
			}
			if (await this.expireIfNeeded()) return;
			if (this.room.snapshot.status === "fetching") {
				// An isolate restart cannot resume an interrupted draw.
				this.room.snapshot.status = "waiting";
				this.room.snapshot.revision =
					(this.room.snapshot.revision ?? this.room.snapshot.listVersion) + 1;
				this.room.pendingStartId = null;
				delete this.room.driveControl;
				this.appendSystemEvent(
					"draw-failed",
					"추첨 준비가 중단됐습니다. 다시 시작해 주세요.",
				);
				await this.save();
				this.broadcastError(
					"DRAW_INTERRUPTED",
					"추첨 준비가 중단됐습니다. 다시 시작해 주세요.",
				);
			}
			await this.coastOrphanedDrive();
			await this.finishOverdueDraw();
			await this.closePendingConnections();
			await this.save();
			await this.scheduleAlarm();
			this.publish();
		});
	}

	async initialize(input: InitializeRoom): Promise<void> {
		await this.exclusive(async () => {
			await this.load();
			if (this.room || this.expired)
				throw new Error("Room already initialized");
			const validated = validateCreateRoomInput({
				title: input.title,
				hostName: "방장",
				candidateIds: input.candidateIds,
				candidates: input.candidates,
				gameFilter: input.gameFilter,
				startInWaiting: input.startInWaiting,
			});
			const candidates = validated
				? (validated.candidates ??
					resolveCandidateIds(validated.candidateIds, 0))
				: null;
			if (
				!validated ||
				!candidates ||
				!isLunchRoomId(input.roomId) ||
				input.roomId !== this.name ||
				!hashPattern.test(input.hostTokenHash) ||
				!Number.isSafeInteger(input.createdAt) ||
				input.createdAt < 0 ||
				input.createdAt > Date.now() + 60_000 ||
				input.createdAt + lunchRoomLimits.ttlMs <= Date.now()
			)
				throw new Error("Invalid room initialization");
			this.room = {
				hostTokenHash: input.hostTokenHash.toLowerCase(),
				hostParticipantId: crypto.randomUUID(),
				processedStarts: [],
				processedCommands: [],
				pendingStartId: null,
				presentParticipantIds: [],
				guestTokenIds: {},
				snapshot: createRoomSnapshot(
					input.roomId,
					input.createdAt,
					validated,
					candidates,
				),
			};
			await this.save();
			await this.scheduleAlarm();
		});
	}

	async checkNicknameAvailability(
		input: unknown,
	): Promise<NicknameAvailabilityResult> {
		return this.exclusive(async () => {
			await this.load();
			if (
				this.expired ||
				(this.room && Date.now() >= this.room.snapshot.expiresAt)
			)
				return {
					status: 410,
					body: { code: "ROOM_EXPIRED", error: "방이 만료됐습니다." },
				};
			if (this.room?.snapshot.status === "closed")
				return {
					status: 410,
					body: { code: "ROOM_CLOSED", error: "방장이 방을 종료했습니다." },
				};
			if (!this.room)
				return {
					status: 404,
					body: { code: "ROOM_NOT_FOUND", error: "방을 찾을 수 없습니다." },
				};
			if (!input || typeof input !== "object" || Array.isArray(input))
				return {
					status: 400,
					body: {
						code: "INVALID_REQUEST",
						error: "입력 내용을 확인해 주세요.",
					},
				};
			const value = input as Record<string, unknown>;
			const name = normalizeLunchRoomNickname(value.name);
			if (!name)
				return {
					status: 400,
					body: {
						code: "INVALID_NICKNAME",
						error: `닉네임은 제어문자 없이 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
					},
				};
			let participantId: string | undefined;
			if (value.hostToken !== undefined) {
				if (
					typeof value.hostToken !== "string" ||
					!tokenPattern.test(value.hostToken) ||
					(await this.hashToken(value.hostToken)) !== this.room.hostTokenHash
				)
					return {
						status: 403,
						body: {
							code: "HOST_AUTH_FAILED",
							error: "방장 인증을 확인해 주세요.",
						},
					};
				participantId = this.room.hostParticipantId;
			}
			if (value.guestToken !== undefined) {
				if (
					typeof value.guestToken !== "string" ||
					!tokenPattern.test(value.guestToken)
				)
					return {
						status: 400,
						body: {
							code: "INVALID_REQUEST",
							error: "입력 내용을 확인해 주세요.",
						},
					};
				if (!participantId)
					participantId =
						this.room.guestTokenIds[await this.hashToken(value.guestToken)];
			}
			return {
				status: 200,
				body: { name, available: !this.isNicknameTaken(name, participantId) },
			};
		});
	}

	async getEntryInfo(): Promise<EntryInfoResult> {
		return this.exclusive(async () => {
			await this.load();
			// This read does not refresh presence/TTL or run expiry mutations.
			// A cold PartyServer wake still performs its normal onStart recovery.
			if (
				this.expired ||
				(this.room && Date.now() >= this.room.snapshot.expiresAt)
			)
				return {
					status: 410,
					body: { code: "ROOM_EXPIRED", error: "방이 만료됐습니다." },
				};
			if (this.room?.snapshot.status === "closed")
				return {
					status: 410,
					body: { code: "ROOM_CLOSED", error: "방장이 방을 종료했습니다." },
				};
			if (!this.room)
				return {
					status: 404,
					body: { code: "ROOM_NOT_FOUND", error: "방을 찾을 수 없습니다." },
				};
			return { status: 200, body: { title: this.room.snapshot.title } };
		});
	}

	async getClosedHistory(input: unknown) {
		return this.exclusive(async () => {
			await this.load();
			if (
				this.expired ||
				(this.room && Date.now() >= this.room.snapshot.expiresAt)
			)
				return {
					status: 410,
					body: { error: "방이 만료되어 기록이 삭제되었습니다." },
				};
			if (!this.room)
				return { status: 404, body: { error: "방을 찾을 수 없습니다." } };
			const proof =
				input && typeof input === "object" && !Array.isArray(input)
					? (input as Record<string, unknown>)
					: {};
			const valid = async (token: unknown, host: boolean) => {
				if (typeof token !== "string" || !tokenPattern.test(token))
					return false;
				const hash = await this.hashToken(token);
				return host
					? hash === this.room?.hostTokenHash
					: Boolean(this.room?.guestTokenIds[hash]);
			};
			if (
				!(await valid(proof.hostToken, true)) &&
				!(await valid(proof.guestToken, false))
			)
				return {
					status: 403,
					body: {
						error: "이 방에 참가했던 브라우저에서 기록을 확인해 주세요.",
					},
				};
			if (this.room.snapshot.status !== "closed")
				return {
					status: 409,
					body: { error: "진행 중인 방의 기록은 방 안에서 확인해 주세요." },
				};
			const { title, expiresAt } = this.room.snapshot;
			const draws = getRoomArchiveDraws(this.room.snapshot);
			return {
				status: 200,
				body: { title, expiresAt, draws: structuredClone(draws) },
			};
		});
	}

	async onRequest(request: Request): Promise<Response> {
		if (
			request.method === "GET" &&
			new URL(request.url).pathname === roomEntryInfoPath
		) {
			const result = await this.getEntryInfo();
			return Response.json(result.body, {
				status: result.status,
				headers: { "Cache-Control": "no-store" },
			});
		}
		if (
			request.method !== "POST" ||
			![nicknameCheckPath, roomHistoryPath].includes(
				new URL(request.url).pathname,
			)
		)
			return new Response("Not Found", { status: 404 });
		const startedAt = performance.now();
		const respond = (body: unknown, status: number) =>
			Response.json(body, {
				status,
				headers: {
					"Cache-Control": "no-store",
					"Server-Timing": `nickname;dur=${(performance.now() - startedAt).toFixed(1)}`,
				},
			});
		if (
			request.headers.get("Content-Type")?.split(";")[0].trim() !==
			"application/json"
		)
			return respond(
				{ code: "INVALID_REQUEST", error: "JSON 형식이 필요합니다." },
				415,
			);
		let body: unknown;
		try {
			body = await readBoundedRoomJson(request);
		} catch (error) {
			return respond(
				{ code: "INVALID_REQUEST", error: "입력 내용을 확인해 주세요." },
				error instanceof RangeError ? 413 : 400,
			);
		}
		const result =
			new URL(request.url).pathname === roomHistoryPath
				? await this.getClosedHistory(body)
				: await this.checkNicknameAvailability(body);
		return respond(result.body, result.status);
	}

	async onConnect(connection: Connection<SocketState>) {
		await this.exclusive(async () => {
			await this.load();
			if (await this.rejectUnavailable(connection)) return;
			const connections = [...this.getConnections<SocketState>()].filter(
				(socket) => !socket.state?.closing,
			);
			const pending = connections.filter(
				(socket) => !socket.state?.participant,
			);
			if (
				pending.length > maxPendingConnections ||
				connections.length >
					lunchRoomLimits.maxParticipants + maxPendingConnections
			) {
				this.reject(
					connection,
					"ROOM_FULL",
					"입장 대기 인원이 많습니다. 잠시 후 다시 접속해 주세요.",
					4009,
				);
				return;
			}
			connection.setState({
				socketId: crypto.randomUUID(),
				connectedAt: Date.now(),
			});
			await this.scheduleAlarm();
		});
	}

	async onMessage(connection: Connection<SocketState>, raw: WSMessage) {
		const started = performance.now();
		const receivedAt = Date.now();
		const message = parseClientMessage(raw);
		const queuedAt = performance.now();
		await this.exclusive(async () => {
			const queueMs = performance.now() - queuedAt;
			await this.load();
			if (connection.state?.closing) return;
			if (await this.rejectUnavailable(connection)) return;
			await this.finishOverdueDraw(
				message?.type === "drive" ? receivedAt : undefined,
			);
			if (!message) {
				const invalidNickname = hasInvalidLunchRoomJoinNickname(raw);
				this.sendError(
					connection,
					invalidNickname ? "INVALID_NICKNAME" : "INVALID_MESSAGE",
					invalidNickname
						? `닉네임은 제어문자 없이 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`
						: "요청 내용을 확인해 주세요.",
				);
				return;
			}
			if (message.type === "join") {
				await this.join(connection, message);
				return;
			}
			const state = connection.state;
			if (!state?.participant) {
				this.sendError(
					connection,
					"JOIN_REQUIRED",
					"이름을 입력하고 방에 입장해 주세요.",
					"id" in message ? message.id : undefined,
				);
				return;
			}
			if (
				[
					"intake",
					"recommend",
					"remove-candidate",
					"room-edit",
					"options",
					"draw-view",
					"switch-game",
					"game-filter",
					"reset-exclusions",
				].includes(message.type)
			) {
				await this.lifecycleCommand(connection, message as LifecycleCommand);
				return;
			}
			switch (message.type) {
				case "room-close":
					await this.closeRoom(connection, message.id);
					break;
				case "activity": {
					const presenceChanged = this.recordActivity(connection);
					await this.save();
					await this.scheduleAlarm();
					if (presenceChanged) this.publish();
					break;
				}
				case "ping":
					this.send(connection, {
						type: "pong",
						clientTime: message.clientTime,
						serverTime: Date.now(),
					});
					break;
				case "chat":
					await this.chat(
						connection,
						message,
						message.diagnosticId ? { started, receivedAt, queueMs } : undefined,
					);
					break;
				case "vote":
					await this.vote(connection, message);
					break;
				case "drive":
					await this.changeDrive(connection, message, receivedAt);
					break;
				case "start":
				case "next":
				case "candidates":
					if (
						!state.participant.isHost ||
						state.participant.id !== this.room?.hostParticipantId
					) {
						this.sendError(
							connection,
							"HOST_REQUIRED",
							"방장만 추첨 조건을 바꾸거나 시작할 수 있습니다.",
							message.type === "start" || message.type === "next"
								? message.id
								: undefined,
						);
						return;
					}
					if (message.type === "start")
						await this.beginDraw(connection, message);
					else if (message.type === "next")
						await this.nextRound(connection, message);
					else await this.changeCandidates(connection, message.ids);
					break;
			}
		});
	}

	private async closeRoom(
		connection: Connection<SocketState>,
		requestId: string,
	) {
		if (!this.room) return;
		const participant = connection.state?.participant;
		if (
			!participant?.isHost ||
			participant.id !== this.room.hostParticipantId
		) {
			this.sendError(
				connection,
				"HOST_REQUIRED",
				"방장만 방을 종료할 수 있습니다.",
				requestId,
			);
			return;
		}
		if (["fetching", "drawing"].includes(this.room.snapshot.status)) {
			this.sendError(
				connection,
				"DRAW_BUSY",
				"추첨이 끝난 뒤 방을 종료해 주세요.",
				requestId,
			);
			return;
		}
		const before = structuredClone(this.room);
		this.room.snapshot.status = "closed";
		delete this.room.drawEntropy;
		this.room.snapshot.revision =
			(this.room.snapshot.revision ?? this.room.snapshot.listVersion) + 1;
		try {
			await this.save();
		} catch {
			this.room = before;
			this.sendError(
				connection,
				"SAVE_FAILED",
				"방을 종료하지 못했습니다. 다시 시도해 주세요.",
				requestId,
			);
			return;
		}
		this.send(connection, { type: "ack", requestId });
		this.publish();
		for (const socket of this.getConnections<SocketState>())
			this.reject(
				socket,
				"ROOM_CLOSED",
				"방장이 방을 종료했습니다. 새 방을 만들어 주세요.",
				4008,
			);
	}

	private async lifecycleCommand(
		connection: Connection<SocketState>,
		message: LifecycleCommand,
	) {
		if (!this.room || !connection.state?.participant) return;
		const participant = connection.state.participant;
		const host =
			participant.isHost && participant.id === this.room.hostParticipantId;
		const fail = (code: string, explanation: string) => {
			this.sendError(connection, code, explanation, message.id);
			this.sendSnapshot(connection);
		};
		if (
			!host &&
			message.type !== "recommend" &&
			message.type !== "remove-candidate"
		) {
			fail("HOST_REQUIRED", "방장만 후보와 게임 조건을 관리할 수 있습니다.");
			return;
		}
		const key = `${participant.id}:${message.id}`;
		const fingerprint = await this.hashToken(JSON.stringify(message));
		const processed = this.room.processedCommands ?? [];
		const previous = processed.find((entry) => entry.key === key);
		if (previous) {
			if (previous.fingerprint !== fingerprint)
				fail(
					"REQUEST_ID_REUSED",
					"이미 사용한 요청입니다. 내용을 확인하고 다시 시도해 주세요.",
				);
			else {
				this.sendSnapshot(connection);
				this.send(connection, { type: "ack", requestId: message.id });
			}
			return;
		}
		if (processed.length >= maxProcessedCommands) {
			fail(
				"REQUEST_LIMIT",
				"이 방의 변경 요청 한도에 도달했습니다. 새 방을 만들어 주세요.",
			);
			return;
		}
		const snapshot = this.room.snapshot;
		const invalid = validateRoomCommand(snapshot, message, participant, host);
		if (invalid) {
			fail(invalid.code, invalid.message);
			return;
		}
		const before = structuredClone(this.room);
		try {
			applyRoomCommand(
				snapshot,
				message,
				participant,
				this.room.hostParticipantId,
			);
			this.room.processedCommands = [...processed, { key, fingerprint }];
			this.recordActivity(connection);
			await this.save();
		} catch (error) {
			this.room = before;
			if (error instanceof RoomSnapshotSizeLimitError) {
				fail(
					"ROOM_SNAPSHOT_LIMIT",
					"후보와 추첨 기록의 용량이 커서 저장할 수 없습니다. 후보나 메뉴 내용을 줄이거나 새 방에서 계속해 주세요.",
				);
				return;
			}
			fail(
				"SAVE_FAILED",
				"변경을 저장하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.",
			);
			return;
		}
		await this.scheduleAlarm();
		this.publish();
		this.send(connection, { type: "ack", requestId: message.id });
	}

	private async join(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "join" }>,
	) {
		if (!this.room) return;
		if (connection.state?.participant) {
			const state = connection.state;
			const participant = state.participant;
			if (!participant) return;
			if (this.rejectTakenNickname(connection, message.name, participant.id))
				return;
			const presenceChanged = this.recordActivity(connection);
			if (participant.name === message.name) {
				await this.save();
				await this.scheduleAlarm();
				if (presenceChanged) this.publish();
				else this.sendSnapshot(connection);
				return;
			}
			if (participant.isHost && participant.id === this.room.hostParticipantId)
				this.room.hostName = message.name;
			this.updateAttachedName(participant.id, message.name);
			this.appendSystemEvent(
				"renamed",
				`${participant.name}님이 ${message.name}님으로 이름을 바꿨습니다.`,
			);
			await this.save();
			await this.scheduleAlarm();
			this.publish();
			return;
		}
		const state = connection.state;
		if (!state || Date.now() - state.connectedAt >= joinTimeoutMs) {
			this.reject(
				connection,
				"JOIN_TIMEOUT",
				"입장 시간이 초과됐습니다. 다시 접속해 주세요.",
				4008,
			);
			return;
		}
		let isHost = false;
		if (message.hostToken) {
			const hash = await this.hashToken(message.hostToken);
			if (hash !== this.room.hostTokenHash) {
				this.reject(
					connection,
					"HOST_AUTH_FAILED",
					"방장 인증을 확인해 주세요.",
					4003,
				);
				return;
			}
			isHost = true;
		}
		const guestHash =
			!isHost && message.guestToken
				? await this.hashToken(message.guestToken)
				: undefined;
		const participantId = isHost
			? this.room.hostParticipantId
			: (guestHash && this.room.guestTokenIds[guestHash]) ||
				crypto.randomUUID();
		const participants = this.participants();
		if (
			!participants.some((participant) => participant.id === participantId) &&
			participants.length >= lunchRoomLimits.maxParticipants
		) {
			this.reject(
				connection,
				"ROOM_FULL",
				"이 방의 참가 인원이 가득 찼습니다.",
				4009,
			);
			return;
		}
		const previousMember = this.room.snapshot.members?.find(
			(member) => member.id === participantId,
		);
		const activeParticipant = participants.find(
			(participant) => participant.id === participantId,
		);
		const restoredName = isHost
			? this.room.hostName
			: (activeParticipant?.name ?? previousMember?.name);
		const name = message.updateName
			? message.name
			: (normalizeLunchRoomNickname(restoredName) ?? message.name);
		if (this.rejectTakenNickname(connection, name, participantId)) return;
		if (isHost) this.room.hostName = name;
		if (guestHash) this.room.guestTokenIds[guestHash] = participantId;
		this.updateAttachedName(participantId, name);
		if (activeParticipant && activeParticipant.name !== name)
			this.appendSystemEvent(
				"renamed",
				`${activeParticipant.name}님이 ${name}님으로 이름을 바꿨습니다.`,
			);
		connection.setState({
			...state,
			lastActiveAt: Date.now(),
			chatProtocol: message.chatProtocol,
			voteProtocol: message.voteProtocol,
			participant: {
				id: participantId,
				name,
				isHost,
			},
		});
		if (!this.room.presentParticipantIds.includes(participantId)) {
			this.room.presentParticipantIds.push(participantId);
			this.appendSystemEvent(
				"joined",
				`${connection.state?.participant?.name ?? message.name}님이 입장했습니다.`,
			);
		}
		await this.save();
		await this.scheduleAlarm();
		this.publish();
	}

	private rejectTakenNickname(
		connection: Connection<SocketState>,
		name: string,
		participantId: string,
	): boolean {
		const taken = this.isNicknameTaken(name, participantId);
		if (taken)
			this.sendError(
				connection,
				"NICKNAME_TAKEN",
				"이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.",
			);
		return taken;
	}

	private isNicknameTaken(name: string, participantId?: string): boolean {
		const key = name.normalize("NFKC").trim().toLowerCase();
		return this.participants().some(
			(participant) =>
				participant.id !== participantId &&
				participant.name.normalize("NFKC").trim().toLowerCase() === key,
		);
	}

	private updateAttachedName(participantId: string, name: string) {
		for (const socket of this.getConnections<SocketState>()) {
			const state = socket.state;
			if (!state?.closing && state?.participant?.id === participantId)
				socket.setState({
					...state,
					participant: { ...state.participant, name },
				});
		}
	}

	private async chat(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "chat" }>,
		timing?: { started: number; receivedAt: number; queueMs: number },
	) {
		const state = connection.state;
		const participant = state?.participant;
		if (!this.room || !state || !participant) return;
		if (this.room.snapshot.messages.some((entry) => entry.id === message.id)) {
			this.sendSnapshot(connection);
			return;
		}
		const now = Date.now();
		if (
			state.lastChatAt !== undefined &&
			now - state.lastChatAt < chatIntervalMs
		) {
			this.sendError(
				connection,
				"CHAT_RATE_LIMIT",
				"메시지를 조금 천천히 보내 주세요.",
				message.id,
			);
			return;
		}
		const before = structuredClone(this.room);
		connection.setState({ ...state, lastChatAt: now, lastActiveAt: now });
		this.room.snapshot.messages = [
			...this.room.snapshot.messages,
			{
				id: message.id,
				participantId: participant.id,
				name: participant.name,
				text: message.text,
				timestamp: now,
			},
		].slice(-lunchRoomLimits.maxMessages);
		const saveStarted = performance.now();
		try {
			await this.save();
		} catch {
			this.room = before;
			connection.setState(state);
			this.sendError(
				connection,
				"SAVE_FAILED",
				"메시지를 저장하지 못했습니다. 다시 시도해 주세요.",
				message.id,
			);
			return;
		}
		const alarmStarted = performance.now();
		await this.scheduleAlarm();
		const syncStarted = performance.now();
		// Debug only: await the durability boundary that otherwise gates socket output.
		// A failed flush must not emit a successful acknowledgement.
		if (timing && message.diagnosticId) await this.ctx.storage.sync();
		const ready = performance.now();
		const chatTrace: ChatTrace | undefined =
			timing && message.diagnosticId
				? {
						diagnosticId: message.diagnosticId,
						serverReceivedAt: timing.receivedAt,
						serverSendAt: Date.now(),
						queueMs: timing.queueMs,
						prepareMs: saveStarted - timing.started - timing.queueMs,
						saveMs: alarmStarted - saveStarted,
						alarmMs: syncStarted - alarmStarted,
						syncMs: ready - syncStarted,
						serverTotalMs: ready - timing.started,
					}
				: undefined;
		this.publishChat(
			connection,
			chatTrace && timing
				? { connection, chatTrace, started: timing.started }
				: undefined,
		);
	}

	private async changeCandidates(
		connection: Connection<SocketState>,
		_ids: string[],
	) {
		// Pre-lifecycle clients cannot supply a base version; never let them replace
		// newly recommended/custom candidates or silently drop the exclusion ledger.
		this.sendError(
			connection,
			"CLIENT_UPGRADE_REQUIRED",
			"후보 편집 방식이 바뀌었습니다. 새로고침한 뒤 후보·옵션 보기에서 편집해 주세요.",
		);
		this.sendSnapshot(connection);
	}

	private async vote(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "vote" }>,
	) {
		const participant = connection.state?.participant;
		if (!this.room || !participant) return;
		const result = castRoomVote(
			this.room.snapshot,
			participant,
			message.drawId,
			message.vote,
			Date.now(),
		);
		if (result.error) {
			this.sendError(
				connection,
				result.error.code,
				result.error.message,
				message.id,
			);
			if (result.error.code === "VOTE_ALREADY_CAST")
				this.sendSnapshot(connection);
			return;
		}
		const before = structuredClone(this.room);
		const { draw, vote } = result;
		this.room.snapshot.draw = draw;
		this.recordActivity(connection);
		try {
			await this.save();
		} catch {
			this.room = before;
			this.sendError(
				connection,
				"SAVE_FAILED",
				"결과 피드백을 저장하지 못했습니다. 다시 시도해 주세요.",
				message.id,
			);
			this.sendSnapshot(connection);
			return;
		}
		await this.scheduleAlarm();
		for (const peer of this.getConnections<SocketState>()) {
			const state = peer.state;
			if (!state?.participant || state.closing) continue;
			if (state.voteProtocol !== "delta-v1") {
				this.sendSnapshot(peer);
				continue;
			}
			this.send(peer, {
				type: "vote-recorded",
				roomId: this.room.snapshot.roomId,
				drawId: draw.id,
				voteCount: draw.votes.length,
				vote,
			});
		}
	}

	private async nextRound(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "next" }>,
	) {
		if (!this.room) return;
		// A repeated or delayed request must never close a newer round.
		const alreadyArchived = this.room.snapshot.history.some(
			(draw) => draw.id === message.drawId,
		);
		if (alreadyArchived && this.room.snapshot.draw?.id !== message.drawId) {
			this.sendSnapshot(connection);
			this.send(connection, { type: "ack", requestId: message.id });
			return;
		}
		const draw = this.room.snapshot.draw;
		if (
			!draw ||
			draw.id !== message.drawId ||
			this.room.snapshot.status !== "result" ||
			Date.now() < getSpinDeadline(draw)
		) {
			this.sendError(
				connection,
				"VOTE_NOT_READY",
				"현재 추첨이 끝난 뒤 투표를 종료해 주세요.",
				message.id,
			);
			return;
		}
		const before = structuredClone(this.room);
		advanceRoomRound(this.room.snapshot, Boolean(message.editCandidates));
		this.recordActivity(connection);
		try {
			await this.save();
		} catch {
			this.room = before;
			this.sendError(
				connection,
				"SAVE_FAILED",
				"다음 게임으로 전환하지 못했습니다. 다시 시도해 주세요.",
				message.id,
			);
			return;
		}
		await this.scheduleAlarm();
		this.publish();
		this.send(connection, { type: "ack", requestId: message.id });
	}

	private async beginDraw(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "start" }>,
	) {
		if (!this.room) return;
		const requestId = message.id;
		const drawId = message.driveId ?? requestId;
		const snapshot = this.room.snapshot;
		if (
			this.room.processedStarts.includes(requestId) ||
			this.room.processedStarts.includes(drawId) ||
			snapshot.draw?.id === drawId ||
			snapshot.history.some((draw) => draw.id === drawId) ||
			snapshot.olderWins?.some((win) => win.id === drawId) ||
			snapshot.exclusionRecords?.some((record) => record.drawId === drawId)
		) {
			this.sendSnapshot(connection);
			this.send(connection, { type: "ack", requestId });
			return;
		}
		if (!canStartRoomDraw(snapshot, message.previousDrawId)) {
			this.sendError(
				connection,
				"DRAW_BUSY",
				message.previousDrawId
					? "현재 결과를 확인한 뒤 다시 뽑아 주세요."
					: "대기 화면에서 추첨을 시작해 주세요.",
				requestId,
			);
			return;
		}
		if (
			message.expectedRevision !== undefined &&
			message.expectedRevision !== (snapshot.revision ?? snapshot.listVersion)
		) {
			this.sendError(
				connection,
				"REVISION_CONFLICT",
				"게임 조건이 바뀌었어요. 목록을 확인한 뒤 다시 진행해 주세요.",
				requestId,
			);
			this.sendSnapshot(connection);
			return;
		}
		const drawInput = prepareRoomDraw(
			snapshot,
			this.participants(),
			message.spinPower,
		);
		const { candidates, requestedAt } = drawInput;
		if (candidates.length === 0) {
			this.sendError(
				connection,
				"NO_CANDIDATES",
				"추첨할 후보가 없습니다. 제외 목록이나 후보를 확인해 주세요.",
				requestId,
			);
			return;
		}
		const before = structuredClone(this.room);
		const prepared = this.room.drawEntropy;
		const reserved = reserveRoomEntropy(prepared, requestedAt);
		// Consume these words in the same durable write as the start request.
		if (prepared && (!reserved || !prepared.seeds.length))
			delete this.room.drawEntropy;
		this.room.processedStarts = [
			...this.room.processedStarts,
			requestId,
			...(drawId === requestId ? [] : [drawId]),
		].slice(-maxProcessedStarts);
		this.room.pendingStartId = requestId;
		delete this.room.driveControl;
		const socketId = connection.state?.socketId;
		if (message.driveId && socketId) {
			this.room.driveControl = {
				drawId,
				socketId,
				held: true,
				sequence: 0,
				startIndex: message.driveStartIndex,
			};
		}
		beginRoomDraw(snapshot);
		this.recordActivity(connection);
		this.appendSystemEvent(
			"draw-started",
			`${connection.state?.participant?.name ?? "방장"}님이 ${candidates.length}개 중 추첨을 시작했습니다.`,
		);
		try {
			await this.save();
		} catch {
			this.room = before;
			this.sendError(
				connection,
				"SAVE_FAILED",
				"추첨 준비를 저장하지 못했습니다. 다시 시도해 주세요.",
				requestId,
			);
			return;
		}
		this.publish();
		this.send(connection, { type: "ack", requestId });
		// Release the queue so the pending draw can commit after the start acknowledgement.
		this.ctx.waitUntil(this.completeDraw(requestId, drawInput, reserved));
		await this.scheduleAlarm();
	}

	private async completeDraw(
		requestId: string,
		drawInput: ReturnType<typeof prepareRoomDraw>,
		reserved: EntropyBatch | undefined,
	) {
		try {
			const result = await drawFromPreparedEntropy(
				drawInput.candidates.length - 1,
				reserved,
			);
			await this.exclusive(async () => {
				if (
					(await this.expireIfNeeded()) ||
					!this.room ||
					this.room.pendingStartId !== requestId ||
					this.room.snapshot.status !== "fetching"
				)
					return;
				const before = structuredClone(this.room);
				const drive = this.room.driveControl;
				if (drive?.held && this.orphanedDrive()) {
					queueRoomDriveInput(
						drive,
						{ held: false, sequence: drive.sequence + 1 },
						Date.now(),
					);
				}
				startRoomSpin(
					this.room.snapshot,
					drawInput,
					result,
					drive?.drawId ?? requestId,
					0,
					drive,
				);
				if (drive) delete drive.inputs;
				this.room.pendingStartId = null;
				try {
					// Result and exclusion ledger are a single durable commit; publish only on success.
					await this.save();
				} catch (error) {
					this.room = before;
					throw error;
				}
				await this.scheduleAlarm();
				this.publish();
			});
		} catch {
			await this.exclusive(async () => {
				if (
					(await this.expireIfNeeded()) ||
					!this.room ||
					this.room.pendingStartId !== requestId
				)
					return;
				this.room.pendingStartId = null;
				delete this.room.driveControl;
				this.room.snapshot.status = "waiting";
				this.room.snapshot.revision =
					(this.room.snapshot.revision ?? drawInput.listVersion) + 1;
				this.appendSystemEvent(
					"draw-failed",
					"추첨에 실패했습니다. 다시 시작해 주세요.",
				);
				try {
					await this.save();
				} catch {
					// Keep the safe waiting state in memory. A later save retries it;
					// a restart also recovers the durable fetching snapshot in onStart.
				}
				this.broadcastError(
					"DRAW_FAILED",
					"추첨 결과를 저장하지 못했습니다. 다시 연결해 상태를 확인해 주세요.",
					requestId,
				);
				await this.scheduleAlarm();
				this.publish();
			});
		}
	}

	private orphanedDrive() {
		const socketId = this.room?.driveControl?.socketId;
		return (
			!socketId ||
			![...this.getConnections<SocketState>()].some(
				(connection) =>
					connection.state?.socketId === socketId &&
					!connection.state.closing &&
					connection.state.participant?.isHost,
			)
		);
	}

	private async changeDrive(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "drive" }>,
		receivedAt: number,
	) {
		const room = this.room;
		const owner = room?.driveControl;
		const state = connection.state;
		if (
			!room ||
			!owner ||
			!state?.participant?.isHost ||
			state.participant.id !== room.hostParticipantId ||
			state.socketId !== owner.socketId ||
			message.drawId !== owner.drawId ||
			message.sequence <= owner.sequence
		)
			return;
		const snapshot = room.snapshot;
		const before = structuredClone(room);
		if (snapshot.status === "fetching") {
			queueRoomDriveInput(owner, message, receivedAt);
		} else {
			if (!updateRoomDrive(snapshot, message.drawId, message, receivedAt))
				return;
			owner.held = message.held;
			owner.sequence = message.sequence;
		}
		try {
			await this.save({ refreshPresence: false });
		} catch {
			this.room = before;
			// If a transition could not persist, dropping the control socket
			// makes the current committed drive coast through onClose.
			this.reject(
				connection,
				"SAVE_FAILED",
				"추첨 조작을 저장하지 못했습니다. 다시 연결해 주세요.",
				1011,
			);
			await this.coastOrphanedDrive();
			await this.scheduleAlarm();
			return;
		}
		if (snapshot.status === "drawing") {
			await this.scheduleAlarm();
			this.publish();
		}
	}

	private async coastOrphanedDrive() {
		const room = this.room;
		if (!room || !this.orphanedDrive()) return;
		const snapshot = room.snapshot;
		const draw = snapshot.draw;
		if (snapshot.status !== "drawing" || !draw?.drive?.held) return;
		const before = structuredClone(room);
		if (
			!updateRoomDrive(
				snapshot,
				draw.id,
				{ held: false, sequence: draw.drive.sequence + 1 },
				Date.now(),
			)
		)
			return;
		delete room.driveControl;
		try {
			await this.save();
		} catch {
			this.room = before;
			return;
		}
		this.publish();
	}

	private appendSystemEvent(event: RoomSystemEvent, text: string) {
		if (!this.room) return;
		this.room.snapshot.messages = [
			...this.room.snapshot.messages,
			{
				id: crypto.randomUUID(),
				participantId: "system",
				name: "시스템",
				event,
				text: text.slice(0, 500),
				timestamp: Date.now(),
			},
		].slice(-lunchRoomLimits.maxMessages);
	}

	private async hashToken(token: string) {
		const digest = await crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(token),
		);
		return Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
	}

	private recordActivity(connection: Connection<SocketState>): boolean {
		if (!connection.state?.participant || connection.state.closing)
			return false;
		connection.setState({ ...connection.state, lastActiveAt: Date.now() });
		return this.refreshMembers();
	}

	private refreshMembers(): boolean {
		if (!this.room) return false;
		const now = Date.now();
		const previous = this.room.snapshot.members ?? [];
		const members = new Map<string, RoomMember>(
			previous.map((member) => [member.id, { ...member }]),
		);
		const activeIds = new Set<string>();
		for (const connection of this.getConnections<SocketState>()) {
			const state = connection.state;
			if (!state?.participant || state.closing) continue;
			const participant = state.participant;
			const known = members.get(participant.id);
			const lastActiveAt = Math.max(
				known?.lastActiveAt ?? 0,
				state.lastActiveAt ?? known?.lastActiveAt ?? state.connectedAt,
			);
			activeIds.add(participant.id);
			members.set(participant.id, {
				...participant,
				status:
					now - lastActiveAt >= lunchRoomLimits.awayAfterMs ? "away" : "online",
				lastActiveAt,
				lastSeenAt: now,
			});
		}
		for (const member of members.values()) {
			if (activeIds.has(member.id)) continue;
			if (member.status !== "offline") member.lastSeenAt = now;
			member.status = "offline";
		}
		const offline = [...members.values()]
			.filter((member) => !activeIds.has(member.id))
			.sort(
				(left, right) =>
					left.lastSeenAt - right.lastSeenAt || left.id.localeCompare(right.id),
			);
		for (const member of offline) {
			if (members.size <= lunchRoomLimits.maxMembers) break;
			members.delete(member.id);
		}
		this.room.snapshot.members = [...members.values()].sort(
			(left, right) =>
				Number(right.isHost) - Number(left.isHost) ||
				left.id.localeCompare(right.id),
		);
		const retainedParticipants = new Set([
			...this.room.snapshot.candidates.flatMap((candidate) =>
				candidate.ownerId ? [candidate.ownerId] : [],
			),
			...(this.room.snapshot.draw?.participants?.map(
				(participant) => participant.id,
			) ?? []),
			...[this.room.snapshot.draw, ...this.room.snapshot.history].flatMap(
				(draw) => draw?.votes?.map((vote) => vote.participantId) ?? [],
			),
		]);
		this.room.guestTokenIds = Object.fromEntries(
			Object.entries(this.room.guestTokenIds).filter(
				([, id]) => members.has(id) || retainedParticipants.has(id),
			),
		);
		this.room.presentParticipantIds = this.room.presentParticipantIds.filter(
			(id) => members.has(id),
		);
		const statusKey = (member: RoomMember) =>
			`${member.id}:${member.status}:${member.name}:${member.isHost}`;
		return (
			previous.map(statusKey).join("|") !==
			this.room.snapshot.members.map(statusKey).join("|")
		);
	}

	private participants(excludeSocketId?: string): RoomParticipant[] {
		const people = new Map<string, RoomParticipant>();
		for (const connection of this.getConnections<SocketState>()) {
			const state = connection.state;
			if (
				!state?.participant ||
				state.closing ||
				state.socketId === excludeSocketId
			)
				continue;
			people.set(state.participant.id, { ...state.participant });
		}
		return [...people.values()].sort(
			(left, right) =>
				Number(right.isHost) - Number(left.isHost) ||
				left.id.localeCompare(right.id),
		);
	}

	private send(connection: Connection, message: ServerMessage) {
		try {
			connection.send(JSON.stringify(message));
		} catch {
			/* Socket may have closed during a broadcast. */
		}
	}

	private sendError(
		connection: Connection,
		code: string,
		message: string,
		requestId?: string,
	) {
		this.send(connection, {
			type: "error",
			code,
			message,
			...(requestId ? { requestId } : {}),
		});
	}

	private broadcastError(code: string, message: string, requestId?: string) {
		for (const connection of this.getConnections<SocketState>()) {
			if (connection.state?.participant)
				this.sendError(connection, code, message, requestId);
		}
	}

	private sendSnapshot(
		connection: Connection<SocketState>,
		excludeSocketId?: string,
		diagnostic?: { chatTrace: ChatTrace; started: number },
	) {
		if (
			!this.room ||
			!connection.state?.participant ||
			connection.state.closing
		)
			return;
		this.send(connection, {
			type: "snapshot",
			snapshot: {
				...this.room.snapshot,
				...visibleRoomExclusions(this.room.snapshot),
				participants: this.participants(excludeSocketId),
			},
			serverTime: Date.now(),
			...(diagnostic
				? {
						chatTrace: {
							...diagnostic.chatTrace,
							serverSendAt: Date.now(),
							serverTotalMs: performance.now() - diagnostic.started,
						},
					}
				: {}),
			self: {
				id: connection.state.participant.id,
				isHost: connection.state.participant.isHost,
			},
		});
	}

	private publishChat(
		sender: Connection<SocketState>,
		diagnostic?: {
			connection: Connection<SocketState>;
			chatTrace: ChatTrace;
			started: number;
		},
	) {
		if (!this.room) return;
		const message = this.room.snapshot.messages.at(-1);
		if (!message) return;
		for (const connection of this.getConnections<SocketState>()) {
			if (!connection.state?.participant || connection.state.closing) continue;
			const isSender = connection.state.socketId === sender.state?.socketId;
			if (connection.state.chatProtocol !== "delta-v1") {
				this.sendSnapshot(
					connection,
					undefined,
					isSender ? diagnostic : undefined,
				);
				continue;
			}
			this.send(connection, {
				type: isSender ? "chat-ack" : "chat-message",
				roomId: this.room.snapshot.roomId,
				message,
				serverTime: Date.now(),
				...(isSender && diagnostic
					? {
							chatTrace: {
								...diagnostic.chatTrace,
								serverSendAt: Date.now(),
								serverTotalMs: performance.now() - diagnostic.started,
							},
						}
					: {}),
			});
		}
		if (diagnostic) {
			try {
				console.info(
					"[room chat trace]",
					JSON.stringify({
						...diagnostic.chatTrace,
						serverSendAt: Date.now(),
						serverTotalMs: performance.now() - diagnostic.started,
						boundary: "broadcast-enqueued",
					}),
				);
			} catch {
				/* Optional diagnostics must not fail a chat. */
			}
		}
	}

	private publish(excludeSocketId?: string) {
		for (const connection of this.getConnections<SocketState>()) {
			if (connection.state?.socketId !== excludeSocketId)
				this.sendSnapshot(connection, excludeSocketId);
		}
	}

	private async save({ refreshPresence = true } = {}) {
		if (this.room) {
			if (refreshPresence) this.refreshMembers();
			const snapshot = this.room.snapshot;
			const capacityKey = [
				snapshot.listVersion,
				snapshot.revision ?? 0,
				snapshot.drawCount ?? 0,
				snapshot.draw?.id ?? "",
				snapshot.history.length,
				snapshot.messages.length,
				snapshot.messages.at(-1)?.id ?? "",
			].join(":");
			const stored = {
				...this.room,
				snapshot: { ...snapshot, participants: [] },
			};
			if (capacityKey !== this.checkedSnapshotCapacityKey) {
				const frame = JSON.stringify({
					type: "snapshot",
					snapshot: {
						...snapshot,
						...visibleRoomExclusions(snapshot),
						participants: [],
					},
					serverTime: Date.now(),
					self: { id: this.room.hostParticipantId, isHost: true },
				});
				const storageBytes = utf8Encoder.encode(
					JSON.stringify(stored),
				).byteLength;
				const frameBytes = utf8Encoder.encode(frame).byteLength;
				if (
					storageBytes + snapshotFrameReserveBytes >
						lunchRoomLimits.maxServerMessageBytes ||
					frameBytes + snapshotFrameReserveBytes >
						lunchRoomLimits.maxServerMessageBytes
				)
					throw new RoomSnapshotSizeLimitError();
			}
			await this.ctx.storage.put(roomKey, stored);
			this.checkedSnapshotCapacityKey = capacityKey;
		}
	}

	private reject(
		connection: Connection<SocketState>,
		code: string,
		message: string,
		closeCode: number,
	) {
		connection.setState({
			...(connection.state ?? {
				socketId: crypto.randomUUID(),
				connectedAt: Date.now(),
			}),
			closing: true,
		});
		this.sendError(connection, code, message);
		try {
			connection.close(closeCode, code);
		} catch {
			/* Already closed. */
		}
	}

	private async rejectUnavailable(
		connection: Connection<SocketState>,
	): Promise<boolean> {
		if (this.expired) {
			this.reject(connection, "ROOM_EXPIRED", "방이 만료됐습니다.", 4008);
			return true;
		}
		if (await this.expireIfNeeded()) return true;
		if (this.room?.snapshot.status === "closed") {
			this.reject(
				connection,
				"ROOM_CLOSED",
				"방장이 방을 종료했습니다. 새 방을 만들어 주세요.",
				4008,
			);
			return true;
		}
		if (!this.room) {
			this.reject(
				connection,
				this.expired ? "ROOM_EXPIRED" : "ROOM_NOT_FOUND",
				this.expired ? "방이 만료됐습니다." : "방을 찾을 수 없습니다.",
				this.expired ? 4008 : 4004,
			);
			return true;
		}
		return false;
	}

	private async expireIfNeeded(): Promise<boolean> {
		if (
			!this.room ||
			(!this.expired && Date.now() < this.room.snapshot.expiresAt)
		)
			return false;
		this.expired = true;
		if (this.room.snapshot.status !== "closed") {
			this.room.snapshot.status = "closed";
			this.publish();
		}
		for (const connection of this.getConnections<SocketState>())
			this.reject(connection, "ROOM_EXPIRED", "방이 만료됐습니다.", 4008);
		this.scheduledAlarmAt = undefined;
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.deleteAlarm();
		this.room = null;
		return true;
	}

	private async finishOverdueDraw(now = Date.now()) {
		const draw = this.room?.snapshot.draw;
		if (
			!this.room ||
			this.room.snapshot.status !== "drawing" ||
			!draw ||
			now < getSpinDeadline(draw)
		)
			return;
		const before = structuredClone(this.room);
		finishRoomDraw(this.room.snapshot, now);
		delete this.room.driveControl;
		this.appendSystemEvent(
			"draw-finished",
			`추첨 결과: ${draw.candidates[draw.winnerIndex].name}`,
		);
		try {
			await this.save();
		} catch {
			this.room = before;
			return;
		}
		this.publish();
	}

	private async closePendingConnections() {
		for (const connection of this.getConnections<SocketState>()) {
			if (
				!connection.state?.closing &&
				!connection.state?.participant &&
				Date.now() - (connection.state?.connectedAt ?? 0) >= joinTimeoutMs
			)
				this.reject(
					connection,
					"JOIN_TIMEOUT",
					"입장 시간이 초과됐습니다. 다시 접속해 주세요.",
					4008,
				);
		}
	}

	private prepareDrawEntropy(now: number): number | undefined {
		const room = this.room;
		if (
			!room ||
			!["waiting", "fetching", "drawing", "result"].includes(
				room.snapshot.status,
			) ||
			!room.snapshot.candidates.some(({ included }) => included !== false) ||
			!room.snapshot.members?.some(
				(member) =>
					member.id === room.hostParticipantId && member.status !== "offline",
			)
		)
			return;
		const prepared = room.drawEntropy;
		if (
			prepared &&
			prepared.expiresAt > now &&
			prepared.seeds.length > roomEntropyWordsPerDraw
		)
			return prepared.expiresAt;
		if (this.drawEntropyRefreshing) return;
		if (this.drawEntropyRetryAt > now) return this.drawEntropyRetryAt;
		this.drawEntropyRefreshing = true;
		this.ctx.waitUntil(this.refreshDrawEntropy());
	}

	private async refreshDrawEntropy() {
		const batch = await fetchExternalEntropy(roomEntropyBatchSize).catch(
			() => null,
		);
		await this.exclusive(async () => {
			this.drawEntropyRefreshing = false;
			const room = this.room;
			if (
				!room ||
				room.snapshot.status === "closed" ||
				Date.now() >= room.snapshot.expiresAt
			)
				return;
			this.drawEntropyRetryAt = Date.now() + roomEntropyTtlMs;
			if (batch) {
				const previous = room.drawEntropy;
				room.drawEntropy = {
					...batch,
					seeds: [...batch.seeds],
					expiresAt: this.drawEntropyRetryAt,
				};
				try {
					await this.save({ refreshPresence: false });
					this.drawEntropyRetryAt = 0;
				} catch {
					room.drawEntropy = previous;
				}
			}
			await this.scheduleAlarm();
		});
	}

	private async scheduleAlarm() {
		if (!this.room) return;
		const refreshAt = this.prepareDrawEntropy(Date.now());
		let next = this.room.snapshot.expiresAt;
		if (refreshAt !== undefined) next = Math.min(next, refreshAt);
		const draw = this.room.snapshot.draw;
		if (this.room.snapshot.status === "drawing" && draw) {
			next = Math.min(next, getSpinDeadline(draw));
			if (draw.drive?.held && this.orphanedDrive())
				next = Math.min(next, Date.now() + 1000);
		}
		for (const member of this.room.snapshot.members ?? []) {
			const awayAt = member.lastActiveAt + lunchRoomLimits.awayAfterMs;
			if (member.status === "online" && awayAt > Date.now())
				next = Math.min(next, awayAt);
		}
		for (const connection of this.getConnections<SocketState>()) {
			if (!connection.state?.closing && !connection.state?.participant)
				next = Math.min(
					next,
					(connection.state?.connectedAt ?? Date.now()) + joinTimeoutMs,
				);
		}
		const alarmAt = Math.max(Date.now() + 1, next);
		if (this.scheduledAlarmAt === alarmAt) return;
		try {
			await this.ctx.storage.setAlarm(alarmAt);
			// Only successful writes may suppress an unchanged deadline.
			this.scheduledAlarmAt = alarmAt;
		} catch {
			this.scheduledAlarmAt = undefined;
			// A failed alarm must not hide an already committed command or stall entropy.
			// Retry soon (never later than the intended alarm); commands still enforce TTL.
			this.ctx.waitUntil(
				this.ctx.storage
					.setAlarm(Math.max(Date.now() + 1, Math.min(next, Date.now() + 1000)))
					.catch(() => {}),
			);
		}
	}

	async onAlarm() {
		await this.exclusive(async () => {
			// The delivered alarm has been consumed, even if its next deadline
			// is unchanged. Retries and restarts must always be able to re-arm it.
			this.scheduledAlarmAt = undefined;
			await this.load();
			if (!this.room) {
				await this.ctx.storage.deleteAlarm();
				return;
			}
			if (await this.expireIfNeeded()) return;
			await this.coastOrphanedDrive();
			await this.finishOverdueDraw();
			await this.closePendingConnections();
			if (this.refreshMembers()) {
				await this.save();
				this.publish();
			}
			await this.scheduleAlarm();
		});
	}

	async onClose(connection: Connection<SocketState>) {
		await this.exclusive(async () => {
			await this.load();
			const previous = connection.state;
			if (connection.state)
				connection.setState({ ...connection.state, closing: true });
			if (await this.expireIfNeeded()) return;
			await this.coastOrphanedDrive();
			const participant = previous?.participant;
			if (
				this.room &&
				participant &&
				!previous.closing &&
				this.room.presentParticipantIds.includes(participant.id) &&
				!this.participants(previous.socketId).some(
					(entry) => entry.id === participant.id,
				)
			) {
				this.room.presentParticipantIds =
					this.room.presentParticipantIds.filter((id) => id !== participant.id);
				this.appendSystemEvent("left", `${participant.name}님이 나갔습니다.`);
			}
			if (this.room && participant) await this.save();
			this.publish(connection.state?.socketId);
			await this.scheduleAlarm();
		});
	}

	async onError(connection: Connection<SocketState>) {
		try {
			connection.close(1011, "CONNECTION_ERROR");
		} catch {
			/* Already closed. */
		}
		await this.onClose(connection);
	}
}
