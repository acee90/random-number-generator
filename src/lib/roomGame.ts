import { defaultDrawView, readDrawView } from "./drawView";
import {
	getWheelRotation,
	randomWheelLandingFraction,
	resolveLunchWinner,
} from "./lunch";
import {
	type ClientMessage,
	type CreateRoomInput,
	getEligibleRoomCandidates,
	isRoomDrawVoter,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	type RoomDraw,
	type RoomDrawVote,
	type RoomParticipant,
	type RoomSnapshot,
} from "./lunchRoom";
import {
	clearDisabledRoomExclusions,
	recordRoomDrawMetadata,
	setRoomExcludeDrawn,
} from "./roomDrawMetadata";

export type LifecycleCommand = Extract<
	ClientMessage,
	{
		type:
			| "intake"
			| "recommend"
			| "remove-candidate"
			| "room-edit"
			| "options"
			| "draw-view"
			| "game-filter"
			| "reset-exclusions";
	}
>;

export function createRoomSnapshot(
	roomId: string,
	createdAt: number,
	input: CreateRoomInput,
	candidates: RoomSnapshot["candidates"],
): RoomSnapshot {
	return {
		roomId,
		title: input.title,
		createdAt,
		expiresAt: createdAt + lunchRoomLimits.ttlMs,
		listVersion: 1,
		revision: 1,
		intakeId: null,
		excludeDrawn: false,
		viewMode: defaultDrawView,
		excludedIds: [],
		exclusionRecords: [],
		drawCount: 0,
		drawCountIsExact: true,
		gameFilter: input.gameFilter ?? {
			categories: null,
			excludedIds: [],
		},
		candidates,
		participants: [],
		members: [],
		messages: [],
		draw: null,
		history: [],
		status: input.startInWaiting ? "waiting" : "editing",
	};
}

export function validateRoomCommand(
	snapshot: RoomSnapshot,
	message: LifecycleCommand,
	participant: RoomParticipant,
	host: boolean,
) {
	if (["fetching", "drawing", "closed"].includes(snapshot.status)) {
		return { code: "DRAW_BUSY", message: "추첨이 끝난 뒤 변경할 수 있습니다." };
	}
	if (
		"expectedRevision" in message &&
		message.expectedRevision !== (snapshot.revision ?? snapshot.listVersion)
	) {
		return {
			code: "REVISION_CONFLICT",
			message: "게임 조건이 바뀌었어요. 목록을 확인한 뒤 다시 진행해 주세요.",
		};
	}
	if (
		message.type === "draw-view" &&
		(snapshot.status !== "waiting" || snapshot.draw)
	) {
		return {
			code: "PHASE_CONFLICT",
			message: "추첨 보기는 대기 중에 변경할 수 있습니다.",
		};
	}
	if (message.type === "intake") {
		const allowed =
			message.action === "edit"
				? ["waiting"]
				: message.action === "open"
					? ["waiting", "editing", "reviewing"]
					: message.action === "close"
						? ["collecting"]
						: ["editing", "collecting", "reviewing"];
		if (!allowed.includes(snapshot.status)) {
			return {
				code: "PHASE_CONFLICT",
				message: "게임 단계가 바뀌었습니다. 현재 화면을 확인해 주세요.",
			};
		}
		if (
			message.action === "finalize" &&
			// Drawn exclusions are a waiting-screen game option. Finalizing the
			// selected pool must still allow returning there to recover it.
			getEligibleRoomCandidates({ ...snapshot, excludeDrawn: false }).length ===
				0
		) {
			return {
				code: "NO_CANDIDATES",
				message: "추첨에 포함할 후보가 한 개 이상 필요합니다.",
			};
		}
	}
	if (
		message.type === "room-edit" &&
		message.candidates !== undefined &&
		!["editing", "collecting", "reviewing"].includes(snapshot.status)
	) {
		return {
			code: "PHASE_CONFLICT",
			message:
				"후보는 편집 단계에서 변경할 수 있습니다. 대기 화면에서 후보 편집을 선택해 주세요.",
		};
	}
	if (
		message.type === "game-filter" &&
		!["editing", "collecting", "reviewing"].includes(snapshot.status)
	) {
		return {
			code: "PHASE_CONFLICT",
			message:
				"게임 필터는 후보 편집 단계에서 변경할 수 있습니다. 대기 화면에서 후보 편집을 선택해 주세요.",
		};
	}
	if (
		message.type === "game-filter" &&
		message.filter.excludedIds.some(
			(id) => !snapshot.candidates.some((candidate) => candidate.id === id),
		)
	) {
		return {
			code: "FILTER_CANDIDATES_CHANGED",
			message:
				"후보 목록이 바뀌었습니다. 최신 후보를 확인하고 필터를 다시 적용해 주세요.",
		};
	}
	if (message.type === "recommend" || message.type === "remove-candidate") {
		if (
			snapshot.status !== "collecting" ||
			snapshot.intakeId !== message.intakeId
		) {
			return {
				code: "INTAKE_CLOSED",
				message: "추천 접수가 종료되거나 새로 시작됐습니다. 입력은 보관했어요.",
			};
		}
		if (message.type === "remove-candidate") {
			const candidate = snapshot.candidates.find(
				(item) => item.id === message.candidateId,
			);
			if (!candidate || (!host && candidate.ownerId !== participant.id)) {
				return {
					code: "CANDIDATE_FORBIDDEN",
					message: "접수 중에는 본인이 추천한 후보만 삭제할 수 있습니다.",
				};
			}
		}
	}
	if (
		message.type === "room-edit" &&
		message.candidates &&
		message.baseListVersion !== snapshot.listVersion
	) {
		return {
			code: "LIST_CONFLICT",
			message:
				"다른 사람이 후보를 변경했습니다. 초안을 보관했으니 최신 목록과 비교해 주세요.",
		};
	}

	return null;
}

/** Applies a validated command to a writable snapshot. */
export function applyRoomCommand(
	snapshot: RoomSnapshot,
	message: LifecycleCommand,
	participant: RoomParticipant,
	hostParticipantId: string,
) {
	const priorListVersion = snapshot.listVersion;
	switch (message.type) {
		case "intake":
			snapshot.status =
				message.action === "edit"
					? "editing"
					: message.action === "open"
						? "collecting"
						: message.action === "close"
							? "reviewing"
							: "waiting";
			if (message.action === "open") snapshot.intakeId = crypto.randomUUID();
			if (message.action === "edit" || message.action === "finalize")
				snapshot.intakeId = null;
			break;
		case "recommend":
			snapshot.candidates.push({
				id: crypto.randomUUID(),
				name: message.name,
				category: message.category ?? "미분류",
				included: true,
				ownerId: participant.id,
				ownerName: participant.name,
			});
			snapshot.listVersion++;
			break;
		case "remove-candidate":
			snapshot.candidates = snapshot.candidates.filter(
				(item) => item.id !== message.candidateId,
			);
			snapshot.excludedIds = snapshot.excludedIds?.filter(
				(id) => id !== message.candidateId,
			);
			snapshot.exclusionRecords = snapshot.exclusionRecords?.filter(
				(entry) => entry.candidateId !== message.candidateId,
			);
			if (snapshot.gameFilter)
				snapshot.gameFilter.excludedIds =
					snapshot.gameFilter.excludedIds.filter(
						(id) => id !== message.candidateId,
					);
			snapshot.listVersion++;
			break;
		case "room-edit":
			if (message.title !== undefined) snapshot.title = message.title;
			if (message.candidates) {
				const old = new Map(snapshot.candidates.map((item) => [item.id, item]));
				snapshot.candidates = message.candidates.map((item) => {
					const original = old.get(item.id);
					return {
						...item,
						included: item.included !== false,
						ownerId: original?.ownerId ?? hostParticipantId,
						ownerName: original?.ownerName ?? participant.name,
					};
				});
				const ids = new Set(snapshot.candidates.map((item) => item.id));
				snapshot.excludedIds = snapshot.excludedIds?.filter((id) =>
					ids.has(id),
				);
				snapshot.exclusionRecords = snapshot.exclusionRecords?.filter((entry) =>
					ids.has(entry.candidateId),
				);
				if (snapshot.gameFilter)
					snapshot.gameFilter.excludedIds =
						snapshot.gameFilter.excludedIds.filter((id) => ids.has(id));
				snapshot.listVersion++;
			}
			break;
		case "options":
			setRoomExcludeDrawn(snapshot, message.excludeDrawn);
			break;
		case "draw-view":
			snapshot.viewMode = message.viewMode;
			break;
		case "game-filter":
			snapshot.gameFilter = structuredClone(message.filter);
			snapshot.candidates = snapshot.candidates.map((candidate) =>
				candidate.included === false
					? { ...candidate, included: true }
					: candidate,
			);
			break;
		case "reset-exclusions":
			snapshot.excludedIds = [];
			snapshot.exclusionRecords = [];
			break;
	}
	if (message.type !== "room-edit" || message.candidates)
		snapshot.revision = (snapshot.revision ?? priorListVersion) + 1;
}

/** Freeze the eligible pool, odds and voters before the asynchronous randomness request. */
export function prepareRoomDraw(
	snapshot: RoomSnapshot,
	participants: RoomParticipant[],
) {
	const candidates = structuredClone(getEligibleRoomCandidates(snapshot));
	return {
		candidates,
		listVersion: snapshot.listVersion,
		viewMode: readDrawView(snapshot.viewMode),
		participants: structuredClone(participants),
		requestedAt: Date.now(),
		probabilities: candidates.map(() => 1 / candidates.length),
		excludeDrawn: snapshot.excludeDrawn ?? false,
		excludedIdsBefore: snapshot.excludeDrawn
			? [...(snapshot.excludedIds ?? [])]
			: [],
		...(snapshot.gameFilter && {
			gameFilter: structuredClone(snapshot.gameFilter),
		}),
	};
}

/** The connected room allows time for its clients to receive the same start time. */
export function startRoomSpin(
	snapshot: RoomSnapshot,
	prepared: ReturnType<typeof prepareRoomDraw>,
	result: { numbers: number[]; source: RoomDraw["source"] },
	id: string,
	startDelayMs: number,
) {
	if (
		!Array.isArray(result.numbers) ||
		result.numbers.length !== 1 ||
		!["quantum", "atmospheric", "csprng", "mixed"].includes(result.source)
	) {
		throw new Error("Invalid entropy result");
	}
	const winnerIndex = result.numbers[0];
	resolveLunchWinner(prepared.candidates, winnerIndex);
	const timestamp = Date.now();
	const landingFraction = randomWheelLandingFraction();
	const draw: RoomDraw = {
		...prepared,
		id,
		winnerIndex,
		source: result.source,
		timestamp,
		startedAt: timestamp + startDelayMs,
		durationMs: lunchRoomLimits.drawDurationMs,
		fromRotation: 0,
		toRotation: getWheelRotation(
			0,
			winnerIndex,
			prepared.candidates.length,
			landingFraction,
		),
		landingFraction,
		votes: [],
	};
	recordRoomDrawMetadata(snapshot, draw, prepared.excludeDrawn);
	snapshot.draw = draw;
	snapshot.status = "drawing";
	snapshot.revision = (snapshot.revision ?? snapshot.listVersion) + 1;
}

export function getRoomArchiveDraws({
	draw,
	history,
}: Pick<RoomSnapshot, "draw" | "history">) {
	return [...(draw ? [draw] : []), ...history]
		.filter(
			(entry, index, all) =>
				all.findIndex((other) => other.id === entry.id) === index,
		)
		.slice(0, lunchRoomLimits.maxHistory);
}

export function advanceRoomRound(
	snapshot: RoomSnapshot,
	editCandidates: boolean,
) {
	const draw = snapshot.draw;
	if (draw && !snapshot.history.some((entry) => entry.id === draw.id)) {
		snapshot.history = [structuredClone(draw), ...snapshot.history].slice(
			0,
			lunchRoomLimits.maxHistory,
		);
	}
	clearDisabledRoomExclusions(snapshot);
	snapshot.draw = null;
	snapshot.status = editCandidates ? "editing" : "waiting";
	if (editCandidates) snapshot.intakeId = null;
	snapshot.revision = (snapshot.revision ?? snapshot.listVersion) + 1;
}

export function castRoomVote(
	snapshot: RoomSnapshot,
	participant: RoomParticipant,
	drawId: string,
	choice: RoomDrawVote["vote"],
	now: number,
) {
	if (snapshot.history.some((draw) => draw.id === drawId)) {
		return {
			error: {
				code: "VOTE_CLOSED",
				message: "기록으로 보관된 결과에는 투표할 수 없습니다.",
			},
		};
	}
	const draw = snapshot.draw;
	if (!draw || draw.id !== drawId) {
		return {
			error: {
				code: "VOTE_NOT_FOUND",
				message: "투표할 현재 추첨 결과를 찾을 수 없습니다.",
			},
		};
	}

	const endedAt = draw.startedAt + draw.durationMs;
	if (snapshot.status !== "result" || now < endedAt) {
		return {
			error: {
				code: "VOTE_NOT_READY",
				message: "추첨 결과가 나온 뒤 투표해 주세요.",
			},
		};
	}
	const votes = draw.votes ?? [];
	if (votes.some((vote) => vote.participantId === participant.id)) {
		return {
			error: {
				code: "VOTE_ALREADY_CAST",
				message:
					"이미 투표했습니다. 투표는 한 번만 할 수 있으며 바꿀 수 없습니다.",
			},
		};
	}
	if (!isRoomDrawVoter(draw, participant.id)) {
		return {
			error: {
				code: "VOTE_NOT_ELIGIBLE",
				message:
					"추첨 시작 후 입장해 이번 결과에는 투표할 수 없습니다. 다음 추첨부터 참여해 주세요.",
			},
		};
	}
	if (votes.length >= lunchRoomLimits.maxMembers) {
		return {
			error: {
				code: "VOTE_LIMIT",
				message: "이 결과의 투표 인원이 가득 찼습니다.",
			},
		};
	}
	const vote: RoomDrawVote = {
		participantId: participant.id,
		name: normalizeLunchRoomNickname(participant.name) ?? "참가자",
		vote: choice,
		timestamp: now,
		reactionMs: now - endedAt,
	};
	return { draw: { ...draw, votes: [...votes, vote] }, vote };
}
