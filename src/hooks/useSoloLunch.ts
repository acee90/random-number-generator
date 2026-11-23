import { useCallback, useEffect, useRef, useState } from "react";
import { parseClientMessage, type RoomSnapshot } from "@/lib/lunchRoom";
import {
	clearDisabledRoomExclusions,
	visibleRoomExclusions,
} from "@/lib/roomDrawMetadata";
import {
	advanceRoomRound,
	applyRoomCommand,
	castRoomVote,
	type LifecycleCommand,
	prepareRoomDraw,
	startRoomSpin,
	validateRoomCommand,
} from "@/lib/roomGame";
import { forgetSoloRoom, saveSoloRoom } from "@/lib/soloRoom";
import { generateRandomNumbers } from "@/services/randomService";
import type { useLunchRoom } from "./useLunchRoom";

type Room = ReturnType<typeof useLunchRoom>;
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
	const self = snapshot.participants[0];
	const commit = useCallback((next: RoomSnapshot) => {
		current.current = next;
		setStorageFailed(!saveSoloRoom(next));
		setSnapshot(next);
	}, []);
	useEffect(() => {
		const timeout = setTimeout(
			() => {
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
			clearTimeout(timeout);
		};
	}, [initial.roomId, initial.expiresAt]);
	// Use the stored deadline on both first entry and refresh during a spin.
	useEffect(() => {
		if (snapshot.status !== "drawing" || !snapshot.draw) return;
		const { id, startedAt, durationMs } = snapshot.draw;
		function finish() {
			const state = current.current;
			if (
				state.status === "drawing" &&
				state.draw?.id === id &&
				Date.now() < state.expiresAt
			) {
				commit({
					...state,
					status: "result",
					revision: (state.revision ?? state.listVersion) + 1,
				});
			}
		}
		const remaining = startedAt + durationMs - Date.now();
		if (remaining <= 0) {
			finish();
			return;
		}
		const timer = setTimeout(finish, remaining);
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
			Date.now() < state.draw.startedAt + state.draw.durationMs ||
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
	const startDraw: Room["startDraw"] = ({ expectedRevision } = {}) => {
		const state = current.current;
		if (
			state.expiresAt <= Date.now() ||
			(expectedRevision !== undefined && expectedRevision !== state.revision) ||
			state.status !== "waiting" ||
			state.draw
		)
			return false;
		const prepared = prepareRoomDraw(state, state.participants);
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
		setError("");
		const fetching: RoomSnapshot = {
			...state,
			status: "fetching",
			revision: revision() + 1,
		};
		clearDisabledRoomExclusions(fetching);
		commit(fetching);
		void (async () => {
			try {
				const response = await generateRandomNumbers({
					data: { min: 0, max: candidates.length - 1, count: 1, unique: false },
				});
				if (!active()) return;
				const next = structuredClone(current.current);
				startRoomSpin(next, prepared, response, crypto.randomUUID(), 0);
				commit(next);
			} catch {
				if (!active()) return;
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
