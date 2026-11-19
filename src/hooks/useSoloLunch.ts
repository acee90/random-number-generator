import { useCallback, useEffect, useRef, useState } from "react";
import {
	getWheelRotation,
	type LunchPlace,
	lunchSpinDurationMs,
	randomWheelLandingFraction,
	resolveLunchWinner,
} from "@/lib/lunch";
import {
	getEligibleRoomCandidates,
	lunchRoomLimits,
	parseRoomDrawHistory,
	type RoomDraw,
	type RoomSnapshot,
} from "@/lib/lunchRoom";
import {
	clearDisabledRoomExclusions,
	recordRoomDrawMetadata,
	setRoomExcludeDrawn,
	visibleRoomExclusions,
} from "@/lib/roomDrawMetadata";
import { generateRandomNumbers } from "@/services/randomService";
import type { useLunchRoom } from "./useLunchRoom";

export const soloHistoryKey = "randomlab:solo-draws:v1";
const emptyPlaces: readonly LunchPlace[] = [];
const self = { id: "solo", name: "나", isHost: true };
const unavailable = () => false;
const unavailableAsync = async () => false;
const noop = () => {};

function initialSnapshot(places: readonly LunchPlace[]): RoomSnapshot {
	const now = Date.now();
	return {
		roomId: "00000000-0000-4000-8000-000000000001",
		title: "혼자 추첨하기",
		createdAt: now,
		expiresAt: now + lunchRoomLimits.ttlMs,
		listVersion: 1,
		revision: 1,
		candidates: places.map((place) => ({ ...place })),
		participants: [self],
		messages: [],
		draw: null,
		history: [],
		status: places.length > 0 ? "waiting" : "editing",
		excludeDrawn: false,
		excludedIds: [],
		exclusionRecords: [],
		drawCount: 0,
		gameFilter: { categories: null, excludedIds: [] },
	};
}

/** Local transport for the same game screen used by connected rooms. */
export function useSoloLunch(places: readonly LunchPlace[] = emptyPlaces) {
	const [snapshot, setSnapshot] = useState(() => initialSnapshot(places));
	const current = useRef(snapshot);
	const [error, setError] = useState("");
	const [storageFailed, setStorageFailed] = useState(false);
	const mounted = useRef(true);
	const attempt = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const commit = useCallback((next: RoomSnapshot) => {
		current.current = next;
		setSnapshot(next);
	}, []);
	useEffect(() => {
		mounted.current = true;
		try {
			const raw = localStorage.getItem(soloHistoryKey);
			if (raw) {
				// History spans independent sessions and candidate list revisions.
				const history = parseRoomDrawHistory(JSON.parse(raw));
				if (history)
					commit({
						...current.current,
						history,
						listVersion: Math.max(
							current.current.listVersion,
							...history.map((draw) => draw.listVersion),
						),
						drawCount: Math.max(
							0,
							...history.map((draw) => draw.roundNumber ?? 0),
						),
					});
				else setStorageFailed(true);
			}
		} catch {
			setStorageFailed(true);
		}
		return () => {
			mounted.current = false;
			attempt.current++;
			clearTimeout(timer.current);
		};
	}, [commit]);
	function persist(history: RoomDraw[]) {
		try {
			localStorage.setItem(soloHistoryKey, JSON.stringify(history));
			setStorageFailed(false);
		} catch {
			setStorageFailed(true);
		}
	}
	function editable(revision?: number) {
		const state = current.current;
		return (
			!["fetching", "drawing", "closed"].includes(state.status) &&
			(revision === undefined || revision === state.revision)
		);
	}
	function mutate(
		change: (next: RoomSnapshot) => boolean,
		revision?: number,
	): Promise<boolean> {
		if (!editable(revision)) return Promise.resolve(false);
		const next = structuredClone(current.current);
		if (!change(next)) return Promise.resolve(false);
		next.revision = (next.revision ?? next.listVersion) + 1;
		commit(next);
		setError("");
		return Promise.resolve(true);
	}
	const enterEditing: ReturnType<typeof useLunchRoom>["enterEditing"] = (
		revision,
	) =>
		mutate((next) => {
			if (next.status !== "waiting" || next.draw) return false;
			next.status = "editing";
			return true;
		}, revision);
	const finalizeIntake: ReturnType<typeof useLunchRoom>["finalizeIntake"] = (
		revision,
	) =>
		mutate((next) => {
			if (
				next.status !== "editing" ||
				getEligibleRoomCandidates({ ...next, excludeDrawn: false }).length === 0
			)
				return false;
			next.status = "waiting";
			return true;
		}, revision);
	const editRoom: ReturnType<typeof useLunchRoom>["editRoom"] = ({
		baseVersion,
		candidates,
		title,
	}) =>
		mutate((next) => {
			if (
				baseVersion !== next.listVersion ||
				(candidates && next.status !== "editing")
			)
				return false;
			if (candidates) {
				if (
					candidates.length > lunchRoomLimits.maxCandidates ||
					new Set(candidates.map((item) => item.id)).size !== candidates.length
				)
					return false;
				next.candidates = structuredClone(candidates);
				const ids = new Set(candidates.map((item) => item.id));
				next.excludedIds = next.excludedIds?.filter((id) => ids.has(id));
				next.exclusionRecords = next.exclusionRecords?.filter((item) =>
					ids.has(item.candidateId),
				);
				if (next.gameFilter)
					next.gameFilter.excludedIds = next.gameFilter.excludedIds.filter(
						(id) => ids.has(id),
					);
				next.listVersion++;
			}
			if (title !== undefined) next.title = title.trim();
			return true;
		});
	const updateGameFilter: ReturnType<typeof useLunchRoom>["updateGameFilter"] =
		(filter, revision) =>
			mutate((next) => {
				if (next.status !== "editing") return false;
				next.gameFilter = structuredClone(filter);
				next.candidates = next.candidates.map((candidate) => ({
					...candidate,
					included: true,
				}));
				return true;
			}, revision);
	const updateRoomOptions: ReturnType<
		typeof useLunchRoom
	>["updateRoomOptions"] = (excludeDrawn, revision) =>
		mutate((next) => {
			setRoomExcludeDrawn(next, excludeDrawn);
			return true;
		}, revision);
	const resetExclusions: ReturnType<typeof useLunchRoom>["resetExclusions"] = (
		revision,
	) =>
		mutate((next) => {
			next.excludedIds = [];
			next.exclusionRecords = [];
			return true;
		}, revision);
	const nextRound: ReturnType<typeof useLunchRoom>["nextRound"] = (
		drawId,
		editCandidates,
	) => {
		const state = current.current;
		if (
			!state.draw ||
			state.draw.id !== drawId ||
			Date.now() < state.draw.startedAt + state.draw.durationMs ||
			state.status !== "result"
		)
			return false;
		const next: RoomSnapshot = {
			...state,
			draw: null,
			status: editCandidates ? "editing" : "waiting",
			revision: (state.revision ?? 1) + 1,
		};
		clearDisabledRoomExclusions(next);
		commit(next);
		return true;
	};
	const startDraw: ReturnType<typeof useLunchRoom>["startDraw"] = ({
		expectedRevision,
	} = {}) => {
		const state = current.current;
		if (!editable(expectedRevision) || state.status !== "waiting" || state.draw)
			return false;
		const candidates = structuredClone(getEligibleRoomCandidates(state));
		if (!candidates.length) {
			setError(
				"추첨할 후보가 없습니다. 후보나 당첨 제외 목록을 확인해 주세요.",
			);
			return false;
		}
		const request = ++attempt.current;
		const requestedAt = Date.now();
		setError("");
		const fetching: RoomSnapshot = { ...state, status: "fetching" };
		clearDisabledRoomExclusions(fetching);
		commit(fetching);
		void (async () => {
			try {
				const response = await generateRandomNumbers({
					data: { min: 0, max: candidates.length - 1, count: 1, unique: false },
				});
				if (!mounted.current || attempt.current !== request) return;
				if (
					!Array.isArray(response.numbers) ||
					response.numbers.length !== 1 ||
					!["quantum", "atmospheric", "csprng", "mixed"].includes(
						response.source,
					)
				)
					throw new Error("Invalid draw");
				resolveLunchWinner(candidates, response.numbers[0]);
				const timestamp = Date.now();
				const landingFraction = randomWheelLandingFraction();
				const draw: RoomDraw = {
					id: crypto.randomUUID(),
					candidates,
					winnerIndex: response.numbers[0],
					source: response.source,
					timestamp,
					startedAt: timestamp,
					requestedAt,
					durationMs: lunchSpinDurationMs,
					fromRotation: 0,
					toRotation: getWheelRotation(
						0,
						response.numbers[0],
						candidates.length,
						landingFraction,
					),
					landingFraction,
					listVersion: state.listVersion,
					probabilities: candidates.map(() => 1 / candidates.length),
					excludeDrawn: state.excludeDrawn,
					excludedIdsBefore: state.excludeDrawn
						? [...(state.excludedIds ?? [])]
						: [],
					gameFilter: structuredClone(state.gameFilter),
				};
				const next = structuredClone(current.current);
				recordRoomDrawMetadata(next, draw, Boolean(next.excludeDrawn));
				next.draw = draw;
				next.status = "drawing";
				commit(next);
				timer.current = setTimeout(() => {
					if (!mounted.current || attempt.current !== request) return;
					const completed = current.current;
					const history = [structuredClone(draw), ...completed.history].slice(
						0,
						lunchRoomLimits.maxHistory,
					);
					commit({
						...completed,
						status: "result",
						history,
						revision: (completed.revision ?? 1) + 1,
					});
					persist(history);
				}, lunchSpinDurationMs);
			} catch {
				if (!mounted.current || attempt.current !== request) return;
				commit({ ...current.current, status: "waiting" });
				setError("추첨 결과를 가져오지 못했습니다. 다시 시도해 주세요.");
			}
		})();
		return true;
	};
	const room = {
		snapshot: { ...snapshot, ...visibleRoomExclusions(snapshot) },
		self,
		connection: "connected",
		nickname: self.name,
		error,
		startPending: snapshot.status === "fetching",
		nextPending: false,
		candidatesPending: false,
		mutationPending: null,
		votePendingDrawId: null,
		clockOffset: 0,
		serverNow: Date.now,
		startDraw,
		nextRound,
		enterEditing,
		finalizeIntake,
		editRoom,
		updateGameFilter,
		updateRoomOptions,
		resetExclusions,
		// Collaboration capabilities are absent from solo's presentation.
		entryLoading: false,
		waitingForEntry: false,
		entryPending: false,
		enter: unavailable,
		rename: unavailable,
		sendChat: unavailable,
		updateCandidates: unavailable,
		openIntake: unavailableAsync,
		closeIntake: unavailableAsync,
		addCandidate: unavailableAsync,
		removeCandidate: unavailableAsync,
		closeRoom: unavailableAsync,
		vote: unavailable,
		reconnect: noop,
		clearError: () => setError(""),
		localChatMessages: [],
		dismissLocalChat: noop,
	} satisfies ReturnType<typeof useLunchRoom>;
	return { room, storageFailed };
}
