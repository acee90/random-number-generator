import type { RandomSource } from "@/services/randomCore";
import {
	getWheelRotation,
	type LunchPlace,
	lunchSpinDurationMs,
	sampleLunchPlaces,
} from "./lunch";

export const lunchRoomLimits = {
	ttlMs: 24 * 60 * 60 * 1000,
	drawDurationMs: lunchSpinDurationMs,
	maxTitleLength: 60,
	maxNicknameLength: 12,
	maxParticipants: 30,
	maxMembers: 60,
	awayAfterMs: 5 * 60 * 1000,
	maxMessages: 100,
	maxHistory: 20,
	maxCategoryLength: 24,
	maxMessageBytes: 4096,
	maxEditMessageBytes: 256 * 1024,
	maxServerMessageBytes: 8 * 1024 * 1024,
} as const;

export interface RoomParticipant {
	id: string;
	name: string;
	isHost: boolean;
}

export interface RoomMember extends RoomParticipant {
	status: "online" | "away" | "offline";
	lastActiveAt: number;
	lastSeenAt: number;
}

export type RoomSystemEvent =
	| "joined"
	| "left"
	| "renamed"
	| "draw-started"
	| "draw-finished"
	| "draw-failed";

export interface ChatMessage {
	id: string;
	participantId: string;
	name: string;
	text: string;
	timestamp: number;
	event?: RoomSystemEvent;
}

export interface RoomDrawVote {
	participantId: string;
	name: string;
	vote: "up" | "down";
	timestamp: number;
	reactionMs: number;
}

export interface RoomCandidate extends LunchPlace {
	included?: boolean;
	ownerId?: string;
	ownerName?: string;
}

export interface RoomGameFilter {
	categories: string[] | null;
	excludedIds: string[];
}

export interface RoomExclusionRecord {
	candidateId: string;
	drawId: string;
	drawnAt: number;
	roundNumber?: number;
	/** False only when numbering was reconstructed from truncated legacy history. */
	roundNumberIsExact?: boolean;
}

export interface RoomDraw {
	id: string;
	candidates: LunchPlace[];
	winnerIndex: number;
	source: RandomSource;
	timestamp: number;
	startedAt: number;
	durationMs: typeof lunchSpinDurationMs | 7200;
	fromRotation: 0;
	toRotation: number;
	/** Position inside the winning slice; old centered draws omit this field. */
	landingFraction?: number;
	listVersion: number;
	participants?: RoomParticipant[];
	requestedAt?: number;
	probabilities?: number[];
	votes?: RoomDrawVote[];
	excludeDrawn?: boolean;
	excludedIdsBefore?: string[];
	gameFilter?: RoomGameFilter;
	roundNumber?: number;
	roundNumberIsExact?: boolean;
}

export interface RoomSnapshot {
	roomId: string;
	title: string;
	createdAt: number;
	expiresAt: number;
	listVersion: number;
	candidates: RoomCandidate[];
	participants: RoomParticipant[];
	members?: RoomMember[];
	messages: ChatMessage[];
	draw: RoomDraw | null;
	history: RoomDraw[];
	status:
		| "waiting"
		| "editing"
		| "collecting"
		| "reviewing"
		| "fetching"
		| "drawing"
		| "result"
		| "closed";
	/** Optional only for snapshots written before the lifecycle migration. */
	revision?: number;
	intakeId?: string | null;
	excludeDrawn?: boolean;
	excludedIds?: string[];
	gameFilter?: RoomGameFilter;
	exclusionRecords?: RoomExclusionRecord[];
	/** Counts successful draws; resetting the exclusion ledger does not reset it. */
	drawCount?: number;
	drawCountIsExact?: boolean;
}

export function getRoomPhase(snapshot: RoomSnapshot): RoomSnapshot["status"] {
	return snapshot.status === "waiting" && snapshot.draw
		? "result"
		: snapshot.status;
}

export function getEligibleRoomCandidates(
	snapshot: Pick<
		RoomSnapshot,
		"candidates" | "excludeDrawn" | "excludedIds" | "gameFilter"
	>,
): RoomCandidate[] {
	const excluded = new Set(
		snapshot.excludeDrawn ? (snapshot.excludedIds ?? []) : [],
	);
	return snapshot.candidates.filter(
		(candidate) =>
			candidate.included !== false &&
			(snapshot.gameFilter
				? !snapshot.gameFilter.excludedIds.includes(candidate.id) &&
					(snapshot.gameFilter.categories === null ||
						snapshot.gameFilter.categories.includes(candidate.category))
				: true) &&
			!excluded.has(candidate.id),
	);
}

export function isRoomDrawVoter(
	draw: RoomDraw,
	participantId?: string,
): boolean {
	return Boolean(
		participantId &&
			draw.participants?.some(
				(participant) => participant.id === participantId,
			),
	);
}

export interface CreateRoomInput {
	title: string;
	hostName: string;
	candidateIds: string[];
	candidates?: RoomCandidate[];
	gameFilter?: RoomGameFilter;
	startInWaiting?: true;
}

export type ClientMessage =
	| {
			type: "join";
			name: string;
			hostToken?: string;
			guestToken?: string;
			updateName?: boolean;
			chatProtocol?: "delta-v1";
			voteProtocol?: "delta-v1";
	  }
	| { type: "activity" }
	| { type: "room-close"; id: string }
	| { type: "chat"; id: string; text: string; diagnosticId?: string }
	| {
			type: "start";
			id: string;
			expectedRevision?: number;
			confirmReset?: boolean;
	  }
	| { type: "next"; id: string; drawId: string; editCandidates?: boolean }
	| { type: "vote"; id: string; drawId: string; vote: "up" | "down" }
	| { type: "candidates"; ids: string[] }
	| {
			type: "intake";
			id: string;
			action: "edit" | "open" | "close" | "finalize";
			expectedRevision: number;
	  }
	| {
			type: "recommend";
			id: string;
			name: string;
			category?: string;
			intakeId: string;
	  }
	| {
			type: "remove-candidate";
			id: string;
			candidateId: string;
			intakeId: string;
	  }
	| {
			type: "room-edit";
			id: string;
			baseListVersion: number;
			title?: string;
			candidates?: RoomCandidate[];
	  }
	| {
			type: "options";
			id: string;
			expectedRevision: number;
			excludeDrawn: boolean;
	  }
	| { type: "reset-exclusions"; id: string; expectedRevision: number }
	| {
			type: "game-filter";
			id: string;
			expectedRevision: number;
			filter: RoomGameFilter;
	  }
	| { type: "ping"; clientTime: number };

/** Opt-in telemetry only; never part of the persisted room snapshot. */
export interface ChatTrace {
	diagnosticId: string;
	serverReceivedAt: number;
	serverSendAt: number;
	queueMs: number;
	prepareMs: number;
	saveMs: number;
	alarmMs: number;
	syncMs?: number;
	serverTotalMs: number;
}

export function isChatDiagnosticId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
			value,
		)
	);
}

function parseChatTrace(value: unknown): ChatTrace | undefined {
	if (
		!isRecord(value) ||
		!isChatDiagnosticId(value.diagnosticId) ||
		!isTime(value.serverReceivedAt) ||
		!isTime(value.serverSendAt)
	)
		return;
	const keys = [
		"queueMs",
		"prepareMs",
		"saveMs",
		"alarmMs",
		"serverTotalMs",
	] as const;
	if (
		keys.some(
			(key) =>
				typeof value[key] !== "number" ||
				!Number.isFinite(value[key]) ||
				value[key] < 0 ||
				value[key] > 86400000,
		)
	)
		return;
	if (
		value.syncMs !== undefined &&
		(typeof value.syncMs !== "number" ||
			!Number.isFinite(value.syncMs) ||
			value.syncMs < 0 ||
			value.syncMs > 86400000)
	)
		return;
	return Object.fromEntries(
		[
			...(value.syncMs === undefined ? [] : ["syncMs"]),
			"diagnosticId",
			"serverReceivedAt",
			"serverSendAt",
			...keys,
		].map((key) => [key, value[key]]),
	) as unknown as ChatTrace;
}

export type ServerMessage =
	| {
			type: "chat-ack" | "chat-message";
			roomId: string;
			message: ChatMessage;
			serverTime: number;
			chatTrace?: ChatTrace;
	  }
	| {
			type: "vote-recorded";
			roomId: string;
			drawId: string;
			voteCount: number;
			vote: RoomDrawVote;
	  }
	| { type: "ack"; requestId: string }
	| {
			type: "snapshot";
			snapshot: RoomSnapshot;
			serverTime: number;
			chatTrace?: ChatTrace;
			self?: { id: string; isHost: boolean };
	  }
	| { type: "error"; code: string; message: string; requestId?: string }
	| { type: "pong"; clientTime: number; serverTime: number };

const sources: readonly RandomSource[] = [
	"quantum",
	"atmospheric",
	"csprng",
	"mixed",
];
const systemEvents: readonly RoomSystemEvent[] = [
	"joined",
	"left",
	"renamed",
	"draw-started",
	"draw-finished",
	"draw-failed",
];
const placeIds = new Set(sampleLunchPlaces.map((place) => place.id));
const opaqueIdPattern = /^[A-Za-z0-9_-]{1,80}$/;
const tokenPattern = /^[A-Za-z0-9_-]{16,256}$/;
const roomIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

export function clampLunchRoomNickname(value: string): string {
	return value
		.trim()
		.slice(0, lunchRoomLimits.maxNicknameLength)
		.replace(/[\uD800-\uDBFF]$/, "")
		.trimEnd();
}

export function normalizeLunchRoomNickname(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.normalize("NFKC").trim();
	return normalized.length > 0 &&
		normalized.length <= lunchRoomLimits.maxNicknameLength &&
		!/[\p{Cc}\p{Cf}]/u.test(normalized)
		? normalized
		: null;
}

export function hasInvalidLunchRoomJoinNickname(raw: unknown): boolean {
	const value = parseJson(raw, lunchRoomLimits.maxMessageBytes);
	return (
		isRecord(value) &&
		value.type === "join" &&
		!normalizeLunchRoomNickname(value.name)
	);
}

function isId(value: unknown): value is string {
	return typeof value === "string" && opaqueIdPattern.test(value);
}

export function isLunchRoomId(value: unknown): value is string {
	return typeof value === "string" && roomIdPattern.test(value);
}

function isTime(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		Number.isFinite(new Date(value).getTime())
	);
}

function isVersion(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function parseJson(raw: unknown, maxBytes: number): unknown {
	if (
		typeof raw !== "string" ||
		raw.length > maxBytes ||
		new TextEncoder().encode(raw).byteLength > maxBytes
	)
		return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function candidateIds(value: unknown, minimum = 2): string[] | null {
	if (
		!Array.isArray(value) ||
		value.length < minimum ||
		!Array.from(value).every(
			(id) => typeof id === "string" && placeIds.has(id),
		) ||
		new Set(value).size !== value.length
	)
		return null;
	return [...value];
}

export function resolveCandidateIds(
	value: unknown,
	minimum = 2,
): LunchPlace[] | null {
	const ids = candidateIds(value, minimum);
	if (!ids) return null;
	const places: LunchPlace[] = [];
	for (const id of ids) {
		const place = sampleLunchPlaces.find((candidate) => candidate.id === id);
		if (!place) return null;
		places.push({ ...place });
	}
	return places;
}

export function validateCreateRoomInput(
	value: unknown,
): CreateRoomInput | null {
	if (!isRecord(value)) return null;
	const title = text(value.title, lunchRoomLimits.maxTitleLength);
	const hostName = normalizeLunchRoomNickname(value.hostName);
	const ids = candidateIds(
		value.candidateIds === undefined ? [] : value.candidateIds,
		0,
	);
	if (
		!title ||
		!hostName ||
		!ids ||
		(value.startInWaiting !== undefined && value.startInWaiting !== true)
	)
		return null;
	const input: CreateRoomInput = { title, hostName, candidateIds: ids };
	if (value.candidates !== undefined) {
		const candidates = parsePlaces(value.candidates);
		if (
			ids.length ||
			!candidates ||
			candidates.some((candidate) => candidate.ownerId || candidate.ownerName)
		)
			return null;
		input.candidates = candidates;
	}
	if (value.gameFilter !== undefined || value.startInWaiting) {
		const candidates = input.candidates ?? resolveCandidateIds(ids, 0) ?? [];
		if (value.gameFilter !== undefined) {
			const filter = parseRoomGameFilter(value.gameFilter);
			const validIds = new Set(candidates.map(({ id }) => id));
			if (!filter || filter.excludedIds.some((id) => !validIds.has(id)))
				return null;
			input.gameFilter = filter;
		}
		if (
			value.startInWaiting &&
			!getEligibleRoomCandidates({ candidates, gameFilter: input.gameFilter })
				.length
		)
			return null;
	}
	if (value.startInWaiting) {
		input.startInWaiting = true;
	}
	return input;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
	const value = parseJson(raw, lunchRoomLimits.maxEditMessageBytes);
	if (!isRecord(value)) return null;
	if (
		value.type !== "room-edit" &&
		value.type !== "game-filter" &&
		typeof raw === "string" &&
		new TextEncoder().encode(raw).byteLength > lunchRoomLimits.maxMessageBytes
	)
		return null;
	switch (value.type) {
		case "join": {
			const name = normalizeLunchRoomNickname(value.name);
			if (
				!name ||
				(value.updateName !== undefined &&
					typeof value.updateName !== "boolean") ||
				(value.hostToken !== undefined &&
					(typeof value.hostToken !== "string" ||
						!tokenPattern.test(value.hostToken))) ||
				(value.guestToken !== undefined &&
					(typeof value.guestToken !== "string" ||
						!tokenPattern.test(value.guestToken)))
			)
				return null;
			return {
				type: "join",
				name,
				...(value.chatProtocol === "delta-v1"
					? { chatProtocol: "delta-v1" as const }
					: {}),
				...(value.voteProtocol === "delta-v1"
					? { voteProtocol: "delta-v1" as const }
					: {}),
				...(value.updateName === undefined
					? {}
					: { updateName: value.updateName as boolean }),
				...(value.hostToken === undefined
					? {}
					: { hostToken: value.hostToken as string }),
				...(value.guestToken === undefined
					? {}
					: { guestToken: value.guestToken as string }),
			};
		}
		case "activity":
			return { type: "activity" };
		case "chat": {
			const content = text(value.text, 500);
			return isId(value.id) && content
				? {
						type: "chat",
						id: value.id,
						text: content,
						...(isChatDiagnosticId(value.diagnosticId)
							? { diagnosticId: value.diagnosticId }
							: {}),
					}
				: null;
		}
		case "start":
			return isId(value.id) &&
				(value.expectedRevision === undefined ||
					isVersion(value.expectedRevision)) &&
				(value.confirmReset === undefined ||
					typeof value.confirmReset === "boolean")
				? {
						type: "start",
						id: value.id,
						...(value.expectedRevision === undefined
							? {}
							: { expectedRevision: value.expectedRevision as number }),
						...(value.confirmReset === undefined
							? {}
							: { confirmReset: value.confirmReset as boolean }),
					}
				: null;
		case "next":
			return isId(value.id) &&
				isId(value.drawId) &&
				(value.editCandidates === undefined ||
					typeof value.editCandidates === "boolean")
				? {
						type: "next",
						id: value.id,
						drawId: value.drawId,
						...(value.editCandidates ? { editCandidates: true } : {}),
					}
				: null;
		case "vote":
			return isId(value.id) &&
				isId(value.drawId) &&
				(value.vote === "up" || value.vote === "down")
				? { type: "vote", id: value.id, drawId: value.drawId, vote: value.vote }
				: null;
		case "candidates": {
			const ids = candidateIds(value.ids);
			return ids ? { type: "candidates", ids } : null;
		}
		case "intake":
			return isId(value.id) &&
				isVersion(value.expectedRevision) &&
				["edit", "open", "close", "finalize"].includes(value.action as string)
				? {
						type: "intake",
						id: value.id,
						action: value.action as "edit" | "open" | "close" | "finalize",
						expectedRevision: value.expectedRevision as number,
					}
				: null;
		case "recommend": {
			const name = text(value.name, 80);
			const category =
				value.category === undefined
					? undefined
					: normalizeRoomCategory(value.category);
			return isId(value.id) &&
				isId(value.intakeId) &&
				name &&
				!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) &&
				category !== null
				? {
						type: "recommend",
						id: value.id,
						name,
						intakeId: value.intakeId,
						...(category === undefined ? {} : { category }),
					}
				: null;
		}
		case "remove-candidate":
			return isId(value.id) && isId(value.intakeId) && isId(value.candidateId)
				? {
						type: "remove-candidate",
						id: value.id,
						candidateId: value.candidateId,
						intakeId: value.intakeId,
					}
				: null;
		case "room-close":
			return isId(value.id) ? { type: "room-close", id: value.id } : null;
		case "room-edit": {
			const title =
				value.title === undefined ? undefined : text(value.title, 60);
			const candidates =
				value.candidates === undefined
					? undefined
					: parsePlaces(value.candidates);
			return isId(value.id) &&
				isVersion(value.baseListVersion) &&
				title !== null &&
				candidates !== null &&
				(title !== undefined || candidates !== undefined)
				? {
						type: "room-edit",
						id: value.id,
						baseListVersion: value.baseListVersion as number,
						...(title === undefined ? {} : { title }),
						...(candidates === undefined ? {} : { candidates }),
					}
				: null;
		}
		case "options":
			return isId(value.id) &&
				isVersion(value.expectedRevision) &&
				typeof value.excludeDrawn === "boolean"
				? {
						type: "options",
						id: value.id,
						expectedRevision: value.expectedRevision as number,
						excludeDrawn: value.excludeDrawn,
					}
				: null;
		case "game-filter": {
			const filter = parseRoomGameFilter(value.filter);
			return isId(value.id) && isVersion(value.expectedRevision) && filter
				? {
						type: "game-filter",
						id: value.id,
						expectedRevision: value.expectedRevision,
						filter,
					}
				: null;
		}
		case "reset-exclusions":
			return isId(value.id) && isVersion(value.expectedRevision)
				? {
						type: "reset-exclusions",
						id: value.id,
						expectedRevision: value.expectedRevision as number,
					}
				: null;
		case "ping":
			return isTime(value.clientTime)
				? { type: "ping", clientTime: value.clientTime }
				: null;
		default:
			return null;
	}
}

export function normalizeRoomCategory(value: unknown): string | null {
	if (typeof value !== "string" || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value))
		return null;
	const category = value.normalize("NFC").trim();
	return category.length <= lunchRoomLimits.maxCategoryLength
		? category || "미분류"
		: null;
}

export function parseRoomGameFilter(value: unknown): RoomGameFilter | null {
	if (!isRecord(value)) return null;
	const excludedIds = parseCandidateIdList(value.excludedIds);
	if (!excludedIds) return null;
	if (value.categories === null) return { categories: null, excludedIds };
	if (!Array.isArray(value.categories)) return null;
	const categories = Array.from(value.categories, normalizeRoomCategory);
	if (
		categories.some((category) => category === null) ||
		new Set(categories).size !== categories.length
	)
		return null;
	return { categories: categories as string[], excludedIds };
}

function parsePlaces(value: unknown, minimum = 0): RoomCandidate[] | null {
	if (!Array.isArray(value) || value.length < minimum) return null;
	const places: RoomCandidate[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || typeof item.id !== "string") return null;
		const name = text(item.name, 80);
		const category = normalizeRoomCategory(
			item.category === undefined ? "" : item.category,
		);
		const menu = item.menu === undefined ? undefined : text(item.menu, 200);
		if (
			!isId(item.id) ||
			seen.has(item.id) ||
			!name ||
			/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name) ||
			menu === null ||
			(menu !== undefined && /[\p{Cc}\p{Cf}\p{Cs}]/u.test(menu)) ||
			(item.included !== undefined && typeof item.included !== "boolean") ||
			(item.ownerId !== undefined && !isId(item.ownerId)) ||
			(item.ownerName !== undefined &&
				!normalizeLunchRoomNickname(item.ownerName)) ||
			category === null ||
			(item.distanceMeters !== undefined &&
				(typeof item.distanceMeters !== "number" ||
					!Number.isSafeInteger(item.distanceMeters) ||
					item.distanceMeters < 0))
		)
			return null;
		seen.add(item.id);
		places.push({
			id: item.id,
			name,
			category,
			...(item.included === undefined
				? {}
				: { included: item.included as boolean }),
			...(item.ownerId === undefined
				? {}
				: { ownerId: item.ownerId as string }),
			...(item.ownerName === undefined
				? {}
				: { ownerName: normalizeLunchRoomNickname(item.ownerName) as string }),
			...(menu === undefined ? {} : { menu }),
			...(item.distanceMeters === undefined
				? {}
				: { distanceMeters: item.distanceMeters as number }),
		});
	}
	return places;
}

function parseDraw(value: unknown): RoomDraw | null {
	if (
		!isRecord(value) ||
		!isId(value.id) ||
		!isTime(value.timestamp) ||
		!isTime(value.startedAt) ||
		value.startedAt < value.timestamp ||
		(value.requestedAt !== undefined &&
			(!isTime(value.requestedAt) || value.requestedAt > value.timestamp)) ||
		(value.roundNumber !== undefined && !isVersion(value.roundNumber)) ||
		(value.roundNumberIsExact !== undefined &&
			(typeof value.roundNumberIsExact !== "boolean" ||
				value.roundNumber === undefined)) ||
		!isVersion(value.listVersion) ||
		(value.durationMs !== lunchRoomLimits.drawDurationMs &&
			value.durationMs !== 7200) ||
		value.fromRotation !== 0 ||
		typeof value.toRotation !== "number" ||
		!Number.isFinite(value.toRotation) ||
		(value.landingFraction !== undefined &&
			(typeof value.landingFraction !== "number" ||
				!Number.isFinite(value.landingFraction) ||
				value.landingFraction < 0.1 ||
				value.landingFraction > 0.9)) ||
		!sources.some((source) => source === value.source)
	)
		return null;
	const candidates = parsePlaces(value.candidates);
	if (
		!candidates ||
		typeof value.winnerIndex !== "number" ||
		!Number.isSafeInteger(value.winnerIndex) ||
		value.winnerIndex < 0 ||
		value.winnerIndex >= candidates.length
	)
		return null;
	const toRotation = getWheelRotation(
		0,
		value.winnerIndex,
		candidates.length,
		value.landingFraction as number | undefined,
	);
	if (Math.abs(value.toRotation - toRotation) > 1e-7) return null;
	const participants =
		value.participants === undefined
			? undefined
			: parseParticipants(value.participants);
	const probabilities =
		value.probabilities === undefined
			? undefined
			: parseProbabilities(value.probabilities, candidates.length);
	const votes =
		value.votes === undefined
			? undefined
			: parseDrawVotes(value.votes, value.startedAt + value.durationMs);
	if (participants === null || probabilities === null || votes === null)
		return null;
	const excludedIdsBefore =
		value.excludedIdsBefore === undefined
			? undefined
			: parseCandidateIdList(value.excludedIdsBefore);
	const gameFilter =
		value.gameFilter === undefined
			? undefined
			: parseRoomGameFilter(value.gameFilter);
	if (
		(value.excludeDrawn !== undefined &&
			typeof value.excludeDrawn !== "boolean") ||
		excludedIdsBefore === null ||
		gameFilter === null
	)
		return null;
	return {
		id: value.id,
		candidates,
		winnerIndex: value.winnerIndex,
		source: value.source as RandomSource,
		timestamp: value.timestamp,
		startedAt: value.startedAt,
		durationMs: value.durationMs as RoomDraw["durationMs"],
		fromRotation: 0,
		toRotation,
		...(value.landingFraction === undefined
			? {}
			: { landingFraction: value.landingFraction as number }),
		listVersion: value.listVersion,
		...(participants === undefined ? {} : { participants }),
		...(value.requestedAt === undefined
			? {}
			: { requestedAt: value.requestedAt as number }),
		...(probabilities === undefined ? {} : { probabilities }),
		...(votes === undefined ? {} : { votes }),
		...(value.excludeDrawn === undefined
			? {}
			: { excludeDrawn: value.excludeDrawn as boolean }),
		...(excludedIdsBefore === undefined ? {} : { excludedIdsBefore }),
		...(gameFilter === undefined ? {} : { gameFilter }),
		...(value.roundNumber === undefined
			? {}
			: { roundNumber: value.roundNumber as number }),
		...(value.roundNumberIsExact === undefined
			? {}
			: { roundNumberIsExact: value.roundNumberIsExact as boolean }),
	};
}

function parseExclusionRecords(value: unknown): RoomExclusionRecord[] | null {
	if (!Array.isArray(value)) return null;
	const records: RoomExclusionRecord[] = [];
	const candidates = new Set<string>();
	const draws = new Set<string>();
	for (const entry of value) {
		if (
			!isRecord(entry) ||
			!isId(entry.candidateId) ||
			!isId(entry.drawId) ||
			!isTime(entry.drawnAt) ||
			candidates.has(entry.candidateId) ||
			draws.has(entry.drawId) ||
			(entry.roundNumber !== undefined && !isVersion(entry.roundNumber)) ||
			(entry.roundNumberIsExact !== undefined &&
				(typeof entry.roundNumberIsExact !== "boolean" ||
					entry.roundNumber === undefined))
		)
			return null;
		candidates.add(entry.candidateId);
		draws.add(entry.drawId);
		records.push({
			candidateId: entry.candidateId,
			drawId: entry.drawId,
			drawnAt: entry.drawnAt,
			...(entry.roundNumber === undefined
				? {}
				: { roundNumber: entry.roundNumber as number }),
			...(entry.roundNumberIsExact === undefined
				? {}
				: { roundNumberIsExact: entry.roundNumberIsExact as boolean }),
		});
	}
	return records;
}

function parseCandidateIdList(value: unknown): string[] | null {
	return Array.isArray(value) &&
		Array.from(value).every(isId) &&
		new Set(value).size === value.length
		? [...value]
		: null;
}

function parseDrawVote(value: unknown): RoomDrawVote | null {
	if (
		!isRecord(value) ||
		!isId(value.participantId) ||
		(value.vote !== "up" && value.vote !== "down") ||
		!isTime(value.timestamp) ||
		typeof value.reactionMs !== "number" ||
		!Number.isSafeInteger(value.reactionMs) ||
		value.reactionMs < 0
	)
		return null;
	const name = normalizeLunchRoomNickname(value.name);
	if (!name) return null;
	return {
		participantId: value.participantId,
		name,
		vote: value.vote,
		timestamp: value.timestamp,
		reactionMs: value.reactionMs,
	};
}

function parseDrawVotes(
	value: unknown,
	endedAt: number,
): RoomDrawVote[] | null {
	if (
		!Array.isArray(value) ||
		value.length > lunchRoomLimits.maxMembers ||
		!isTime(endedAt)
	)
		return null;
	const votes: RoomDrawVote[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const vote = parseDrawVote(item);
		if (
			!vote ||
			seen.has(vote.participantId) ||
			vote.reactionMs !== vote.timestamp - endedAt
		)
			return null;
		seen.add(vote.participantId);
		votes.push(vote);
	}
	return votes;
}

function parseProbabilities(value: unknown, count: number): number[] | null {
	if (!Array.isArray(value) || value.length !== count) return null;
	const probabilities: number[] = [];
	let total = 0;
	for (const probability of value) {
		if (
			typeof probability !== "number" ||
			!Number.isFinite(probability) ||
			probability < 0 ||
			probability > 1 ||
			Math.abs(probability - 1 / count) > 1e-9
		)
			return null;
		total += probability;
		probabilities.push(probability);
	}
	return Math.abs(total - 1) <= 1e-9 ? probabilities : null;
}

function parseParticipant(value: unknown): RoomParticipant | null {
	if (!isRecord(value) || !isId(value.id) || typeof value.isHost !== "boolean")
		return null;
	const name = text(value.name, 20);
	return name ? { id: value.id, name, isHost: value.isHost } : null;
}

function parseParticipants(value: unknown): RoomParticipant[] | null {
	const participants = parseList(
		value,
		lunchRoomLimits.maxParticipants,
		parseParticipant,
	);
	return participants &&
		participants.filter((participant) => participant.isHost).length <= 1
		? participants
		: null;
}

function parseMembers(value: unknown): RoomMember[] | null {
	const members = parseList(value, lunchRoomLimits.maxMembers, (item) => {
		const participant = parseParticipant(item);
		if (
			!participant ||
			!isRecord(item) ||
			!["online", "away", "offline"].includes(item.status as string) ||
			!isTime(item.lastActiveAt) ||
			!isTime(item.lastSeenAt)
		)
			return null;
		return {
			...participant,
			status: item.status as RoomMember["status"],
			lastActiveAt: item.lastActiveAt,
			lastSeenAt: item.lastSeenAt,
		};
	});
	return members && members.filter((member) => member.isHost).length <= 1
		? members
		: null;
}

function parseChatMessage(value: unknown): ChatMessage | null {
	if (
		!isRecord(value) ||
		!isId(value.id) ||
		!isId(value.participantId) ||
		!isTime(value.timestamp) ||
		(value.event !== undefined &&
			(!systemEvents.some((event) => event === value.event) ||
				!isLunchRoomId(value.id) ||
				value.name !== "시스템" ||
				value.participantId !== "system"))
	)
		return null;
	const name = text(value.name, 20);
	const content = text(value.text, 500);
	return name && content
		? {
				id: value.id,
				participantId: value.participantId,
				name,
				text: content,
				timestamp: value.timestamp,
				...(value.event === undefined
					? {}
					: { event: value.event as RoomSystemEvent }),
			}
		: null;
}

function parseList<T extends { id: string }>(
	value: unknown,
	max: number,
	parse: (item: unknown) => T | null,
): T[] | null {
	if (!Array.isArray(value) || value.length > max) return null;
	const list: T[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const parsed = parse(item);
		if (!parsed || seen.has(parsed.id)) return null;
		seen.add(parsed.id);
		list.push(parsed);
	}
	return list;
}

/** Validate completed draw archives independently of a live room's list version. */
export function parseRoomDrawHistory(value: unknown): RoomDraw[] | null {
	return parseList(value, lunchRoomLimits.maxHistory, parseDraw);
}

export function parseRoomSnapshot(value: unknown): RoomSnapshot | null {
	if (
		!isRecord(value) ||
		!isLunchRoomId(value.roomId) ||
		!isTime(value.createdAt) ||
		!isTime(value.expiresAt) ||
		value.expiresAt <= value.createdAt ||
		value.expiresAt - value.createdAt > lunchRoomLimits.ttlMs ||
		!isVersion(value.listVersion) ||
		![
			"waiting",
			"editing",
			"collecting",
			"reviewing",
			"fetching",
			"drawing",
			"result",
			"closed",
		].includes(value.status as string)
	)
		return null;
	const title = text(value.title, 60);
	const candidates = parsePlaces(value.candidates);
	const participants = parseParticipants(value.participants);
	const members =
		value.members === undefined ? undefined : parseMembers(value.members);
	const messages = parseList(
		value.messages,
		lunchRoomLimits.maxMessages,
		parseChatMessage,
	);
	const history = parseRoomDrawHistory(value.history);
	const draw = value.draw === null ? null : parseDraw(value.draw);
	const excludedIds =
		value.excludedIds === undefined
			? []
			: parseCandidateIdList(value.excludedIds);
	const exclusionRecords =
		value.exclusionRecords === undefined
			? undefined
			: parseExclusionRecords(value.exclusionRecords);
	const gameFilter =
		value.gameFilter === undefined
			? undefined
			: parseRoomGameFilter(value.gameFilter);
	if (
		!title ||
		!candidates ||
		!participants ||
		members === null ||
		!messages ||
		!history ||
		!excludedIds ||
		exclusionRecords === null ||
		exclusionRecords?.some(
			(entry) =>
				!excludedIds?.includes(entry.candidateId) ||
				!candidates.some((candidate) => candidate.id === entry.candidateId),
		) ||
		(value.drawCount !== undefined &&
			(typeof value.drawCount !== "number" ||
				!Number.isSafeInteger(value.drawCount) ||
				value.drawCount < 0 ||
				value.drawCount <
					new Set([
						...history.map((entry) => entry.id),
						...(draw ? [draw.id] : []),
					]).size ||
				[...history, ...(draw ? [draw] : []), ...(exclusionRecords ?? [])].some(
					(entry) => (entry.roundNumber ?? 0) > (value.drawCount as number),
				))) ||
		(value.drawCountIsExact !== undefined &&
			(typeof value.drawCountIsExact !== "boolean" ||
				value.drawCount === undefined)) ||
		gameFilter === null ||
		(gameFilter &&
			candidates &&
			gameFilter.excludedIds.some(
				(id) => !candidates.some((candidate) => candidate.id === id),
			)) ||
		(value.revision !== undefined && !isVersion(value.revision)) ||
		(value.excludeDrawn !== undefined &&
			typeof value.excludeDrawn !== "boolean") ||
		(value.intakeId !== undefined &&
			value.intakeId !== null &&
			!isId(value.intakeId)) ||
		(value.draw !== null && !draw) ||
		(["drawing", "result"].includes(value.status as string) && !draw) ||
		(["editing", "collecting", "reviewing", "fetching"].includes(
			value.status as string,
		) &&
			draw !== null) ||
		(["collecting", "reviewing"].includes(value.status as string) &&
			!isId(value.intakeId)) ||
		(value.status === "editing" &&
			value.intakeId !== undefined &&
			value.intakeId !== null) ||
		(draw !== null && draw.listVersion > value.listVersion) ||
		history.some((entry) => entry.listVersion > (value.listVersion as number))
	)
		return null;
	return {
		roomId: value.roomId,
		title,
		createdAt: value.createdAt,
		expiresAt: value.expiresAt,
		listVersion: value.listVersion,
		candidates,
		participants,
		...(members === undefined ? {} : { members }),
		messages,
		draw,
		history,
		status:
			value.status === "waiting" && draw
				? "result"
				: (value.status as RoomSnapshot["status"]),
		revision:
			value.revision === undefined
				? value.listVersion
				: (value.revision as number),
		intakeId: (value.intakeId as string | null | undefined) ?? null,
		excludeDrawn: (value.excludeDrawn as boolean | undefined) ?? false,
		excludedIds,
		...(exclusionRecords === undefined ? {} : { exclusionRecords }),
		...(value.drawCount === undefined
			? {}
			: { drawCount: value.drawCount as number }),
		...(value.drawCountIsExact === undefined
			? {}
			: { drawCountIsExact: value.drawCountIsExact as boolean }),
		...(gameFilter === undefined ? {} : { gameFilter }),
	};
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
	const value = parseJson(raw, lunchRoomLimits.maxServerMessageBytes);
	if (!isRecord(value)) return null;
	switch (value.type) {
		case "ack":
			return isId(value.requestId)
				? { type: "ack", requestId: value.requestId }
				: null;
		case "chat-ack":
		case "chat-message": {
			const message = parseChatMessage(value.message);
			if (
				!isLunchRoomId(value.roomId) ||
				!isTime(value.serverTime) ||
				!message ||
				message.event
			)
				return null;
			const chatTrace =
				value.type === "chat-ack" ? parseChatTrace(value.chatTrace) : undefined;
			return {
				type: value.type,
				roomId: value.roomId,
				message,
				serverTime: value.serverTime,
				...(chatTrace ? { chatTrace } : {}),
			};
		}
		case "vote-recorded": {
			const vote = parseDrawVote(value.vote);
			if (
				!isLunchRoomId(value.roomId) ||
				!isId(value.drawId) ||
				!isVersion(value.voteCount) ||
				value.voteCount > lunchRoomLimits.maxMembers ||
				!vote
			)
				return null;
			return {
				type: "vote-recorded",
				roomId: value.roomId,
				drawId: value.drawId,
				voteCount: value.voteCount,
				vote,
			};
		}
		case "snapshot": {
			const snapshot = parseRoomSnapshot(value.snapshot);
			const chatTrace = parseChatTrace(value.chatTrace);
			if (!snapshot || !isTime(value.serverTime)) return null;
			if (
				value.self !== undefined &&
				(!isRecord(value.self) ||
					!isId(value.self.id) ||
					typeof value.self.isHost !== "boolean")
			)
				return null;
			return {
				type: "snapshot",
				snapshot,
				serverTime: value.serverTime,
				...(chatTrace ? { chatTrace } : {}),
				...(value.self === undefined
					? {}
					: {
							self: {
								id: (value.self as Record<string, unknown>).id as string,
								isHost: (value.self as Record<string, unknown>)
									.isHost as boolean,
							},
						}),
			};
		}
		case "error": {
			const code = text(value.code, 80);
			const message = text(value.message, 300);
			if (
				!code ||
				!message ||
				(value.requestId !== undefined && !isId(value.requestId))
			)
				return null;
			return {
				type: "error",
				code,
				message,
				...(value.requestId === undefined
					? {}
					: { requestId: value.requestId as string }),
			};
		}
		case "pong":
			return isTime(value.clientTime) && isTime(value.serverTime)
				? {
						type: "pong",
						clientTime: value.clientTime,
						serverTime: value.serverTime,
					}
				: null;
		default:
			return null;
	}
}
