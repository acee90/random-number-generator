import { useCallback, useEffect, useRef, useState } from "react";
import {
	canStartRoomDraw,
	parseClientMessage,
	type RoomSnapshot,
} from "@/lib/lunchRoom";
import { visibleRoomExclusions } from "@/lib/roomDrawMetadata";
import {
	advanceRoomRound,
	applyRoomCommand,
	beginRoomDraw,
	castRoomVote,
	finishRoomDraw,
	type LifecycleCommand,
	prepareRoomDraw,
	queueRoomDriveInput,
	type RoomDriveIntent,
	startRoomSpin,
	updateRoomDrive,
	validateRoomCommand,
} from "@/lib/roomGame";
import { forgetSoloRoom, saveSoloRoom } from "@/lib/soloRoom";
import { getSpinDeadline } from "@/lib/spinDrive";
import {
	drawFromSoloEntropy,
	type PreparedRoomEntropy,
	reserveRoomEntropy,
	roomEntropyTtlMs,
	roomEntropyWordsPerDraw,
} from "@/services/roomEntropy";
import { prepareSoloRoomEntropy } from "@/services/roomEntropyApi";
import type { useLunchRoom } from "./useLunchRoom";

type Room = ReturnType<typeof useLunchRoom>;
interface SoloEntropyPool {
	prepared?: PreparedRoomEntropy;
	refreshing: boolean;
	retryAt: number;
}

const unavailable = () => false;
const noop = () => {};

export function useSoloLunch(
	initial: RoomSnapshot,
	initialStorageFailed = false,
) {
	const [snapshot, setSnapshot] = useState(initial);
	const current = useRef(initial);
	const [error, setError] = useState(
		initial.status === "closed" ? "방장이 방을 종료했습니다." : "",
	);
	const [storageFailed, setStorageFailed] = useState(initialStorageFailed);
	const attempt = useRef(0);
	const pendingDrive = useRef<(RoomDriveIntent & { id: string }) | null>(null);
	const initialDrive = useRef(
		initial.draw?.drive?.held ? initial.draw.id : null,
	);
	const entropyPool = useRef<SoloEntropyPool | null>(null);
	const self = snapshot.participants[0];
	const commit = useCallback((next: RoomSnapshot) => {
		current.current = next;
		setStorageFailed(!saveSoloRoom(next));
		setSnapshot(next);
	}, []);
	useEffect(() => {
		entropyPool.current = { refreshing: false, retryAt: 0 };
		const timeout = setTimeout(
			() => {
				entropyPool.current = null;
				forgetSoloRoom(initial.roomId);
				const closed: RoomSnapshot = {
					...current.current,
					draw: null,
					history: [],
					status: "closed",
				};
				current.current = closed;
				setSnapshot(closed);
				setError("방이 만료되어 기록이 삭제되었습니다.");
			},
			Math.max(0, initial.expiresAt - Date.now()),
		);
		return () => {
			attempt.current++;
			entropyPool.current = null;
			clearTimeout(timeout);
		};
	}, [initial.roomId, initial.expiresAt]);
	useEffect(() => {
		const pool = entropyPool.current;
		const now = Date.now();
		if (
			!pool ||
			pool.refreshing ||
			pool.retryAt > now ||
			snapshot.expiresAt <= now ||
			!["waiting", "drawing", "result"].includes(snapshot.status)
		)
			return;
		if (
			pool.prepared &&
			pool.prepared.expiresAt > now &&
			pool.prepared.seeds.length > roomEntropyWordsPerDraw
		)
			return;
		pool.refreshing = true;
		void (async () => {
			try {
				const batch = await prepareSoloRoomEntropy();
				const receivedAt = Date.now();
				if (
					batch &&
					entropyPool.current === pool &&
					current.current.status !== "closed" &&
					receivedAt < current.current.expiresAt
				) {
					pool.prepared = {
						...batch,
						seeds: [...batch.seeds],
						expiresAt: receivedAt + roomEntropyTtlMs,
					};
					return;
				}
			} catch {
				// The current draw already has local entropy available.
			} finally {
				pool.refreshing = false;
			}
			pool.retryAt = Date.now() + roomEntropyTtlMs;
		})();
	}, [snapshot.expiresAt, snapshot.status]);
	// Use the stored deadline on both first entry and refresh during a spin.
	useEffect(() => {
		const drawId = initialDrive.current;
		if (!drawId) return;
		initialDrive.current = null;
		const state = current.current;
		const drive = state.draw?.drive;
		const next = { ...state };
		if (
			drive?.held &&
			updateRoomDrive(
				next,
				drawId,
				{ held: false, sequence: drive.sequence + 1 },
				Date.now(),
			)
		)
			commit(next);
	}, [commit]);
	useEffect(() => {
		if (snapshot.status !== "drawing" || !snapshot.draw) return;
		const { id } = snapshot.draw;
		const deadline = getSpinDeadline(snapshot.draw);
		if (!Number.isFinite(deadline)) return;
		let timer: ReturnType<typeof setTimeout>;
		function finish() {
			const state = current.current;
			const now = Date.now();
			if (state.draw?.id !== id || now >= state.expiresAt) return;
			const next = { ...state };
			if (finishRoomDraw(next, now)) commit(next);
			else if (now < deadline) timer = setTimeout(finish, deadline - now);
		}
		finish();
		return () => clearTimeout(timer);
	}, [snapshot.status, snapshot.draw, commit]);

	function revision(value?: number) {
		return value ?? current.current.revision ?? current.current.listVersion;
	}
	async function change(command: LifecycleCommand) {
		const state = current.current;
		if (state.expiresAt <= Date.now()) return false;
		const parsed = parseClientMessage(JSON.stringify(command));
		if (!parsed || parsed.type !== command.type) return false;
		const invalid = validateRoomCommand(state, parsed, self, true);
		if (invalid) {
			setError(invalid.message);
			return false;
		}
		const next = structuredClone(state);
		applyRoomCommand(next, parsed, self, self.id);
		commit(next);
		setError("");
		return true;
	}
	function intake(
		action: "edit" | "open" | "close" | "finalize",
		expected?: number,
	) {
		return change({
			type: "intake",
			action,
			id: crypto.randomUUID(),
			expectedRevision: revision(expected),
		});
	}
	const nextRound: Room["nextRound"] = (drawId, editCandidates = false) => {
		const state = current.current;
		if (
			!state.draw ||
			state.draw.id !== drawId ||
			state.status !== "result" ||
			Date.now() < getSpinDeadline(state.draw) ||
			Date.now() >= state.expiresAt
		)
			return false;
		const next = { ...state };
		advanceRoomRound(next, editCandidates);
		commit(next);
		return true;
	};
	const vote: Room["vote"] = (drawId, choice) => {
		const state = current.current;
		if (state.status === "closed" || state.expiresAt <= Date.now())
			return false;
		const result = castRoomVote(state, self, drawId, choice, Date.now());
		if (result.error) return false;
		commit({ ...state, draw: result.draw });
		return true;
	};
	const startDraw: Room["startDraw"] = ({
		driveId,
		driveStartIndex,
		expectedRevision,
		previousDrawId,
		spinPower,
	} = {}) => {
		const state = current.current;
		if (
			state.expiresAt <= Date.now() ||
			(expectedRevision !== undefined && expectedRevision !== revision()) ||
			!canStartRoomDraw(state, previousDrawId)
		)
			return false;
		let drive: (RoomDriveIntent & { id: string }) | null = null;
		if (driveId !== undefined) {
			const message = parseClientMessage(
				JSON.stringify({
					type: "start",
					id: driveId,
					driveId,
					driveStartIndex,
				}),
			);
			if (
				message?.type !== "start" ||
				state.draw?.id === driveId ||
				state.history.some((draw) => draw.id === driveId) ||
				state.olderWins?.some((win) => win.id === driveId) ||
				state.exclusionRecords?.some((entry) => entry.drawId === driveId)
			)
				return false;
			drive = {
				id: driveId,
				held: true,
				sequence: 0,
				startIndex: message.driveStartIndex,
			};
		}
		const prepared = prepareRoomDraw(state, state.participants, spinPower);
		const { candidates } = prepared;
		if (!candidates.length) {
			setError(
				"추첨할 후보가 없습니다. 후보나 당첨 제외 목록을 확인해 주세요.",
			);
			return false;
		}
		const request = ++attempt.current;
		const active = () =>
			attempt.current === request && Date.now() < state.expiresAt;
		const reserved = reserveRoomEntropy(
			entropyPool.current?.prepared,
			prepared.requestedAt,
		);
		setError("");
		pendingDrive.current = drive;
		const fetching = { ...state };
		beginRoomDraw(fetching);
		commit(fetching);
		void (async () => {
			try {
				const response = await drawFromSoloEntropy(
					candidates.length - 1,
					reserved,
				);
				if (!active()) return;
				const next = structuredClone(current.current);
				startRoomSpin(
					next,
					prepared,
					response,
					driveId ?? crypto.randomUUID(),
					0,
					pendingDrive.current ?? undefined,
				);
				pendingDrive.current = null;
				commit(next);
			} catch {
				if (!active()) return;
				pendingDrive.current = null;
				commit({
					...current.current,
					status: "waiting",
					revision: revision() + 1,
				});
				setError("추첨 결과를 가져오지 못했습니다. 다시 시도해 주세요.");
			}
		})();
		return true;
	};
	const setDriveHeld: Room["setDriveHeld"] = (drawId, held, sequence) => {
		const message = parseClientMessage(
			JSON.stringify({
				type: "drive",
				drawId,
				held,
				sequence,
			}),
		);
		const now = Date.now();
		const state = current.current;
		if (!message || message.type !== "drive" || now >= state.expiresAt) return;
		const pending = pendingDrive.current;
		if (pending?.id === drawId && state.status === "fetching") {
			queueRoomDriveInput(pending, message, now);
			return;
		}
		const next = { ...state };
		if (updateRoomDrive(next, drawId, message, now)) commit(next);
	};

	const room = {
		snapshot: { ...snapshot, ...visibleRoomExclusions(snapshot) },
		self,
		connection: snapshot.status === "closed" ? "closed" : "connected",
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
		setDriveHeld,
		nextRound,
		vote,
		enterEditing: (expected?: number) => intake("edit", expected),
		finalizeIntake: (expected?: number) => intake("finalize", expected),
		openIntake: (expected?: number) => intake("open", expected),
		closeIntake: (expected?: number) => intake("close", expected),
		addCandidate: (name, category?: string) =>
			change({
				type: "recommend",
				id: crypto.randomUUID(),
				name,
				category,
				intakeId: current.current.intakeId ?? "",
			}),
		removeCandidate: (candidateId) =>
			change({
				type: "remove-candidate",
				id: crypto.randomUUID(),
				candidateId,
				intakeId: current.current.intakeId ?? "",
			}),
		editRoom: ({ baseVersion, candidates, title }) =>
			change({
				type: "room-edit",
				id: crypto.randomUUID(),
				baseListVersion: baseVersion,
				candidates,
				title,
			}),
		updateGameFilter: (filter, expected?: number) =>
			change({
				type: "game-filter",
				id: crypto.randomUUID(),
				filter,
				expectedRevision: revision(expected),
			}),
		updateRoomOptions: (excludeDrawn, expected?: number) =>
			change({
				type: "options",
				id: crypto.randomUUID(),
				excludeDrawn,
				expectedRevision: revision(expected),
			}),
		updateDrawView: (viewMode, expected?: number) =>
			change({
				type: "draw-view",
				id: crypto.randomUUID(),
				viewMode,
				expectedRevision: revision(expected),
			}),
		switchGame: (viewMode, expectedRevision, changes) =>
			change({
				type: "switch-game",
				id: crypto.randomUUID(),
				viewMode,
				expectedRevision,
				...changes,
			}),
		resetExclusions: (expected?: number) =>
			change({
				type: "reset-exclusions",
				id: crypto.randomUUID(),
				expectedRevision: revision(expected),
			}),
		closeRoom: async () => {
			const state = current.current;
			if (
				["fetching", "drawing", "closed"].includes(state.status) ||
				state.expiresAt <= Date.now()
			)
				return false;
			commit({ ...state, status: "closed", revision: revision() + 1 });
			setError("방장이 방을 종료했습니다.");
			return true;
		},
		entryLoading: false,
		waitingForEntry: false,
		entryPending: false,
		enter: unavailable,
		rename: unavailable,
		sendChat: unavailable,
		updateCandidates: unavailable,
		reconnect: noop,
		clearError: () => setError(""),
		localChatMessages: [],
		dismissLocalChat: noop,
	} satisfies Room;
	return { room, storageFailed };
}
