import { type Connection, Server, type WSMessage } from "partyserver";
import { getWheelRotation } from "@/lib/lunch";
import {
	type ClientMessage,
	clampLunchRoomNickname,
	hasInvalidLunchRoomJoinNickname,
	isLunchRoomId,
	isRoomDrawVoter,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	parseClientMessage,
	parseRoomSnapshot,
	type RoomDraw,
	type RoomMember,
	type RoomParticipant,
	type RoomSnapshot,
	type RoomSystemEvent,
	resolveCandidateIds,
	type ServerMessage,
	validateCreateRoomInput,
} from "@/lib/lunchRoom";
import { consumeFromPool } from "@/services/seedPool";

export type RoomEnv = Cloudflare.Env;

interface InitializeRoom {
	roomId: string;
	title: string;
	hostTokenHash: string;
	candidateIds: string[];
	createdAt: number;
}

interface StoredRoom {
	snapshot: RoomSnapshot;
	hostTokenHash: string;
	hostParticipantId: string;
	hostName?: string;
	processedStarts: string[];
	pendingStartId: string | null;
	presentParticipantIds: string[];
	guestTokenIds: Record<string, string>;
}

interface SocketState {
	socketId: string;
	connectedAt: number;
	participant?: RoomParticipant;
	lastChatAt?: number;
	lastActiveAt?: number;
	closing?: boolean;
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

const roomKey = "lunch-room:v1";
const joinTimeoutMs = 10_000;
const chatIntervalMs = 750;
const maxPendingConnections = 30;
const maxProcessedStarts = 100;
const maxGuestTokenMappings =
	lunchRoomLimits.maxMembers * (lunchRoomLimits.maxHistory + 2) +
	lunchRoomLimits.maxParticipants;
const hashPattern = /^[0-9a-f]{64}$/i;
const opaqueIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern = /^[A-Za-z0-9_-]{16,256}$/;

export class LunchRoomServer extends Server<RoomEnv> {
	static options = { hibernate: true };
	private room: StoredRoom | null = null;
	private loaded = false;
	private expired = false;
	private mutationQueue: Promise<void> = Promise.resolve();

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
			await this.load();
			if (!this.room) {
				await this.ctx.storage.deleteAlarm();
				return;
			}
			if (await this.expireIfNeeded()) return;
			if (this.room.snapshot.status === "fetching") {
				// An isolate restart cannot resume an external entropy request.
				this.room.snapshot.status = "waiting";
				this.room.pendingStartId = null;
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
			});
			const candidates = resolveCandidateIds(input.candidateIds);
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
				pendingStartId: null,
				presentParticipantIds: [],
				guestTokenIds: {},
				snapshot: {
					roomId: input.roomId,
					title: validated.title,
					createdAt: input.createdAt,
					expiresAt: input.createdAt + lunchRoomLimits.ttlMs,
					listVersion: 1,
					candidates,
					participants: [],
					members: [],
					messages: [],
					draw: null,
					history: [],
					status: "waiting",
				},
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

	onRequest(): Response {
		return new Response("Not Found", { status: 404 });
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
		const message = parseClientMessage(raw);
		await this.exclusive(async () => {
			await this.load();
			if (connection.state?.closing) return;
			if (await this.rejectUnavailable(connection)) return;
			await this.finishOverdueDraw();
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
					message.type === "vote" || message.type === "next"
						? message.id
						: undefined,
				);
				return;
			}
			switch (message.type) {
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
					await this.chat(connection, message);
					break;
				case "vote":
					await this.vote(connection, message);
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
						await this.beginDraw(connection, message.id);
					else if (message.type === "next")
						await this.nextRound(connection, message);
					else await this.changeCandidates(connection, message.ids);
					break;
			}
		});
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
		await this.save();
		await this.scheduleAlarm();
		this.publish();
	}

	private async changeCandidates(
		connection: Connection<SocketState>,
		ids: string[],
	) {
		if (!this.room) return;
		if (this.room.snapshot.status !== "waiting") {
			this.sendError(
				connection,
				"DRAW_BUSY",
				"추첨이 끝난 뒤 후보를 바꿀 수 있습니다.",
			);
			return;
		}
		const candidates = resolveCandidateIds(ids);
		if (!candidates) return;
		this.recordActivity(connection);
		this.room.snapshot.candidates = candidates;
		this.room.snapshot.listVersion++;
		await this.save();
		await this.scheduleAlarm();
		this.publish();
	}

	private async vote(
		connection: Connection<SocketState>,
		message: Extract<ClientMessage, { type: "vote" }>,
	) {
		const participant = connection.state?.participant;
		if (!this.room || !participant) return;
		if (participant.isHost || participant.id === this.room.hostParticipantId) {
			this.sendError(
				connection,
				"HOST_CANNOT_VOTE",
				"참가자만 추첨 결과에 투표할 수 있습니다.",
				message.id,
			);
			return;
		}
		if (this.room.snapshot.history.some((draw) => draw.id === message.drawId)) {
			this.sendError(
				connection,
				"VOTE_CLOSED",
				"기록으로 보관된 결과에는 투표할 수 없습니다.",
				message.id,
			);
			return;
		}
		const draw = this.room.snapshot.draw;
		if (!draw || draw.id !== message.drawId) {
			this.sendError(
				connection,
				"VOTE_NOT_FOUND",
				"투표할 현재 추첨 결과를 찾을 수 없습니다.",
				message.id,
			);
			return;
		}
		const now = Date.now();
		const endedAt = draw.startedAt + draw.durationMs;
		if (this.room.snapshot.status !== "waiting" || now < endedAt) {
			this.sendError(
				connection,
				"VOTE_NOT_READY",
				"추첨 결과가 나온 뒤 투표해 주세요.",
				message.id,
			);
			return;
		}
		const votes = draw.votes ?? [];
		if (votes.some((vote) => vote.participantId === participant.id)) {
			this.sendError(
				connection,
				"VOTE_ALREADY_CAST",
				"이미 투표했습니다. 투표는 한 번만 할 수 있으며 바꿀 수 없습니다.",
				message.id,
			);
			this.sendSnapshot(connection);
			return;
		}
		if (!isRoomDrawVoter(draw, participant.id)) {
			this.sendError(
				connection,
				"VOTE_NOT_ELIGIBLE",
				"추첨 시작 후 입장해 이번 결과에는 투표할 수 없습니다. 다음 추첨부터 참여해 주세요.",
				message.id,
			);
			return;
		}
		if (votes.length >= lunchRoomLimits.maxMembers) {
			this.sendError(
				connection,
				"VOTE_LIMIT",
				"이 결과의 투표 인원이 가득 찼습니다.",
				message.id,
			);
			return;
		}
		this.room.snapshot.draw = {
			...draw,
			votes: [
				...votes,
				{
					participantId: participant.id,
					name: normalizeLunchRoomNickname(participant.name) ?? "참가자",
					vote: message.vote,
					timestamp: now,
					reactionMs: now - endedAt,
				},
			],
		};
		this.recordActivity(connection);
		await this.save();
		await this.scheduleAlarm();
		this.publish();
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
			return;
		}
		const draw = this.room.snapshot.draw;
		if (
			!draw ||
			draw.id !== message.drawId ||
			this.room.snapshot.status !== "waiting" ||
			Date.now() < draw.startedAt + draw.durationMs
		) {
			this.sendError(
				connection,
				"VOTE_NOT_READY",
				"현재 추첨이 끝난 뒤 투표를 종료해 주세요.",
				message.id,
			);
			return;
		}
		if (!alreadyArchived)
			this.room.snapshot.history = [
				structuredClone(draw),
				...this.room.snapshot.history,
			].slice(0, lunchRoomLimits.maxHistory);
		this.room.snapshot.draw = null;
		this.recordActivity(connection);
		await this.save();
		await this.scheduleAlarm();
		this.publish();
	}

	private async beginDraw(
		connection: Connection<SocketState>,
		requestId: string,
	) {
		if (!this.room) return;
		if (this.room.processedStarts.includes(requestId)) {
			this.sendSnapshot(connection);
			return;
		}
		if (this.room.snapshot.status !== "waiting") {
			this.sendError(
				connection,
				"DRAW_BUSY",
				"진행 중인 추첨이 있습니다.",
				requestId,
			);
			return;
		}
		this.room.processedStarts = [...this.room.processedStarts, requestId].slice(
			-maxProcessedStarts,
		);
		this.recordActivity(connection);
		const previousDraw = this.room.snapshot.draw;
		if (
			previousDraw &&
			Date.now() >= previousDraw.startedAt + previousDraw.durationMs &&
			!this.room.snapshot.history.some((draw) => draw.id === previousDraw.id)
		)
			this.room.snapshot.history = [
				structuredClone(previousDraw),
				...this.room.snapshot.history,
			].slice(0, lunchRoomLimits.maxHistory);
		this.room.snapshot.draw = null;
		this.room.pendingStartId = requestId;
		this.room.snapshot.status = "fetching";
		const candidates = this.room.snapshot.candidates.map((place) => ({
			...place,
		}));
		const listVersion = this.room.snapshot.listVersion;
		const metadata = {
			participants: this.participants(),
			requestedAt: Date.now(),
			probabilities: candidates.map(() => 1 / candidates.length),
		};
		this.appendSystemEvent(
			"draw-started",
			`${connection.state?.participant?.name ?? "방장"}님이 ${candidates.length}곳 중 추첨을 시작했습니다.`,
		);
		await this.save();
		await this.scheduleAlarm();
		this.publish();
		// Release the mutation queue while entropy is fetched, so chat/ping remain responsive.
		this.ctx.waitUntil(
			this.completeDraw(requestId, candidates, listVersion, metadata),
		);
	}

	private async completeDraw(
		requestId: string,
		candidates: RoomSnapshot["candidates"],
		listVersion: number,
		metadata: Pick<RoomDraw, "participants" | "requestedAt" | "probabilities">,
	) {
		try {
			const result = await consumeFromPool(0, candidates.length - 1, 1);
			if (
				!Array.isArray(result.numbers) ||
				result.numbers.length !== 1 ||
				!["quantum", "atmospheric", "csprng", "mixed"].includes(result.source)
			)
				throw new Error("Invalid entropy result");
			const winnerIndex = result.numbers[0];
			const toRotation = getWheelRotation(0, winnerIndex, candidates.length);
			await this.exclusive(async () => {
				if (
					(await this.expireIfNeeded()) ||
					!this.room ||
					this.room.pendingStartId !== requestId ||
					this.room.snapshot.status !== "fetching"
				)
					return;
				const timestamp = Date.now();
				this.room.snapshot.draw = {
					...metadata,
					id: requestId,
					candidates,
					winnerIndex,
					source: result.source,
					timestamp,
					startedAt: timestamp + 1500,
					durationMs: lunchRoomLimits.drawDurationMs,
					fromRotation: 0,
					toRotation,
					listVersion,
					votes: [],
				};
				this.room.pendingStartId = null;
				this.room.snapshot.status = "drawing";
				await this.save();
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
				this.room.snapshot.status = "waiting";
				this.appendSystemEvent(
					"draw-failed",
					"추첨에 실패했습니다. 다시 시작해 주세요.",
				);
				await this.save();
				this.broadcastError(
					"DRAW_FAILED",
					"추첨 결과를 가져오지 못했습니다. 다시 시작해 주세요.",
					requestId,
				);
				this.publish();
			});
		}
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
				participants: this.participants(excludeSocketId),
			},
			serverTime: Date.now(),
			self: {
				id: connection.state.participant.id,
				isHost: connection.state.participant.isHost,
			},
		});
	}

	private publish(excludeSocketId?: string) {
		for (const connection of this.getConnections<SocketState>()) {
			if (connection.state?.socketId !== excludeSocketId)
				this.sendSnapshot(connection, excludeSocketId);
		}
	}

	private async save() {
		if (this.room) {
			this.refreshMembers();
			await this.ctx.storage.put(roomKey, {
				...this.room,
				snapshot: { ...this.room.snapshot, participants: [] },
			});
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
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.deleteAlarm();
		this.room = null;
		return true;
	}

	private async finishOverdueDraw() {
		const draw = this.room?.snapshot.draw;
		if (
			!this.room ||
			this.room.snapshot.status !== "drawing" ||
			!draw ||
			Date.now() < draw.startedAt + draw.durationMs
		)
			return;
		this.room.snapshot.status = "waiting";
		this.appendSystemEvent(
			"draw-finished",
			`추첨 결과: ${draw.candidates[draw.winnerIndex].name}`,
		);
		await this.save();
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

	private async scheduleAlarm() {
		if (!this.room) return;
		let next = this.room.snapshot.expiresAt;
		const draw = this.room.snapshot.draw;
		if (this.room.snapshot.status === "drawing" && draw)
			next = Math.min(next, draw.startedAt + draw.durationMs);
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
		await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
	}

	async onAlarm() {
		await this.exclusive(async () => {
			await this.load();
			if (!this.room) {
				await this.ctx.storage.deleteAlarm();
				return;
			}
			if (await this.expireIfNeeded()) return;
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
