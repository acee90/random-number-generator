import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { getWheelRotation, sampleLunchPlaces } from "@/lib/lunch";
import {
	type ChatMessage,
	getEligibleRoomCandidates,
	isRoomDrawVoter,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	normalizeRoomCategory,
	parseRoomGameFilter,
	type RoomDraw,
	type RoomDrawVote,
	type RoomParticipant,
	type RoomSnapshot,
} from "@/lib/lunchRoom";
import type { useLunchRoom as useServiceLunchRoom } from "../../src/hooks/useLunchRoom";
import {
	appendPreviewVote,
	createPreviewDraw,
	previewGuests,
	previewSelfId,
	previewVotes,
} from "./fixtures";

type RoomState = ReturnType<typeof useServiceLunchRoom>;
type VoteChoice = RoomDrawVote["vote"];
export const previewRoomId = "0fcf86a1-e559-40a5-b1c1-ece35d185609";
const host: RoomParticipant = {
	id: "preview-host",
	name: "방장",
	isHost: true,
};
const guests = previewGuests.slice(0, 12);
const participants = [host, ...guests];

type PreviewOptions = {
	initialPhase: "idle" | "editing" | "collecting" | "reviewing" | "result";
	isHost: boolean;
	candidateCount?: number;
	voteDelayMs?: number;
	entryLoading?: boolean;
};
type PreviewState = Pick<
	RoomState,
	| "snapshot"
	| "nickname"
	| "connection"
	| "error"
	| "startPending"
	| "nextPending"
	| "candidatesPending"
	| "mutationPending"
	| "votePendingDrawId"
> & { snapshot: RoomSnapshot };

function initialState(
	{ initialPhase, isHost, candidateCount = 107 }: PreviewOptions,
	sequence: number,
): PreviewState {
	const now = Date.now();
	const candidates = sampleLunchPlaces.slice(
		0,
		Math.max(
			initialPhase === "result" ? 1 : 0,
			Math.min(candidateCount, sampleLunchPlaces.length),
		),
	);
	function completedDraw(id: string, startedAt: number, votes: number) {
		const draw = createPreviewDraw({ id, count: candidates.length });
		const value: RoomDraw = {
			...draw,
			candidates: candidates.map((candidate) => ({ ...candidate })),
			winnerIndex: Math.min(draw.winnerIndex, candidates.length - 1),
			probabilities: candidates.map(() => 1 / candidates.length),
			toRotation: getWheelRotation(
				0,
				Math.min(draw.winnerIndex, candidates.length - 1),
				candidates.length,
			),
			timestamp: startedAt - 350,
			requestedAt: startedAt - 350,
			startedAt,
			participants,
		};
		value.votes = previewVotes(votes).map((vote) => ({
			...vote,
			timestamp: startedAt + value.durationMs + vote.reactionMs,
		}));
		return value;
	}
	const previous = candidates.length
		? completedDraw(`page-history-${sequence}`, now - 120000, 5)
		: null;
	const current =
		initialPhase === "result"
			? completedDraw(`page-current-${sequence}`, now - 12000, 7)
			: null;
	const messages: ChatMessage[] = [
		{
			id: `page-system-${sequence}`,
			participantId: "system",
			name: "시스템",
			text: "방장이 입장했습니다.",
			timestamp: now - 110000,
			event: "joined",
		},
		{
			id: `page-chat-1-${sequence}`,
			participantId: guests[1].id,
			name: guests[1].name,
			text: "오늘은 가까운 곳으로 가요!",
			timestamp: now - 100000,
		},
		{
			id: `page-chat-2-${sequence}`,
			participantId: previewSelfId,
			name: guests[0].name,
			text: "좋아요. 룰렛에 맡겨볼까요?",
			timestamp: now - 80000,
		},
		{
			id: `page-chat-3-${sequence}`,
			participantId: guests[2].id,
			name: guests[2].name,
			text: "저도 준비됐어요 👍",
			timestamp: now - 60000,
		},
	];
	return {
		snapshot: {
			roomId: previewRoomId,
			title: "오늘 점심 추첨",
			createdAt: now - 180000,
			expiresAt: now - 180000 + lunchRoomLimits.ttlMs,
			listVersion: 1,
			revision: 1,
			intakeId:
				initialPhase === "collecting" || initialPhase === "reviewing"
					? `page-intake-${sequence}`
					: null,
			excludeDrawn: false,
			gameFilter: { categories: null, excludedIds: [] },
			excludedIds: current ? [current.candidates[current.winnerIndex].id] : [],
			candidates,
			participants,
			members: participants.map((participant, index) => ({
				...participant,
				status: index > 10 ? "away" : "online",
				lastActiveAt: now - (index > 10 ? 360000 : 10000),
				lastSeenAt: now,
			})),
			messages,
			draw: current,
			history: initialPhase === "editing" || !previous ? [] : [previous],
			status: initialPhase === "idle" ? "waiting" : initialPhase,
		},
		nickname: isHost ? host.name : guests[0].name,
		connection: "connected",
		error: "",
		startPending: false,
		nextPending: false,
		candidatesPending: false,
		mutationPending: null,
		votePendingDrawId: null,
	};
}

type PagePreviewController = {
	addVote: (choice: VoteChoice) => boolean;
	reset: () => void;
	canAddVote: boolean;
};
const PreviewContext = createContext<{
	room: RoomState;
	controller: PagePreviewController;
} | null>(null);

/** Storybook transport adapter. No sockets, requests or persistent state. */
export function RoomPageFixtureProvider({
	children,
	...options
}: PreviewOptions & { children: ReactNode }) {
	const sequence = useRef(1);
	const [frame, setFrame] = useState(() =>
		initialState(options, sequence.current),
	);
	const current = useRef(frame);
	const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
	const selfId = options.isHost ? host.id : previewSelfId;
	function commit(update: (value: PreviewState) => PreviewState) {
		current.current = update(current.current);
		setFrame(current.current);
	}
	function later(callback: () => void, delay: number) {
		const timer = setTimeout(() => {
			timers.current.delete(timer);
			callback();
		}, delay);
		timers.current.add(timer);
	}
	const cancelTimers = useCallback(() => {
		for (const timer of timers.current) clearTimeout(timer);
		timers.current.clear();
	}, []);
	useEffect(() => () => cancelTimers(), [cancelTimers]);
	function reset() {
		cancelTimers();
		commit(() => initialState(options, ++sequence.current));
	}
	function appendMessage(
		value: PreviewState,
		message: ChatMessage,
	): PreviewState {
		return {
			...value,
			snapshot: {
				...value.snapshot,
				messages: [...value.snapshot.messages, message].slice(
					-lunchRoomLimits.maxMessages,
				),
			},
		};
	}
	function systemMessage(
		text: string,
		event?: ChatMessage["event"],
	): ChatMessage {
		return {
			id: `page-message-${++sequence.current}`,
			participantId: "system",
			name: "시스템",
			text,
			timestamp: Date.now(),
			event,
		};
	}
	function drawFinished(draw: RoomDraw | null) {
		return Boolean(draw && Date.now() >= draw.startedAt + draw.durationMs);
	}
	function mutable() {
		const value = current.current;
		return (
			options.isHost &&
			value.connection === "connected" &&
			!value.startPending &&
			!value.nextPending &&
			!value.mutationPending &&
			value.snapshot.status !== "fetching" &&
			value.snapshot.status !== "drawing" &&
			value.snapshot.status !== "closed"
		);
	}
	function revisionMatches(expected?: number) {
		return (
			expected === undefined ||
			expected === (current.current.snapshot.revision ?? 1)
		);
	}
	function applySnapshot(
		update: (snapshot: RoomSnapshot) => RoomSnapshot,
		conditionChanged = true,
	) {
		commit((value) => ({
			...value,
			error: "",
			snapshot: {
				...update(value.snapshot),
				revision: (value.snapshot.revision ?? 1) + Number(conditionChanged),
			},
		}));
	}
	async function intake(
		action: "edit" | "open" | "close" | "finalize",
		expected?: number,
	) {
		const snapshot = current.current.snapshot;
		if (!mutable() || !revisionMatches(expected)) return false;
		if (action === "edit") {
			if (snapshot.status !== "waiting") return false;
			applySnapshot((value) => ({
				...value,
				status: "editing",
				intakeId: null,
				draw: null,
			}));
		} else if (action === "open") {
			if (
				snapshot.status !== "waiting" &&
				snapshot.status !== "reviewing" &&
				snapshot.status !== "editing"
			)
				return false;
			applySnapshot((value) => ({
				...value,
				status: "collecting",
				intakeId: `page-intake-${++sequence.current}`,
			}));
		} else if (action === "close") {
			if (snapshot.status !== "collecting") return false;
			applySnapshot((value) => ({ ...value, status: "reviewing" }));
		} else {
			if (
				(snapshot.status !== "collecting" &&
					snapshot.status !== "reviewing" &&
					snapshot.status !== "editing") ||
				!getEligibleRoomCandidates(snapshot).length
			)
				return false;
			applySnapshot((value) => ({
				...value,
				status: "waiting",
				intakeId: null,
			}));
		}
		return true;
	}
	function addVote(choice: VoteChoice) {
		const value = current.current;
		const draw = value.snapshot.draw;
		if (!draw || !drawFinished(draw) || value.connection !== "connected")
			return false;
		const nextGuest = value.snapshot.participants.find(
			(participant) =>
				!participant.isHost &&
				participant.id !== selfId &&
				!draw.votes?.some((vote) => vote.participantId === participant.id),
		);
		if (!nextGuest) return false;
		commit((state) => ({
			...state,
			snapshot: {
				...state.snapshot,
				draw: appendPreviewVote(draw, choice, nextGuest),
			},
		}));
		return true;
	}
	const room: RoomState = {
		...frame,
		snapshot: options.entryLoading ? null : frame.snapshot,
		connection: options.entryLoading ? "connecting" : frame.connection,
		waitingForEntry: options.entryLoading ?? false,
		entryPending: options.entryLoading ?? false,
		entryLoading: options.entryLoading ?? false,
		self: options.entryLoading ? null : { id: selfId, isHost: options.isHost },
		clockOffset: 0,
		serverNow: () => Date.now(),
		enter: () => false,
		clearError: () => commit((value) => ({ ...value, error: "" })),
		localChatMessages: [],
		dismissLocalChat: () => {},
		rename(name) {
			const normalized = normalizeLunchRoomNickname(name);
			if (
				!normalized ||
				current.current.snapshot.participants.some(
					(participant) =>
						participant.id !== selfId && participant.name === normalized,
				)
			) {
				commit((value) => ({
					...value,
					error: "다른 닉네임을 입력해 주세요.",
				}));
				return false;
			}
			commit((value) => ({
				...value,
				nickname: normalized,
				error: "",
				snapshot: {
					...value.snapshot,
					participants: value.snapshot.participants.map((participant) =>
						participant.id === selfId
							? { ...participant, name: normalized }
							: participant,
					),
					members: value.snapshot.members?.map((member) =>
						member.id === selfId ? { ...member, name: normalized } : member,
					),
				},
			}));
			return true;
		},
		sendChat(text) {
			const message = text.trim();
			if (!message || message.length > 500) return false;
			commit((value) =>
				appendMessage(value, {
					id: `page-message-${++sequence.current}`,
					participantId: selfId,
					name: value.nickname,
					text: message,
					timestamp: Date.now(),
				}),
			);
			return true;
		},
		enterEditing: (expectedRevision) => intake("edit", expectedRevision),
		openIntake: (expectedRevision) => intake("open", expectedRevision),
		closeIntake: (expectedRevision) => intake("close", expectedRevision),
		finalizeIntake: (expectedRevision) => intake("finalize", expectedRevision),
		async addCandidate(name, category) {
			const snapshot = current.current.snapshot;
			const trimmed = name.trim();
			const normalizedCategory = normalizeRoomCategory(category ?? "");
			if (
				snapshot.status !== "collecting" ||
				!snapshot.intakeId ||
				!trimmed ||
				!normalizedCategory ||
				trimmed.length > 80 ||
				snapshot.candidates.length >= lunchRoomLimits.maxCandidates
			)
				return false;
			applySnapshot((value) => ({
				...value,
				listVersion: value.listVersion + 1,
				candidates: [
					...value.candidates,
					{
						id: `page-candidate-${++sequence.current}`,
						name: trimmed,
						category: normalizedCategory,
						included: true,
						ownerId: selfId,
						ownerName: current.current.nickname,
					},
				],
			}));
			return true;
		},
		async removeCandidate(candidateId) {
			const snapshot = current.current.snapshot;
			const candidate = snapshot.candidates.find(
				(item) => item.id === candidateId,
			);
			if (
				snapshot.status !== "collecting" ||
				!candidate ||
				(!options.isHost && candidate.ownerId !== selfId)
			)
				return false;
			applySnapshot((value) => ({
				...value,
				listVersion: value.listVersion + 1,
				candidates: value.candidates.filter((item) => item.id !== candidateId),
				excludedIds: value.excludedIds?.filter((id) => id !== candidateId),
				gameFilter: value.gameFilter
					? {
							...value.gameFilter,
							excludedIds: value.gameFilter.excludedIds.filter(
								(id) => id !== candidateId,
							),
						}
					: undefined,
			}));
			return true;
		},
		async editRoom({ baseVersion, title, candidates }) {
			if (
				!mutable() ||
				(candidates !== undefined &&
					!["editing", "collecting", "reviewing"].includes(
						current.current.snapshot.status,
					)) ||
				(candidates && baseVersion !== current.current.snapshot.listVersion)
			)
				return false;
			applySnapshot(
				(value) => ({
					...value,
					...(title === undefined ? {} : { title }),
					...(candidates === undefined
						? {}
						: {
								candidates: candidates.map((candidate) => ({ ...candidate })),
								listVersion: value.listVersion + 1,
								excludedIds: value.excludedIds?.filter((id) =>
									candidates.some((candidate) => candidate.id === id),
								),
								gameFilter: value.gameFilter
									? {
											...value.gameFilter,
											excludedIds: value.gameFilter.excludedIds.filter((id) =>
												candidates.some((candidate) => candidate.id === id),
											),
										}
									: undefined,
							}),
				}),
				candidates !== undefined,
			);
			return true;
		},
		async updateRoomOptions(excludeDrawn, expectedRevision) {
			if (!mutable() || !revisionMatches(expectedRevision)) return false;
			applySnapshot((value) => ({ ...value, excludeDrawn }));
			return true;
		},
		async updateGameFilter(filter, expectedRevision) {
			const parsed = parseRoomGameFilter(filter);
			if (
				!mutable() ||
				!["editing", "collecting", "reviewing"].includes(
					current.current.snapshot.status ?? "waiting",
				) ||
				!revisionMatches(expectedRevision) ||
				!parsed ||
				parsed.excludedIds.some(
					(id) =>
						!current.current.snapshot.candidates.some(
							(candidate) => candidate.id === id,
						),
				)
			)
				return false;
			applySnapshot((value) => ({
				...value,
				gameFilter: parsed,
				candidates: value.candidates.map((candidate) => ({
					...candidate,
					included: true,
				})),
			}));
			return true;
		},
		async resetExclusions(expectedRevision) {
			if (!mutable() || !revisionMatches(expectedRevision)) return false;
			applySnapshot((value) => ({ ...value, excludedIds: [] }));
			return true;
		},
		startDraw({ confirmReset, expectedRevision } = {}) {
			const value = current.current;
			const eligible = getEligibleRoomCandidates(value.snapshot);
			if (
				!mutable() ||
				!revisionMatches(expectedRevision) ||
				value.snapshot.status !== "waiting" ||
				value.snapshot.draw !== null ||
				eligible.length === 0 ||
				(!value.snapshot.excludeDrawn &&
					Boolean(value.snapshot.excludedIds?.length) &&
					!confirmReset)
			)
				return false;
			const requestedAt = Date.now();
			commit((state) =>
				appendMessage(
					{
						...state,
						startPending: true,
						snapshot: { ...state.snapshot, status: "fetching", draw: null },
					},
					systemMessage(
						`방장이 ${eligible.length}곳 중 추첨을 시작했습니다.`,
						"draw-started",
					),
				),
			);
			later(() => {
				const state = current.current;
				const candidates = eligible;
				const winnerIndex = ++sequence.current % candidates.length;
				const draw: RoomDraw = {
					id: `page-draw-${sequence.current}`,
					candidates,
					winnerIndex,
					source: "csprng",
					requestedAt,
					timestamp: requestedAt,
					startedAt: Date.now(),
					durationMs: lunchRoomLimits.drawDurationMs,
					fromRotation: 0,
					toRotation: getWheelRotation(0, winnerIndex, candidates.length),
					listVersion: state.snapshot.listVersion,
					gameFilter: state.snapshot.gameFilter
						? {
								categories:
									state.snapshot.gameFilter.categories === null
										? null
										: [...state.snapshot.gameFilter.categories],
								excludedIds: [...state.snapshot.gameFilter.excludedIds],
							}
						: undefined,
					participants: state.snapshot.participants,
					probabilities: candidates.map(() => 1 / candidates.length),
					votes: [],
					excludeDrawn: state.snapshot.excludeDrawn ?? false,
					excludedIdsBefore: [...(state.snapshot.excludedIds ?? [])],
				};
				const winnerId = candidates[winnerIndex].id;
				const excludedIds = draw.excludeDrawn
					? [...new Set([...(state.snapshot.excludedIds ?? []), winnerId])]
					: [winnerId];
				commit((latest) => ({
					...latest,
					startPending: false,
					snapshot: {
						...latest.snapshot,
						status: "drawing",
						draw,
						excludedIds: draw.excludeDrawn ? draw.excludedIdsBefore : [],
						revision: (latest.snapshot.revision ?? 1) + 1,
					},
				}));
				later(() => {
					if (current.current.snapshot.draw?.id !== draw.id) return;
					commit((latest) =>
						appendMessage(
							{
								...latest,
								snapshot: {
									...latest.snapshot,
									status: "result",
									excludedIds,
									revision: (latest.snapshot.revision ?? 1) + 1,
								},
							},
							systemMessage(
								`추첨 결과: ${draw.candidates[draw.winnerIndex].name}`,
								"draw-finished",
							),
						),
					);
				}, draw.durationMs);
			}, 350);
			return true;
		},
		nextRound(drawId) {
			const draw = current.current.snapshot.draw;
			if (!options.isHost || !draw || draw.id !== drawId || !drawFinished(draw))
				return false;
			commit((value) => ({
				...value,
				snapshot: {
					...value.snapshot,
					draw: null,
					status: "waiting",
					revision: (value.snapshot.revision ?? 1) + 1,
					history: value.snapshot.history.some((entry) => entry.id === drawId)
						? value.snapshot.history
						: [draw, ...value.snapshot.history].slice(
								0,
								lunchRoomLimits.maxHistory,
							),
				},
			}));
			return true;
		},
		updateCandidates(ids) {
			const value = current.current;
			const selected = sampleLunchPlaces.filter((place) =>
				ids.includes(place.id),
			);
			if (
				!options.isHost ||
				value.startPending ||
				value.nextPending ||
				(value.snapshot.draw && !drawFinished(value.snapshot.draw)) ||
				selected.length < 2 ||
				selected.length !== new Set(ids).size
			)
				return false;
			commit((state) => ({
				...state,
				snapshot: {
					...state.snapshot,
					candidates: selected,
					listVersion: state.snapshot.listVersion + 1,
					revision: (state.snapshot.revision ?? 1) + 1,
				},
			}));
			return true;
		},
		vote(drawId, choice) {
			const value = current.current;
			const draw = value.snapshot.draw;
			if (
				options.isHost ||
				!draw ||
				draw.id !== drawId ||
				!drawFinished(draw) ||
				!isRoomDrawVoter(draw, selfId) ||
				value.votePendingDrawId ||
				draw.votes?.some((vote) => vote.participantId === selfId) ||
				value.snapshot.history.some((entry) => entry.id === drawId)
			)
				return false;
			commit((state) => ({ ...state, votePendingDrawId: drawId }));
			later(() => {
				const participant = current.current.snapshot.participants.find(
					(entry) => entry.id === selfId,
				);
				if (!participant || current.current.snapshot.draw?.id !== drawId)
					return;
				commit((state) => ({
					...state,
					votePendingDrawId: null,
					snapshot: {
						...state.snapshot,
						draw: appendPreviewVote(
							state.snapshot.draw ?? draw,
							choice,
							participant,
						),
					},
				}));
			}, options.voteDelayMs ?? 140);
			return true;
		},
		reconnect() {
			commit((value) => ({ ...value, connection: "reconnecting" }));
			later(
				() => commit((value) => ({ ...value, connection: "connected" })),
				200,
			);
		},
	};
	const draw = frame.snapshot.draw;
	const canAddVote = Boolean(
		draw &&
			drawFinished(draw) &&
			frame.snapshot.participants.some(
				(participant) =>
					!participant.isHost &&
					participant.id !== selfId &&
					!draw.votes?.some((vote) => vote.participantId === participant.id),
			),
	);
	return (
		<PreviewContext.Provider
			value={{ room, controller: { addVote, reset, canAddVote } }}
		>
			{children}
		</PreviewContext.Provider>
	);
}

/** Replaces only the transport hook inside Storybook's Vite configuration. */
export function useLunchRoom(
	_roomId: string,
	_legacyGuest = false,
	_options: { requireEntry?: boolean } = {},
): RoomState {
	const context = useContext(PreviewContext);
	if (!context)
		throw new Error(
			"RoomPageFixtureProvider is required for the page preview.",
		);
	return context.room;
}

export function useRoomPagePreview(): PagePreviewController {
	const context = useContext(PreviewContext);
	if (!context)
		throw new Error(
			"RoomPageFixtureProvider is required for the page preview.",
		);
	return context.controller;
}
