import PartySocket from "partysocket";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	type ClientMessage,
	clampLunchRoomNickname,
	isLunchRoomId,
	isRoomDrawVoter,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	parseClientMessage,
	parseServerMessage,
	type RoomSnapshot,
} from "@/lib/lunchRoom";
import {
	consumeLunchRoomEntry,
	readLunchRoomHost,
	readLunchRoomName,
	readOrCreateLunchRoomGuestToken,
	saveLunchRoomName,
} from "@/lib/lunchRoomClient";
import { beginRoomTiming } from "@/lib/roomTimings";

export type RoomConnection =
	| "waiting"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "closed";
type RoomSelf = { id: string; isHost: boolean };
type RoomError = {
	kind: "network" | "action" | "protocol" | "terminal" | "entry";
	message: string;
};

const terminalCodes = new Set([
	"ROOM_NOT_FOUND",
	"ROOM_EXPIRED",
	"ROOM_FULL",
	"HOST_AUTH_FAILED",
]);
function actionId(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) =>
		value.toString(16).padStart(2, "0"),
	).join("");
}

export function useLunchRoom(
	roomId: string,
	_legacyGuest = false,
	{ requireEntry = false }: { requireEntry?: boolean } = {},
) {
	const admissionScopeRef = useRef(roomId);
	const currentScope = admissionScopeRef.current === roomId;
	const [entryRequest, setEntryRequest] = useState<{
		roomId: string;
		name: string;
	} | null>(null);
	const [enteredRoomId, setEnteredRoomId] = useState<string | null>(null);
	const entry =
		currentScope && entryRequest?.roomId === roomId ? entryRequest : null;
	const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
	const [self, setSelf] = useState<RoomSelf | null>(null);
	const [connection, setConnection] = useState<RoomConnection>(
		requireEntry ? "waiting" : "connecting",
	);
	const [nickname, setNickname] = useState("");
	const [errorState, setErrorState] = useState<RoomError | null>(null);
	const [startPending, setStartPending] = useState(false);
	const [nextPending, setNextPending] = useState(false);
	const [candidatesPending, setCandidatesPending] = useState(false);
	const [votePendingDrawId, setVotePendingDrawId] = useState<string | null>(
		null,
	);
	const [clockOffset, setClockOffset] = useState(0);
	const socketRef = useRef<PartySocket | null>(null);
	const snapshotRef = useRef<RoomSnapshot | null>(null);
	const selfRef = useRef<RoomSelf | null>(null);
	const joinedRef = useRef(false);
	const terminalRef = useRef(false);
	const offsetRef = useRef(0);
	const measuredClockRef = useRef(false);
	const finishCommitRef = useRef<(() => void) | null>(null);
	const nicknameRef = useRef("");
	const explicitNameRef = useRef(false);
	const hostTokenRef = useRef<string | undefined>(undefined);
	const guestTokenRef = useRef<string | undefined>(undefined);
	const startRequestRef = useRef<string | null>(null);
	const nextRequestRef = useRef<{ id: string; drawId: string } | null>(null);
	const candidatesRequestRef = useRef<number | null>(null);
	const voteRequestRef = useRef<{ id: string; drawId: string } | null>(null);
	const voteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const actionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const serverNow = useCallback(() => Date.now() + offsetRef.current, []);
	const clearError = useCallback(() => setErrorState(null), []);
	const committedSelfId = self?.id;
	useLayoutEffect(() => {
		if (
			connection !== "connected" ||
			!committedSelfId ||
			snapshot?.roomId !== roomId
		)
			return;
		const finish = finishCommitRef.current;
		finishCommitRef.current = null;
		finish?.();
	}, [connection, committedSelfId, snapshot, roomId]);
	useEffect(() => {
		if (admissionScopeRef.current !== roomId) {
			admissionScopeRef.current = roomId;
			setEntryRequest(null);
			setEnteredRoomId(null);
			setErrorState(null);
		}
		if (!requireEntry) return;
		const preparedName = consumeLunchRoomEntry(roomId);
		if (preparedName) setEntryRequest({ roomId, name: preparedName });
	}, [roomId, requireEntry]);

	useEffect(() => {
		let active = true;
		let pingTimer: ReturnType<typeof setInterval> | undefined;
		let joinTimer: ReturnType<typeof setTimeout> | undefined;
		let activityTimer: ReturnType<typeof setTimeout> | undefined;
		let lastActivitySentAt: number | undefined;
		let lastInteractionAt: number | undefined;
		let lastActualActivityAt: number | undefined;
		let activityPending = false;
		const pings = new Set<number>();
		const clockSamples: { rtt: number; offset: number }[] = [];
		joinedRef.current = false;
		terminalRef.current = false;
		measuredClockRef.current = false;
		finishCommitRef.current = null;
		snapshotRef.current = null;
		selfRef.current = null;
		setSnapshot(null);
		setSelf(null);
		setConnection(requireEntry && !entry ? "waiting" : "connecting");
		setStartPending(false);
		nextRequestRef.current = null;
		setNextPending(false);
		setCandidatesPending(false);
		setVotePendingDrawId(null);
		voteRequestRef.current = null;
		clearTimeout(voteTimerRef.current);
		startRequestRef.current = null;
		candidatesRequestRef.current = null;
		clearTimeout(actionTimerRef.current);
		if (!isLunchRoomId(roomId)) {
			terminalRef.current = true;
			setConnection("closed");
			setErrorState({
				kind: "terminal",
				message: "참가 링크가 올바르지 않습니다.",
			});
			return;
		}
		if (requireEntry && !entry) return;
		setErrorState(null);
		const saved = clampLunchRoomNickname(readLunchRoomName() ?? "");
		const name = entry?.name || saved || `참가자-${actionId().slice(0, 4)}`;
		explicitNameRef.current = Boolean(entry);
		nicknameRef.current = name;
		setNickname(name);
		// Old invitation links contain guest=1; a saved owner proof takes priority.
		const storedToken = readLunchRoomHost(roomId);
		hostTokenRef.current =
			storedToken && /^[A-Za-z0-9_-]{16,256}$/.test(storedToken)
				? storedToken
				: undefined;
		guestTokenRef.current = hostTokenRef.current
			? undefined
			: readOrCreateLunchRoomGuestToken(roomId);
		let finishSocketOpen: (() => void) | undefined =
			beginRoomTiming("socket_open");
		let finishJoinAck: (() => void) | undefined;
		function finishConnectionTimings() {
			finishSocketOpen?.();
			finishJoinAck?.();
			finishSocketOpen = undefined;
			finishJoinAck = undefined;
		}
		const socket = new PartySocket({
			host: window.location.host,
			party: "lunch-rooms",
			room: roomId,
			maxEnqueuedMessages: 0,
			minReconnectionDelay: 1000,
			maxReconnectionDelay: 10000,
			connectionTimeout: 10000,
		});
		socketRef.current = socket;
		function clearActivity() {
			clearTimeout(activityTimer);
			activityTimer = undefined;
			activityPending = false;
			lastActivitySentAt = undefined;
			lastInteractionAt = undefined;
			lastActualActivityAt = undefined;
		}
		function canSendActivity() {
			return (
				active &&
				!terminalRef.current &&
				joinedRef.current &&
				socket.readyState === 1 &&
				document.visibilityState !== "hidden" &&
				(snapshotRef.current?.expiresAt ?? 0) > serverNow()
			);
		}
		function sendActivity() {
			clearTimeout(activityTimer);
			activityTimer = undefined;
			activityPending = false;
			const activityAge =
				lastActualActivityAt === undefined
					? Number.POSITIVE_INFINITY
					: Date.now() - lastActualActivityAt;
			// Discard stale trailing work after suspension or a wall-clock change.
			if (!canSendActivity() || activityAge < 0 || activityAge > 30000) return;
			try {
				const message: ClientMessage = { type: "activity" };
				if (socket.send(JSON.stringify(message)))
					lastActivitySentAt = Date.now();
			} catch {
				// Activity is best effort and is never replayed after reconnecting.
			}
		}
		function noteActivity() {
			if (!canSendActivity()) return;
			const now = Date.now();
			lastActualActivityAt = now;
			if (
				lastActivitySentAt === undefined ||
				now < lastActivitySentAt ||
				now - lastActivitySentAt >= 15000
			) {
				sendActivity();
				return;
			}
			activityPending = true;
			if (activityTimer === undefined)
				activityTimer = setTimeout(
					() => {
						if (activityPending) sendActivity();
					},
					15000 - (now - lastActivitySentAt),
				);
		}
		function onInteraction() {
			if (!canSendActivity()) return;
			lastInteractionAt = Date.now();
			noteActivity();
		}
		function onScroll() {
			// New chat messages can scroll programmatically without user input.
			if (lastInteractionAt === undefined) return;
			const elapsed = Date.now() - lastInteractionAt;
			if (elapsed >= 0 && elapsed <= 2000) noteActivity();
		}
		function clearPending() {
			clearTimeout(actionTimerRef.current);
			startRequestRef.current = null;
			candidatesRequestRef.current = null;
			setStartPending(false);
			nextRequestRef.current = null;
			setNextPending(false);
			setCandidatesPending(false);
			clearVotePending();
		}
		function clearVotePending() {
			clearTimeout(voteTimerRef.current);
			voteRequestRef.current = null;
			setVotePendingDrawId(null);
		}
		function stop(message: string) {
			finishCommitRef.current = null;
			finishConnectionTimings();
			terminalRef.current = true;
			joinedRef.current = false;
			clearInterval(pingTimer);
			clearTimeout(joinTimer);
			clearActivity();
			clearPending();
			setConnection("closed");
			setErrorState({ kind: "terminal", message });
			socket.close(1000, "Room unavailable");
		}
		function ping() {
			if (!active || terminalRef.current || socket.readyState !== 1) return;
			const clientTime = Date.now();
			pings.add(clientTime);
			for (const sent of pings)
				if (clientTime - sent > 30000) pings.delete(sent);
			socket.send(JSON.stringify({ type: "ping", clientTime }));
		}
		function onOpen() {
			if (!active || terminalRef.current) return;
			finishCommitRef.current = null;
			finishConnectionTimings();
			joinedRef.current = false;
			selfRef.current = null;
			setSelf(null);
			setConnection(snapshotRef.current ? "reconnecting" : "connecting");
			clearInterval(pingTimer);
			clearTimeout(joinTimer);
			clearActivity();
			pings.clear();
			clockSamples.length = 0;
			measuredClockRef.current = false;
			clearVotePending();
			finishJoinAck = beginRoomTiming("join_ack");
			socket.send(
				JSON.stringify({
					type: "join",
					name: nicknameRef.current,
					...(explicitNameRef.current ? { updateName: true } : {}),
					...(hostTokenRef.current ? { hostToken: hostTokenRef.current } : {}),
					...(guestTokenRef.current
						? { guestToken: guestTokenRef.current }
						: {}),
				}),
			);
			ping();
			pingTimer = setInterval(ping, 15000);
			joinTimer = setTimeout(() => {
				if (!active || joinedRef.current || terminalRef.current) return;
				finishJoinAck?.();
				finishJoinAck = undefined;
				setErrorState({
					kind: "network",
					message: "방에 연결하는 데 시간이 걸립니다. 다시 연결하고 있습니다.",
				});
				socket.reconnect();
			}, 12000);
		}
		function onMessage(event: MessageEvent) {
			if (!active || terminalRef.current) return;
			const message = parseServerMessage(event.data);
			if (
				!message ||
				(message.type === "snapshot" && message.snapshot.roomId !== roomId)
			) {
				setErrorState({
					kind: "protocol",
					message:
						"방에서 받은 정보를 확인하지 못했습니다. 다시 연결해 주세요.",
				});
				return;
			}
			if (message.type === "error") {
				if (terminalCodes.has(message.code)) {
					stop(message.message);
					return;
				}
				if (
					requireEntry &&
					!joinedRef.current &&
					(message.code === "NICKNAME_TAKEN" ||
						message.code === "INVALID_NICKNAME")
				) {
					finishConnectionTimings();
					finishCommitRef.current = null;
					active = false;
					clearInterval(pingTimer);
					clearTimeout(joinTimer);
					clearActivity();
					clearPending();
					setEntryRequest(null);
					setEnteredRoomId(null);
					setConnection("waiting");
					setErrorState({ kind: "entry", message: message.message });
					socket.close(1000, "Choose another nickname");
					return;
				}
				// A chat or another action's error is not a vote acknowledgement.
				if (
					voteRequestRef.current &&
					message.requestId === voteRequestRef.current.id
				) {
					clearVotePending();
				} else if (
					!nextRequestRef.current ||
					message.requestId === nextRequestRef.current.id
				) {
					clearTimeout(actionTimerRef.current);
					startRequestRef.current = null;
					candidatesRequestRef.current = null;
					setStartPending(false);
					nextRequestRef.current = null;
					setNextPending(false);
					setCandidatesPending(false);
				}
				setErrorState({ kind: "action", message: message.message });
				return;
			}
			if (message.type === "pong") {
				const now = Date.now();
				if (
					!pings.delete(message.clientTime) ||
					now < message.clientTime ||
					now - message.clientTime > 30000
				)
					return;
				clockSamples.push({
					rtt: now - message.clientTime,
					offset: message.serverTime - (message.clientTime + now) / 2,
				});
				if (clockSamples.length > 5) clockSamples.shift();
				const best = clockSamples.reduce((left, right) =>
					left.rtt <= right.rtt ? left : right,
				);
				offsetRef.current = best.offset;
				measuredClockRef.current = true;
				setClockOffset(best.offset);
				return;
			}
			if (!measuredClockRef.current) {
				offsetRef.current = message.serverTime - Date.now();
				setClockOffset(offsetRef.current);
			}
			const previous = snapshotRef.current;
			if (message.self && !joinedRef.current) {
				finishJoinAck?.();
				finishJoinAck = undefined;
				finishCommitRef.current = beginRoomTiming("room_commit");
			}
			snapshotRef.current = message.snapshot;
			setSnapshot(message.snapshot);
			if (message.self) {
				selfRef.current = message.self;
				setSelf(message.self);
				joinedRef.current = true;
				explicitNameRef.current = false;
				setEnteredRoomId(roomId);
				clearTimeout(joinTimer);
			}
			const confirmedName = clampLunchRoomNickname(
				message.snapshot.participants.find(
					(participant) => participant.id === selfRef.current?.id,
				)?.name ?? "",
			);
			if (
				confirmedName &&
				(nicknameRef.current !== confirmedName || message.self)
			) {
				nicknameRef.current = confirmedName;
				setNickname(confirmedName);
				saveLunchRoomName(confirmedName);
			}
			if (joinedRef.current) {
				setConnection("connected");
				setErrorState((error) => (error?.kind === "network" ? null : error));
			}
			const pendingVote = voteRequestRef.current;
			if (
				pendingVote &&
				(message.snapshot.draw?.id !== pendingVote.drawId ||
					message.snapshot.status === "fetching" ||
					message.snapshot.history.some(
						(entry) => entry.id === pendingVote.drawId,
					) ||
					message.snapshot.draw?.votes?.some(
						(vote) => vote.participantId === selfRef.current?.id,
					))
			)
				clearVotePending();
			if (
				startRequestRef.current &&
				(message.snapshot.status === "fetching" ||
					message.snapshot.draw?.id !== previous?.draw?.id)
			) {
				startRequestRef.current = null;
				setStartPending(false);
			}
			if (
				candidatesRequestRef.current !== null &&
				message.snapshot.listVersion !== candidatesRequestRef.current
			) {
				candidatesRequestRef.current = null;
				setCandidatesPending(false);
			}
			if (
				nextRequestRef.current &&
				message.snapshot.draw?.id !== nextRequestRef.current.drawId
			) {
				nextRequestRef.current = null;
				setNextPending(false);
			}
			if (
				!startRequestRef.current &&
				!nextRequestRef.current &&
				candidatesRequestRef.current === null
			)
				clearTimeout(actionTimerRef.current);
			if (
				message.snapshot.status === "closed" ||
				message.snapshot.expiresAt <= serverNow()
			)
				stop("이 방의 이용 시간이 끝났습니다. 새 방을 만들어 주세요.");
		}
		function onOffline(event: Event) {
			if (!active) return;
			finishCommitRef.current = null;
			finishJoinAck?.();
			finishJoinAck = undefined;
			clearInterval(pingTimer);
			clearTimeout(joinTimer);
			clearActivity();
			clearPending();
			if (terminalRef.current) return;
			if (event.type === "close" || !finishSocketOpen) {
				finishSocketOpen?.();
				finishSocketOpen = beginRoomTiming("socket_open");
			}
			joinedRef.current = false;
			selfRef.current = null;
			setSelf(null);
			setConnection("reconnecting");
			setErrorState((error) =>
				error?.kind === "action" || error?.kind === "protocol"
					? error
					: {
							kind: "network",
							message:
								"연결이 끊겼습니다. 다시 연결하는 동안 추첨과 채팅을 보낼 수 없습니다.",
						},
			);
		}
		function onVisibility() {
			if (document.visibilityState === "visible") ping();
			else clearActivity();
		}
		socket.addEventListener("open", onOpen);
		socket.addEventListener("message", onMessage);
		socket.addEventListener("close", onOffline);
		socket.addEventListener("error", onOffline);
		document.addEventListener("visibilitychange", onVisibility);
		for (const type of [
			"keydown",
			"pointerdown",
			"pointermove",
			"wheel",
			"touchmove",
		])
			window.addEventListener(type, onInteraction, { passive: true });
		window.addEventListener("scroll", onScroll, {
			capture: true,
			passive: true,
		});
		return () => {
			active = false;
			finishCommitRef.current = null;
			finishConnectionTimings();
			joinedRef.current = false;
			clearInterval(pingTimer);
			clearTimeout(joinTimer);
			clearActivity();
			clearTimeout(actionTimerRef.current);
			clearTimeout(voteTimerRef.current);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("message", onMessage);
			socket.removeEventListener("close", onOffline);
			socket.removeEventListener("error", onOffline);
			document.removeEventListener("visibilitychange", onVisibility);
			for (const type of [
				"keydown",
				"pointerdown",
				"pointermove",
				"wheel",
				"touchmove",
			])
				window.removeEventListener(type, onInteraction);
			window.removeEventListener("scroll", onScroll, true);
			socket.close(1000, "Left room");
			if (socketRef.current === socket) socketRef.current = null;
			hostTokenRef.current = undefined;
			guestTokenRef.current = undefined;
		};
	}, [roomId, serverNow, entry, requireEntry]);

	const expiresAt = snapshot?.expiresAt;
	useEffect(() => {
		if (expiresAt === undefined || connection === "closed") return;
		const remaining = expiresAt - Date.now() - clockOffset;
		const timer = setTimeout(
			() => {
				terminalRef.current = true;
				joinedRef.current = false;
				setConnection("closed");
				setErrorState({
					kind: "terminal",
					message: "이 방의 이용 시간이 끝났습니다. 새 방을 만들어 주세요.",
				});
				socketRef.current?.close(1000, "Room expired");
			},
			Math.max(0, remaining),
		);
		return () => clearTimeout(timer);
	}, [expiresAt, connection, clockOffset]);

	const send = useCallback(
		(message: ClientMessage) => {
			const socket = socketRef.current;
			const current = snapshotRef.current;
			if (terminalRef.current) return false;
			if (
				!socket ||
				socket.readyState !== 1 ||
				!joinedRef.current ||
				terminalRef.current ||
				!current ||
				current.expiresAt <= serverNow()
			) {
				setErrorState({
					kind: "network",
					message:
						"연결을 확인한 뒤 다시 시도해 주세요. 요청은 자동으로 다시 보내지 않습니다.",
				});
				return false;
			}
			const raw = JSON.stringify(message);
			if (!parseClientMessage(raw)) {
				setErrorState({
					kind: "action",
					message: "입력 내용을 확인해 주세요.",
				});
				return false;
			}
			try {
				if (!socket.send(raw)) throw new Error("Disconnected");
				setErrorState(null);
				return true;
			} catch {
				setErrorState({
					kind: "network",
					message:
						"요청을 보내지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
				});
				return false;
			}
		},
		[serverNow],
	);

	function rename(value: string) {
		const name = normalizeLunchRoomNickname(value);
		if (!name) {
			setErrorState({
				kind: "action",
				message: `참가 이름은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
			});
			return false;
		}
		if (
			!send({
				type: "join",
				name,
				updateName: true,
				...(hostTokenRef.current ? { hostToken: hostTokenRef.current } : {}),
				...(guestTokenRef.current ? { guestToken: guestTokenRef.current } : {}),
			})
		)
			return false;
		return true;
	}
	function enter(value: string) {
		if (terminalRef.current || enteredRoomId === roomId || entry) return false;
		const name = normalizeLunchRoomNickname(value);
		if (!name) {
			setErrorState({
				kind: "entry",
				message: `닉네임은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
			});
			return false;
		}
		setErrorState(null);
		setEntryRequest({ roomId, name });
		return true;
	}
	function sendChat(text: string) {
		const value = text.trim();
		if (!value || value.length > 500) {
			setErrorState({
				kind: "action",
				message: "메시지는 1~500자로 입력해 주세요.",
			});
			return false;
		}
		return send({ type: "chat", id: actionId(), text: value });
	}
	function markPending() {
		clearTimeout(actionTimerRef.current);
		actionTimerRef.current = setTimeout(() => {
			startRequestRef.current = null;
			candidatesRequestRef.current = null;
			setStartPending(false);
			nextRequestRef.current = null;
			setNextPending(false);
			setCandidatesPending(false);
			setErrorState({
				kind: "action",
				message:
					"요청 확인이 지연되고 있습니다. 방 상태를 확인한 뒤 다시 시도해 주세요.",
			});
		}, 15000);
	}
	function startDraw() {
		const current = snapshotRef.current;
		if (
			!selfRef.current?.isHost ||
			!current ||
			startRequestRef.current ||
			nextRequestRef.current ||
			candidatesRequestRef.current !== null ||
			current.status === "fetching" ||
			(current.draw &&
				serverNow() < current.draw.startedAt + current.draw.durationMs)
		)
			return false;
		const requestId = actionId();
		if (!send({ type: "start", id: requestId })) return false;
		startRequestRef.current = requestId;
		setStartPending(true);
		markPending();
		return true;
	}
	function updateCandidates(ids: string[]) {
		const current = snapshotRef.current;
		if (
			!selfRef.current?.isHost ||
			!current ||
			startRequestRef.current ||
			nextRequestRef.current ||
			candidatesRequestRef.current !== null ||
			current.status === "fetching" ||
			(current.draw &&
				serverNow() < current.draw.startedAt + current.draw.durationMs)
		)
			return false;
		if (!send({ type: "candidates", ids })) return false;
		candidatesRequestRef.current = current.listVersion;
		setCandidatesPending(true);
		markPending();
		return true;
	}
	function nextRound(drawId: string) {
		const current = snapshotRef.current;
		const draw = current?.draw;
		if (
			!selfRef.current?.isHost ||
			!current ||
			!draw ||
			draw.id !== drawId ||
			(current.status !== "waiting" && current.status !== "drawing") ||
			serverNow() < draw.startedAt + draw.durationMs ||
			startRequestRef.current ||
			nextRequestRef.current ||
			candidatesRequestRef.current !== null
		)
			return false;
		const id = actionId();
		if (!send({ type: "next", id, drawId })) return false;
		nextRequestRef.current = { id, drawId };
		setNextPending(true);
		markPending();
		return true;
	}
	function vote(drawId: string, choice: "up" | "down") {
		const current = snapshotRef.current;
		const self = selfRef.current;
		const draw = current?.draw;
		if (
			!self ||
			self.isHost ||
			!current ||
			!draw ||
			draw.id !== drawId ||
			!isRoomDrawVoter(draw, self.id) ||
			(current.status !== "waiting" && current.status !== "drawing") ||
			serverNow() < draw.startedAt + draw.durationMs ||
			current.history.some((entry) => entry.id === drawId) ||
			draw.votes?.some((entry) => entry.participantId === self.id) ||
			voteRequestRef.current
		)
			return false;
		const requestId = actionId();
		if (!send({ type: "vote", id: requestId, drawId, vote: choice }))
			return false;
		voteRequestRef.current = { id: requestId, drawId };
		setVotePendingDrawId(drawId);
		clearTimeout(voteTimerRef.current);
		voteTimerRef.current = setTimeout(() => {
			if (voteRequestRef.current?.id !== requestId) return;
			voteRequestRef.current = null;
			setVotePendingDrawId(null);
			setErrorState({
				kind: "action",
				message:
					"투표 확인이 지연되고 있습니다. 연결 후 투표 상태를 확인해 주세요.",
			});
		}, 15000);
		return true;
	}
	function reconnect() {
		if (terminalRef.current) return;
		setErrorState(null);
		setConnection("reconnecting");
		socketRef.current?.reconnect();
	}

	return {
		waitingForEntry:
			requireEntry &&
			(!currentScope || enteredRoomId !== roomId) &&
			connection !== "closed",
		entryPending:
			requireEntry &&
			Boolean(entry) &&
			enteredRoomId !== roomId &&
			connection !== "closed",
		enter,
		snapshot,
		self,
		connection,
		nickname,
		error: currentScope ? (errorState?.message ?? "") : "",
		startPending,
		nextPending,
		candidatesPending,
		votePendingDrawId,
		clockOffset,
		serverNow,
		rename,
		sendChat,
		startDraw,
		nextRound,
		updateCandidates,
		vote,
		reconnect,
		clearError,
	};
}
