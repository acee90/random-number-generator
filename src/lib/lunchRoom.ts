import type { RandomSource } from "@/services/randomCore";
import {
	getWheelRotation,
	type LunchCategory,
	type LunchPlace,
	lunchCategories,
	sampleLunchPlaces,
} from "./lunch";

export const lunchRoomLimits = {
	ttlMs: 24 * 60 * 60 * 1000,
	drawDurationMs: 7200,
	maxNicknameLength: 12,
	maxParticipants: 30,
	maxMembers: 60,
	awayAfterMs: 5 * 60 * 1000,
	maxMessages: 100,
	maxHistory: 20,
	maxCandidates: sampleLunchPlaces.length,
	maxMessageBytes: 4096,
	maxServerMessageBytes: 2 * 1024 * 1024,
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

export interface RoomDraw {
	id: string;
	candidates: LunchPlace[];
	winnerIndex: number;
	source: RandomSource;
	timestamp: number;
	startedAt: number;
	durationMs: 7200;
	fromRotation: 0;
	toRotation: number;
	listVersion: number;
	participants?: RoomParticipant[];
	requestedAt?: number;
	probabilities?: number[];
	votes?: RoomDrawVote[];
}

export interface RoomSnapshot {
	roomId: string;
	title: string;
	createdAt: number;
	expiresAt: number;
	listVersion: number;
	candidates: LunchPlace[];
	participants: RoomParticipant[];
	members?: RoomMember[];
	messages: ChatMessage[];
	draw: RoomDraw | null;
	history: RoomDraw[];
	status: "waiting" | "fetching" | "drawing" | "closed";
}

export interface CreateRoomInput {
	title: string;
	hostName: string;
	candidateIds: string[];
}

export type ClientMessage =
	| {
			type: "join";
			name: string;
			hostToken?: string;
			guestToken?: string;
			updateName?: boolean;
	  }
	| { type: "activity" }
	| { type: "chat"; id: string; text: string }
	| { type: "start"; id: string }
	| { type: "vote"; id: string; drawId: string; vote: "up" | "down" }
	| { type: "candidates"; ids: string[] }
	| { type: "ping"; clientTime: number };

export type ServerMessage =
	| {
			type: "snapshot";
			snapshot: RoomSnapshot;
			serverTime: number;
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

function candidateIds(value: unknown): string[] | null {
	if (
		!Array.isArray(value) ||
		value.length < 2 ||
		value.length > lunchRoomLimits.maxCandidates ||
		!Array.from(value).every(
			(id) => typeof id === "string" && placeIds.has(id),
		) ||
		new Set(value).size !== value.length
	)
		return null;
	return [...value];
}

export function resolveCandidateIds(value: unknown): LunchPlace[] | null {
	const ids = candidateIds(value);
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
	const title = text(value.title, 60);
	const hostName = normalizeLunchRoomNickname(value.hostName);
	const ids = candidateIds(
		value.candidateIds === undefined
			? sampleLunchPlaces.map((place) => place.id)
			: value.candidateIds,
	);
	return title && hostName && ids
		? { title, hostName, candidateIds: ids }
		: null;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
	const value = parseJson(raw, lunchRoomLimits.maxMessageBytes);
	if (!isRecord(value)) return null;
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
				? { type: "chat", id: value.id, text: content }
				: null;
		}
		case "start":
			return isId(value.id) ? { type: "start", id: value.id } : null;
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
		case "ping":
			return isTime(value.clientTime)
				? { type: "ping", clientTime: value.clientTime }
				: null;
		default:
			return null;
	}
}

function parsePlaces(value: unknown): LunchPlace[] | null {
	if (
		!Array.isArray(value) ||
		value.length < 2 ||
		value.length > lunchRoomLimits.maxCandidates
	)
		return null;
	const places: LunchPlace[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!isRecord(item) || typeof item.id !== "string") return null;
		const name = text(item.name, 200);
		const menu = item.menu === undefined ? undefined : text(item.menu, 200);
		if (
			!placeIds.has(item.id) ||
			seen.has(item.id) ||
			!name ||
			menu === null ||
			!lunchCategories.some((category) => category === item.category) ||
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
			category: item.category as LunchCategory,
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
		!isVersion(value.listVersion) ||
		value.durationMs !== lunchRoomLimits.drawDurationMs ||
		value.fromRotation !== 0 ||
		typeof value.toRotation !== "number" ||
		!Number.isFinite(value.toRotation) ||
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
	const toRotation = getWheelRotation(0, value.winnerIndex, candidates.length);
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
	return {
		id: value.id,
		candidates,
		winnerIndex: value.winnerIndex,
		source: value.source as RandomSource,
		timestamp: value.timestamp,
		startedAt: value.startedAt,
		durationMs: lunchRoomLimits.drawDurationMs,
		fromRotation: 0,
		toRotation,
		listVersion: value.listVersion,
		...(participants === undefined ? {} : { participants }),
		...(value.requestedAt === undefined
			? {}
			: { requestedAt: value.requestedAt as number }),
		...(probabilities === undefined ? {} : { probabilities }),
		...(votes === undefined ? {} : { votes }),
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
		if (
			!isRecord(item) ||
			!isId(item.participantId) ||
			seen.has(item.participantId) ||
			(item.vote !== "up" && item.vote !== "down") ||
			!isTime(item.timestamp) ||
			item.timestamp < endedAt ||
			!Number.isSafeInteger(item.reactionMs) ||
			item.reactionMs !== item.timestamp - endedAt
		)
			return null;
		const name = normalizeLunchRoomNickname(item.name);
		if (!name) return null;
		seen.add(item.participantId);
		votes.push({
			participantId: item.participantId,
			name,
			vote: item.vote,
			timestamp: item.timestamp,
			reactionMs: item.reactionMs as number,
		});
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

export function parseRoomSnapshot(value: unknown): RoomSnapshot | null {
	if (
		!isRecord(value) ||
		!isLunchRoomId(value.roomId) ||
		!isTime(value.createdAt) ||
		!isTime(value.expiresAt) ||
		value.expiresAt <= value.createdAt ||
		value.expiresAt - value.createdAt > lunchRoomLimits.ttlMs ||
		!isVersion(value.listVersion) ||
		!["waiting", "fetching", "drawing", "closed"].includes(
			value.status as string,
		)
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
	const history = parseList(
		value.history,
		lunchRoomLimits.maxHistory,
		parseDraw,
	);
	const draw = value.draw === null ? null : parseDraw(value.draw);
	if (
		!title ||
		!candidates ||
		!participants ||
		members === null ||
		!messages ||
		!history ||
		(value.draw !== null && !draw) ||
		(value.status === "drawing" && !draw) ||
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
		status: value.status as RoomSnapshot["status"],
	};
}

export function parseServerMessage(raw: unknown): ServerMessage | null {
	const value = parseJson(raw, lunchRoomLimits.maxServerMessageBytes);
	if (!isRecord(value)) return null;
	switch (value.type) {
		case "snapshot": {
			const snapshot = parseRoomSnapshot(value.snapshot);
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
