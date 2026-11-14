import {
	Check,
	ChevronUp,
	Copy,
	Crown,
	Pause,
	Pencil,
	Play,
	Send,
	Users,
	Wifi,
	WifiOff,
	X,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import CopyFallback from "@/components/features/CopyFallback";
import { LunchWheel } from "@/components/features/LunchWheel";
import {
	RoomEditableCandidateList,
	RoomReadonlyCandidateList,
	roomCandidateNumbers,
} from "@/components/features/RoomCandidateList";
import RoomDrawDialog, {
	roomDrawCopyText,
} from "@/components/features/RoomDrawDialog";
import RoomDrawResult from "@/components/features/RoomDrawResult";
import RoomEntryGate from "@/components/features/RoomEntryGate";
import SiteHeader from "@/components/layout/SiteHeader";
import { useLunchRoom } from "@/hooks/useLunchRoom";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import {
	type LunchCategory,
	lunchCategories,
	sampleLunchPlaces,
} from "@/lib/lunch";
import {
	type ChatMessage,
	lunchRoomLimits,
	type RoomDraw,
} from "@/lib/lunchRoom";
import {
	clearRoomCandidates,
	createRoomCandidateSelection,
	getRoomCandidateIds,
	type RoomCandidateSelection,
	selectAllRoomCandidateCategories,
	selectAllRoomCandidates,
	setRoomCandidateIncluded,
	toggleRoomCandidateCategory,
} from "@/lib/roomCandidateSelection";
import { getSourceDisplayName } from "@/services/randomService";
import "./lunch-room.css";
import "./lunch-room-mobile.css";

type RoomView = "wheel" | "history";
type CopyKind = "invite" | `history:${string}`;
const presenceLabels = {
	online: "온라인",
	away: "자리비움",
	offline: "오프라인",
} as const;

function sameMessageGroup(left?: ChatMessage, right?: ChatMessage) {
	return Boolean(
		left &&
			right &&
			!left.event &&
			!right.event &&
			left.participantId !== "system" &&
			right.participantId !== "system" &&
			left.participantId === right.participantId &&
			left.name === right.name &&
			Math.floor(left.timestamp / 60000) ===
				Math.floor(right.timestamp / 60000),
	);
}

export default function LunchRoomPage({
	roomId,
	asGuest = false,
}: {
	roomId: string;
	asGuest?: boolean;
}) {
	const id = useId();
	const room = useLunchRoom(roomId, asGuest, { requireEntry: true });
	const [view, setView] = useState<RoomView>("wheel");
	const [message, setMessage] = useState("");
	const [nameDraft, setNameDraft] = useState("");
	const [nameError, setNameError] = useState("");
	const [chatPopover, setChatPopover] = useState<"profile" | "members" | null>(
		null,
	);
	const editingName = chatPopover === "profile";
	const [connectionEvents, setConnectionEvents] = useState<ChatMessage[]>([]);
	const [candidateSelection, setCandidateSelection] =
		useState<RoomCandidateSelection>(clearRoomCandidates);
	const [guestCategories, setGuestCategories] =
		useState<readonly LunchCategory[]>(lunchCategories);
	const [candidateError, setCandidateError] = useState("");
	const [motionOff, setMotionOff] = useState(false);
	const [reducedMotion, setReducedMotion] = useState(false);
	const [unread, setUnread] = useState(0);
	const [copied, setCopied] = useState<CopyKind | null>(null);
	const [copyHelp, setCopyHelp] = useState<{
		kind: CopyKind;
		text: string;
	} | null>(null);
	const [inviteUrl, setInviteUrl] = useState("");
	const [selectedDraw, setSelectedDraw] = useState<RoomDraw | null>(null);
	const roomViewportRef = useRef<HTMLDivElement>(null);
	const primaryColumnRef = useRef<HTMLDivElement>(null);
	const selectedDrawTriggerRef = useRef<HTMLButtonElement>(null);
	const rotorRef = useRef<HTMLDivElement>(null);
	const drawButtonRef = useRef<HTMLButtonElement>(null);
	const resultTitleRef = useRef<HTMLHeadingElement>(null);
	const historyTitleRef = useRef<HTMLHeadingElement>(null);
	const terminalTitleRef = useRef<HTMLHeadingElement>(null);
	const nicknameRef = useRef<HTMLInputElement>(null);
	const nicknameButtonRef = useRef<HTMLButtonElement>(null);
	const profilePopoverRef = useRef<HTMLElement>(null);
	const membersPopoverRef = useRef<HTMLElement>(null);
	const membersButtonRef = useRef<HTMLButtonElement>(null);
	const membersTitleRef = useRef<HTMLHeadingElement>(null);
	const chatInputRef = useRef<HTMLTextAreaElement>(null);
	const composingRef = useRef(false);
	const restoreNicknameFocusRef = useRef(false);
	const connectionEventIdRef = useRef(0);
	const connectionStateRef = useRef({
		roomId,
		wasConnected: false,
		previous: room.connection,
	});
	const chatListRef = useRef<HTMLUListElement>(null);
	const nearBottomRef = useRef(true);
	const previousMessagesRef = useRef(new Set<string>());
	const ownParticipantIdsRef = useRef(new Set<string>());
	const ownIdsRoomRef = useRef(roomId);
	const copyAttemptRef = useRef(0);
	const copyReturnRef = useRef<HTMLButtonElement | null>(null);
	const restoreCopyFocusRef = useRef(false);
	const focusResultRef = useRef(false);
	const expectedVersionRef = useRef<number | null>(null);
	const submittedCandidateIdsRef = useRef<string | null>(null);
	const candidateDraftIdsRef = useRef("");
	const observedCandidatesRef = useRef<{
		roomId: string;
		version: number;
		ids: string;
	} | null>(null);
	const candidateTitleRef = useRef<HTMLHeadingElement>(null);
	const snapshot = room.snapshot;
	const draw = snapshot?.draw ?? null;
	const drawMatchesCandidates = draw?.listVersion === snapshot?.listVersion;
	const drawArchived =
		snapshot?.history.some((entry) => entry.id === draw?.id) ?? false;
	const fetching = room.startPending || snapshot?.status === "fetching";
	const displayedDraw =
		fetching ||
		room.connection === "closed" ||
		(!drawMatchesCandidates && drawArchived)
			? null
			: draw;
	const finished = useRoomTimeline(
		displayedDraw,
		room.clockOffset,
		rotorRef,
		motionOff || reducedMotion,
	);
	const showResult = Boolean(displayedDraw && finished);
	const spinning = Boolean(displayedDraw && !finished);
	const busy = fetching || spinning || room.nextPending;
	const connected = room.connection === "connected";
	const isHost = connected && room.self?.isHost === true;
	const places =
		(drawMatchesCandidates ? displayedDraw?.candidates : undefined) ??
		snapshot?.candidates ??
		[];
	const winner =
		displayedDraw && finished
			? displayedDraw.candidates[displayedDraw.winnerIndex]
			: null;
	const participants = snapshot?.participants ?? [];
	const members =
		snapshot?.members ??
		participants.map((participant) => ({
			...participant,
			status: "online" as const,
		}));
	const selfPresence = connected
		? (members.find((member) => member.id === room.self?.id)?.status ??
			"online")
		: "offline";
	const selfPresenceLabel = connected
		? presenceLabels[selfPresence]
		: room.connection === "reconnecting"
			? "재연결 중"
			: "연결 중";
	const serverMessages = snapshot?.messages;
	const messages = useMemo(
		() =>
			[...(serverMessages ?? []), ...connectionEvents]
				.sort((left, right) => left.timestamp - right.timestamp)
				.slice(-lunchRoomLimits.maxMessages),
		[serverMessages, connectionEvents],
	);
	const hostOnline = participants.some((participant) => participant.isHost);
	const canStart =
		isHost && !busy && !room.candidatesPending && places.length >= 2;
	const candidateVersion = snapshot?.listVersion;
	const candidateRoomId = snapshot?.roomId;
	const actualCandidateIds = getRoomCandidateIds(
		createRoomCandidateSelection(
			snapshot?.candidates.map((place) => place.id) ?? [],
		),
	).join(",");
	const serverCandidateSelection = useMemo(
		() =>
			createRoomCandidateSelection(
				actualCandidateIds ? actualCandidateIds.split(",") : [],
			),
		[actualCandidateIds],
	);
	// Show the approved candidates on the first room paint, before the effect syncs the editable draft.
	const displayedSelection =
		observedCandidatesRef.current?.roomId === roomId
			? candidateSelection
			: serverCandidateSelection;
	const candidateIds = useMemo(
		() => getRoomCandidateIds(displayedSelection),
		[displayedSelection],
	);
	const candidateDraftIds = candidateIds.join(",");
	const candidatesChanged = actualCandidateIds !== candidateDraftIds;
	const candidateControlsDisabled = busy || room.candidatesPending || !isHost;
	const visibleCandidates = useMemo(
		() =>
			sampleLunchPlaces.filter((place) =>
				displayedSelection.categories.includes(place.category),
			),
		[displayedSelection.categories],
	);
	const guestVisibleCandidates = (snapshot?.candidates ?? []).filter((place) =>
		guestCategories.includes(place.category),
	);
	const completedHistory = (snapshot?.history ?? [])
		.filter((entry) => room.serverNow() >= entry.startedAt + entry.durationMs)
		.slice(0, lunchRoomLimits.maxHistory);
	const closed = room.connection === "closed";
	useEffect(() => {
		const root = roomViewportRef.current;
		const viewport = window.visualViewport;
		if (
			!root ||
			!viewport ||
			closed ||
			room.waitingForEntry ||
			room.entryPending
		)
			return;
		function updateViewportHeight() {
			if (viewport?.scale === 1) {
				root?.style.setProperty(
					"--room-viewport-height",
					`${viewport.height}px`,
				);
				if (root) {
					if (viewport.height < 500) root.dataset.compactViewport = "true";
					else delete root.dataset.compactViewport;
				}
			} else {
				root?.style.removeProperty("--room-viewport-height");
				if (root) delete root.dataset.compactViewport;
			}
		}
		updateViewportHeight();
		viewport.addEventListener("resize", updateViewportHeight);
		return () => {
			viewport.removeEventListener("resize", updateViewportHeight);
			root.style.removeProperty("--room-viewport-height");
			delete root.dataset.compactViewport;
		};
	}, [closed, room.waitingForEntry, room.entryPending]);
	const setCandidateIncluded = useCallback(
		(placeId: string, included: boolean) => {
			setCandidateSelection((previous) =>
				setRoomCandidateIncluded(previous, placeId, included),
			);
			setCandidateError("");
		},
		[],
	);

	useEffect(() => {
		setInviteUrl(
			new URL(`/lunch-room/${roomId}`, window.location.origin).toString(),
		);
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(media.matches);
		update();
		media.addEventListener("change", update);
		return () => {
			media.removeEventListener("change", update);
			copyAttemptRef.current++;
		};
	}, [roomId]);
	useEffect(() => setNameDraft(room.nickname), [room.nickname]);
	useEffect(() => {
		if (ownIdsRoomRef.current !== roomId) {
			ownIdsRoomRef.current = roomId;
			ownParticipantIdsRef.current.clear();
		}
		if (snapshot?.roomId === roomId && room.self?.id)
			ownParticipantIdsRef.current.add(room.self.id);
		for (const participantId of ownParticipantIdsRef.current)
			if (
				participantId !== room.self?.id &&
				!serverMessages?.some((entry) => entry.participantId === participantId)
			)
				ownParticipantIdsRef.current.delete(participantId);
	}, [roomId, room.self?.id, snapshot?.roomId, serverMessages]);
	useEffect(() => {
		if (editingName) {
			nicknameRef.current?.focus();
			nicknameRef.current?.select();
		} else if (restoreNicknameFocusRef.current) {
			restoreNicknameFocusRef.current = false;
			nicknameButtonRef.current?.focus();
		}
	}, [editingName]);
	useEffect(() => {
		if (!chatPopover) return;
		const panel =
			chatPopover === "profile"
				? profilePopoverRef.current
				: membersPopoverRef.current;
		const trigger =
			chatPopover === "profile"
				? nicknameButtonRef.current
				: membersButtonRef.current;
		if (chatPopover === "members") membersTitleRef.current?.focus();
		function outside(event: PointerEvent) {
			if (
				!(event.target instanceof Node) ||
				panel?.contains(event.target) ||
				trigger?.contains(event.target)
			)
				return;
			setChatPopover(null);
			trigger?.focus();
		}
		function handleEscape(event: KeyboardEvent) {
			if (event.key !== "Escape" || event.isComposing) return;
			event.preventDefault();
			event.stopPropagation();
			setChatPopover(null);
			trigger?.focus();
		}
		function focusOutside(event: FocusEvent) {
			if (
				event.target instanceof Node &&
				!panel?.contains(event.target) &&
				!trigger?.contains(event.target)
			)
				setChatPopover(null);
		}
		document.addEventListener("pointerdown", outside, true);
		document.addEventListener("keydown", handleEscape, true);
		document.addEventListener("focusin", focusOutside);
		return () => {
			document.removeEventListener("pointerdown", outside, true);
			document.removeEventListener("keydown", handleEscape, true);
			document.removeEventListener("focusin", focusOutside);
		};
	}, [chatPopover]);
	useEffect(() => {
		const field = chatInputRef.current;
		if (!field) return;
		if (!message) {
			field.style.height = "38px";
			return;
		}
		field.style.height = "0px";
		field.style.height = `${Math.min(96, Math.max(38, field.scrollHeight))}px`;
	}, [message]);
	useEffect(() => {
		const state = connectionStateRef.current;
		if (state.roomId !== roomId) {
			state.roomId = roomId;
			state.wasConnected = false;
			setConnectionEvents([]);
		}
		if (snapshot?.roomId !== roomId) return;
		let text: string | undefined;
		if (
			room.connection === "reconnecting" &&
			state.wasConnected &&
			state.previous !== "reconnecting"
		)
			text = "연결이 끊겼습니다. 다시 연결하고 있습니다.";
		if (room.connection === "connected") {
			if (state.wasConnected && state.previous === "reconnecting")
				text = "다시 연결되었습니다.";
			state.wasConnected = true;
		}
		state.previous = room.connection;
		if (text) {
			const entry: ChatMessage = {
				id: `local-connection-${++connectionEventIdRef.current}`,
				name: "시스템",
				participantId: "system",
				text,
				timestamp: Date.now() + room.clockOffset,
			};
			setConnectionEvents((entries) => [...entries, entry].slice(-10));
		}
	}, [room.connection, roomId, snapshot?.roomId, room.clockOffset]);
	useEffect(() => {
		if (observedCandidatesRef.current?.roomId === roomId) return;
		expectedVersionRef.current = null;
		submittedCandidateIdsRef.current = null;
		observedCandidatesRef.current = null;
		setGuestCategories(lunchCategories);
	}, [roomId]);
	useEffect(() => {
		candidateDraftIdsRef.current = candidateDraftIds;
	}, [candidateDraftIds]);
	useEffect(() => {
		if (candidateVersion === undefined || candidateRoomId !== roomId) return;
		const previous = observedCandidatesRef.current;
		if (
			previous?.roomId === roomId &&
			previous.version === candidateVersion &&
			previous.ids === actualCandidateIds
		)
			return;
		const ownAcknowledgement =
			previous?.roomId === roomId &&
			!room.error &&
			expectedVersionRef.current !== null &&
			candidateVersion >= expectedVersionRef.current &&
			submittedCandidateIdsRef.current === actualCandidateIds &&
			candidateDraftIdsRef.current === actualCandidateIds;
		if (!ownAcknowledgement) setCandidateSelection(serverCandidateSelection);
		if (previous?.roomId !== roomId) setGuestCategories(lunchCategories);
		observedCandidatesRef.current = {
			roomId,
			version: candidateVersion,
			ids: actualCandidateIds,
		};
		expectedVersionRef.current = null;
		submittedCandidateIdsRef.current = null;
		setCandidateError("");
	}, [
		actualCandidateIds,
		serverCandidateSelection,
		candidateVersion,
		roomId,
		candidateRoomId,
		room.error,
	]);
	useEffect(() => {
		if (!room.candidatesPending && room.error) {
			expectedVersionRef.current = null;
			submittedCandidateIdsRef.current = null;
		}
	}, [room.candidatesPending, room.error]);
	useEffect(() => {
		if (
			showResult &&
			!selectedDraw &&
			focusResultRef.current &&
			view === "wheel"
		) {
			resultTitleRef.current?.focus();
			focusResultRef.current = false;
		}
	}, [showResult, view, selectedDraw]);
	const focusNextRoundRef = useRef(false);
	useEffect(() => {
		if (
			focusNextRoundRef.current &&
			!draw &&
			!room.nextPending &&
			view === "wheel"
		) {
			focusNextRoundRef.current = false;
			drawButtonRef.current?.focus();
		}
	}, [draw, room.nextPending, view]);
	useEffect(() => {
		if (view === "history") historyTitleRef.current?.focus();
	}, [view]);
	useEffect(() => {
		if (!copyHelp && restoreCopyFocusRef.current) {
			restoreCopyFocusRef.current = false;
			copyReturnRef.current?.focus();
		}
	}, [copyHelp]);
	useEffect(() => {
		if (closed) {
			setSelectedDraw(null);
			copyAttemptRef.current++;
			setCopyHelp(null);
			terminalTitleRef.current?.focus();
		}
	}, [closed]);
	useEffect(() => {
		const previous = previousMessagesRef.current;
		const added = messages.filter((entry) => !previous.has(entry.id)).length;
		previousMessagesRef.current = new Set(messages.map((entry) => entry.id));
		const list = chatListRef.current;
		if (!list) return;
		if (nearBottomRef.current) {
			list.scrollTop = list.scrollHeight;
			setUnread(0);
		} else if (added > 0) setUnread((count) => count + added);
	}, [messages]);
	useEffect(() => {
		const list = chatListRef.current;
		if (
			!list ||
			closed ||
			room.waitingForEntry ||
			room.entryPending ||
			typeof ResizeObserver === "undefined"
		)
			return;
		const observer = new ResizeObserver(() => {
			if (!nearBottomRef.current) return;
			list.scrollTop = list.scrollHeight;
			setUnread(0);
		});
		observer.observe(list);
		return () => observer.disconnect();
	}, [closed, room.waitingForEntry, room.entryPending]);
	function changeView(next: RoomView) {
		setSelectedDraw(null);
		focusResultRef.current = false;
		copyAttemptRef.current++;
		setCopyHelp(null);
		setView(next);
		if (primaryColumnRef.current) primaryColumnRef.current.scrollTop = 0;
	}
	function keepChatFocus() {
		focusResultRef.current = false;
		focusNextRoundRef.current = false;
	}
	function openRecord(draw: RoomDraw, trigger: HTMLButtonElement) {
		focusResultRef.current = false;
		setChatPopover(null);
		selectedDrawTriggerRef.current = trigger;
		setSelectedDraw({
			...draw,
			candidates: draw.candidates.map((place) => ({ ...place })),
			...(draw.participants === undefined
				? {}
				: {
						participants: draw.participants.map((participant) => ({
							...participant,
						})),
					}),
			...(draw.probabilities === undefined
				? {}
				: { probabilities: [...draw.probabilities] }),
			...(draw.votes === undefined
				? {}
				: { votes: draw.votes.map((vote) => ({ ...vote })) }),
		});
	}
	function candidateCategoryButtons(readOnly: boolean) {
		const categories = readOnly
			? guestCategories
			: displayedSelection.categories;
		return (
			<fieldset
				className="room-candidate-categories"
				disabled={!readOnly && candidateControlsDisabled}
			>
				<legend className="sr-only">
					{readOnly ? "목록 보기 분류" : "추첨 후보 분류"}
				</legend>
				{(["전체", ...lunchCategories] as const).map((category) => (
					<button
						key={category}
						type="button"
						aria-pressed={
							category === "전체"
								? lunchCategories.every((item) => categories.includes(item))
								: categories.includes(category)
						}
						onClick={() => {
							if (readOnly)
								setGuestCategories((previous) =>
									category === "전체"
										? lunchCategories
										: previous.includes(category)
											? previous.filter((item) => item !== category)
											: [...previous, category],
								);
							else {
								setCandidateSelection((previous) =>
									category === "전체"
										? selectAllRoomCandidateCategories(previous)
										: toggleRoomCandidateCategory(previous, category),
								);
								setCandidateError("");
							}
						}}
					>
						{category}
					</button>
				))}
			</fieldset>
		);
	}
	function start() {
		if (!room.startDraw()) return;
		copyAttemptRef.current++;
		setCopyHelp(null);
		setCopied(null);
		setView("wheel");
		focusResultRef.current = true;
	}
	function nextRound() {
		if (displayedDraw && room.nextRound(displayedDraw.id)) {
			focusNextRoundRef.current = true;
			copyAttemptRef.current++;
			setCopyHelp(null);
			setCopied(null);
		}
	}
	function submitChat() {
		if (room.sendChat(message)) {
			setMessage("");
			nearBottomRef.current = true;
			setUnread(0);
		}
	}
	async function copy(
		text: string,
		kind: CopyKind,
		trigger?: HTMLButtonElement,
	) {
		const attempt = ++copyAttemptRef.current;
		if (trigger) copyReturnRef.current = trigger;
		setCopied(null);
		try {
			await navigator.clipboard.writeText(text);
			if (attempt !== copyAttemptRef.current) return;
			setCopied(kind);
			if (copyHelp) {
				restoreCopyFocusRef.current = true;
			} else copyReturnRef.current?.focus();
			setCopyHelp(null);
		} catch {
			if (attempt !== copyAttemptRef.current) return;
			setCopyHelp({ text, kind });
		}
	}
	const status =
		room.connection === "closed"
			? "방 이용 종료"
			: room.connection === "reconnecting"
				? "다시 연결 중"
				: !connected
					? "방에 연결 중"
					: fetching
						? "방장이 추첨을 시작했습니다. 난수를 가져오고 있습니다."
						: spinning
							? "같은 룰렛을 함께 보고 있습니다. 멈추면 결과를 공개합니다."
							: winner
								? `추첨 결과: ${winner.name}`
								: isHost
									? "참가자가 모이면 가운데 버튼으로 추첨을 시작하세요."
									: hostOnline
										? "방장이 추첨을 시작하면 함께 룰렛을 봅니다."
										: "방장이 오프라인입니다. 방장이 돌아오면 추첨을 시작할 수 있습니다.";

	if (!closed && (room.waitingForEntry || room.entryPending))
		return (
			<div className="random-lab lunch-room">
				<SiteHeader active="lunch" />
				<main id="main-content" className="room-entry-main">
					<RoomEntryGate
						key={roomId}
						roomId={roomId}
						pending={room.entryPending}
						error={room.error}
						onEnter={room.enter}
						onClearError={room.clearError}
					/>
				</main>
			</div>
		);

	return (
		<div
			ref={roomViewportRef}
			className={`random-lab lunch-room${closed ? "" : " room-live"}`}
		>
			<SiteHeader active="lunch" />
			<main id="main-content" className="room-main">
				<div className="room-heading">
					<div>
						<h1>
							{closed ? "점심 추첨방" : (snapshot?.title ?? "점심 추첨방")}
						</h1>
					</div>
					{!closed && (
						<button
							type="button"
							className="room-outline-button"
							disabled={!inviteUrl}
							onClick={(event) =>
								void copy(inviteUrl, "invite", event.currentTarget)
							}
						>
							{copied === "invite" ? (
								<Check size={17} aria-hidden="true" />
							) : (
								<Copy size={17} aria-hidden="true" />
							)}
							{copied === "invite" ? "링크 복사됨" : "초대 링크 복사"}
						</button>
					)}
				</div>
				{closed ? (
					<section className="room-terminal" aria-labelledby={`${id}-terminal`}>
						<h2 id={`${id}-terminal`} ref={terminalTitleRef} tabIndex={-1}>
							{snapshot?.status === "closed" ||
							(snapshot && room.serverNow() >= snapshot.expiresAt)
								? "이 방의 이용이 끝났습니다"
								: "방에 참가할 수 없습니다"}
						</h2>
						<p>
							{room.error || "방이 만료되었거나 더 이상 이용할 수 없습니다."}
						</p>
						<a className="generate-button" href="/create">
							새 방 만들기
						</a>
						<a className="room-outline-button" href="/solo">
							혼자 추첨하기
						</a>
					</section>
				) : (
					<>
						<div className="room-connection" data-connected={connected}>
							{connected ? (
								<Wifi size={15} aria-hidden="true" />
							) : (
								<WifiOff size={15} aria-hidden="true" />
							)}
							<span>
								{connected
									? "실시간 연결됨"
									: room.connection === "reconnecting"
										? "연결 끊김 · 다시 연결 중"
										: "연결 중"}
							</span>
							<span>참가 {participants.length}명</span>
							{room.self?.isHost && (
								<span className="room-host-badge">
									<Crown size={13} aria-hidden="true" /> 방장
								</span>
							)}
							{!connected && (
								<button
									type="button"
									className="text-button"
									onClick={room.reconnect}
								>
									다시 연결
								</button>
							)}
						</div>
						{snapshot && (
							<div className="room-lifetime">
								<span>
									생성{" "}
									<time dateTime={new Date(snapshot.createdAt).toISOString()}>
										{new Date(snapshot.createdAt).toLocaleString("ko-KR", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</time>
								</span>
								<span>
									종료{" "}
									<time dateTime={new Date(snapshot.expiresAt).toISOString()}>
										{new Date(snapshot.expiresAt).toLocaleString("ko-KR", {
											month: "2-digit",
											day: "2-digit",
											hour: "2-digit",
											minute: "2-digit",
										})}
									</time>
								</span>
								<p>
									방장이 나가도 생성 후 24시간, 표시된 종료 시각까지 방이
									유지됩니다.
								</p>
							</div>
						)}
						{connected && !hostOnline && (
							<p className="room-host-offline">
								방장이 오프라인입니다. 채팅하며 기다릴 수 있고, 방은 종료
								시각까지 유지됩니다.
							</p>
						)}
						<p
							id={`${id}-error`}
							role="alert"
							className={room.error ? "room-error" : "room-empty-error"}
						>
							{room.error}
						</p>
						<div className="room-layout">
							{/* biome-ignore lint/a11y/useSemanticElements: This existing div ref is shared with the record dialog. */}
							<div
								className="room-primary-column"
								role="region"
								aria-label="추첨과 후보 목록"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: The named content pane scrolls independently and needs keyboard access.
								tabIndex={0}
								ref={primaryColumnRef}
								inert={Boolean(selectedDraw)}
							>
								{copyHelp && (
									<section className="room-copy-panel" aria-label="직접 복사">
										<h2>
											{copyHelp.kind === "invite"
												? "초대 링크 직접 복사"
												: "기록 직접 복사"}
										</h2>
										<CopyFallback
											text={copyHelp.text}
											onRetry={() => void copy(copyHelp.text, copyHelp.kind)}
											onClose={() => {
												copyAttemptRef.current++;
												restoreCopyFocusRef.current = true;
												setCopyHelp(null);
											}}
										/>
									</section>
								)}
								<nav className="room-primary-tabs" aria-label="추첨 도구">
									<button
										type="button"
										aria-pressed={view === "wheel"}
										aria-controls={`${id}-draw-panel`}
										onClick={() => changeView("wheel")}
									>
										룰렛
									</button>
									<button
										type="button"
										aria-pressed={view === "history"}
										aria-controls={`${id}-history-panel`}
										onClick={() => changeView("history")}
									>
										결과{" "}
										<span aria-hidden="true">{completedHistory.length}</span>
									</button>
								</nav>
								<section
									id={`${id}-draw-panel`}
									className="room-draw-panel"
									hidden={view !== "wheel"}
									aria-labelledby={`${id}-wheel`}
								>
									<div className="room-panel-heading">
										<h2 id={`${id}-wheel`}>룰렛</h2>
										<span>{places.length}곳 · 같은 확률</span>
									</div>
									<div className="room-wheel-stage">
										<div
											className={`room-wheel-area ${showResult ? "is-covered" : ""}`}
											aria-hidden={showResult || undefined}
										>
											<LunchWheel
												candidates={places}
												candidateNumbers={places.map(
													(place) => roomCandidateNumbers.get(place.id) ?? 0,
												)}
												rotation={
													finished && drawMatchesCandidates
														? (displayedDraw?.toRotation ?? 0)
														: 0
												}
												phase={
													fetching
														? "fetching"
														: spinning
															? "spinning"
															: winner
																? "done"
																: "idle"
												}
												onComplete={() => {}}
												onDraw={start}
												buttonId={`${id}-start`}
												errorId={room.error ? `${id}-error` : undefined}
												covered={!canStart || showResult}
												canDraw={isHost}
												buttonRef={drawButtonRef}
												rotorRef={rotorRef}
												controlled
											/>
										</div>
										{showResult && winner && displayedDraw && (
											<div className="room-result-overlay">
												<RoomDrawResult
													key={displayedDraw.id}
													draw={displayedDraw}
													selfId={room.self?.id}
													isHost={room.self?.isHost === true}
													connected={connected}
													pending={room.votePendingDrawId === displayedDraw.id}
													readOnly={drawArchived}
													nextPending={room.nextPending}
													canNext={
														connected && !busy && !room.candidatesPending
													}
													onNext={nextRound}
													onVote={room.vote}
													titleRef={resultTitleRef}
													titleId={`${id}-winner`}
												/>
											</div>
										)}
									</div>
									<output
										className={showResult ? "sr-only" : "room-draw-status"}
										aria-live="polite"
									>
										{status}
									</output>
									{spinning && !reducedMotion && (
										<button
											type="button"
											className="room-motion-button"
											onClick={() => setMotionOff((off) => !off)}
										>
											{motionOff ? (
												<Play size={14} aria-hidden="true" />
											) : (
												<Pause size={14} aria-hidden="true" />
											)}
											{motionOff ? "애니메이션 켜기" : "애니메이션 끄기"}
										</button>
									)}
									{spinning && reducedMotion && (
										<p className="room-motion-note">
											동작 줄이기 설정을 적용했습니다. 추첨이 끝나면 결과를
											표시합니다.
										</p>
									)}
								</section>
								<section
									id={`${id}-history-panel`}
									className="room-history-panel"
									hidden={view !== "history"}
									aria-labelledby={`${id}-history-title`}
								>
									<div className="room-panel-heading">
										<h2
											id={`${id}-history-title`}
											ref={historyTitleRef}
											tabIndex={-1}
										>
											방 추첨 기록
										</h2>
										<span>최근 {lunchRoomLimits.maxHistory}개</span>
									</div>
									{completedHistory.length === 0 ? (
										<p className="room-panel-note">
											아직 확정된 추첨 기록이 없습니다. 방장이 다음 추첨을
											시작하면 이전 결과와 투표가 기록으로 확정됩니다.
										</p>
									) : (
										<ol className="room-history-list">
											{completedHistory.map((entry) => {
												const place = entry.candidates[entry.winnerIndex];
												const kind: CopyKind = `history:${entry.id}`;
												return (
													<li key={entry.id} className="room-history-item">
														<button
															type="button"
															className="room-history-open"
															aria-expanded={selectedDraw?.id === entry.id}
															aria-label={`${place.name} 상세 기록 열기`}
															aria-haspopup="dialog"
															onClick={(event) =>
																openRecord(entry, event.currentTarget)
															}
														>
															<strong>{place.name}</strong>
															<span>{place.category}</span>
															<span>
																{entry.candidates.length}곳 중 추첨 ·{" "}
																{getSourceDisplayName(entry.source)}
															</span>
															<time
																dateTime={new Date(
																	entry.timestamp,
																).toISOString()}
															>
																{new Date(entry.timestamp).toLocaleString(
																	"ko-KR",
																	{
																		month: "2-digit",
																		day: "2-digit",
																		hour: "2-digit",
																		minute: "2-digit",
																	},
																)}
															</time>
															<span className="room-history-detail-hint">
																상세 보기 →
															</span>
															{entry.votes && (
																<span>
																	좋아요{" "}
																	{
																		entry.votes.filter(
																			(vote) => vote.vote === "up",
																		).length
																	}{" "}
																	· 싫어요{" "}
																	{
																		entry.votes.filter(
																			(vote) => vote.vote === "down",
																		).length
																	}
																</span>
															)}
														</button>
														<button
															type="button"
															className="room-outline-button room-history-copy"
															aria-label={`${place.name} 기록 ${copied === kind ? "복사됨" : "복사"}`}
															onClick={(event) =>
																void copy(
																	roomDrawCopyText(entry),
																	kind,
																	event.currentTarget,
																)
															}
														>
															{copied === kind ? (
																<Check size={15} aria-hidden="true" />
															) : (
																<Copy size={15} aria-hidden="true" />
															)}
															{copied === kind ? "복사됨" : "복사"}
														</button>
													</li>
												);
											})}
										</ol>
									)}
								</section>
								<section
									className="room-candidates-panel"
									aria-labelledby={`${id}-candidates`}
								>
									{isHost ? (
										<form
											className="room-candidate-form"
											onSubmit={(event) => {
												event.preventDefault();
												if (candidateControlsDisabled || !candidatesChanged)
													return;
												setCandidateError("");
												if (candidateIds.length < 2) {
													setCandidateError("음식점을 2곳 이상 선택해 주세요.");
													candidateTitleRef.current?.focus();
													return;
												}
												if (room.updateCandidates(candidateIds)) {
													expectedVersionRef.current =
														(candidateVersion ?? 0) + 1;
													submittedCandidateIdsRef.current = candidateDraftIds;
												}
											}}
										>
											<div className="room-candidate-toolbar">
												<div className="room-candidate-toolbar-heading">
													<h2
														id={`${id}-candidates`}
														ref={candidateTitleRef}
														tabIndex={-1}
														aria-describedby={
															candidateError
																? `${id}-candidate-error`
																: undefined
														}
													>
														추첨 후보
													</h2>
													<span>
														선택 {candidateIds.length}곳 · 적용{" "}
														{snapshot?.candidates.length ?? 0}곳
													</span>
												</div>
												<p className="room-panel-note">
													분류와 음식점을 고른 뒤 후보 적용을 누르세요.
												</p>
												{candidateCategoryButtons(false)}
												<div className="room-candidate-toolbar-actions">
													<button
														type="button"
														className="text-button"
														disabled={candidateControlsDisabled}
														onClick={() => {
															setCandidateSelection(selectAllRoomCandidates());
															setCandidateError("");
														}}
													>
														모두 선택
													</button>
													<button
														type="button"
														className="text-button"
														disabled={candidateControlsDisabled}
														onClick={() => {
															setCandidateSelection(clearRoomCandidates());
															setCandidateError("");
														}}
													>
														선택 해제
													</button>
													<button
														type="button"
														className="room-outline-button"
														disabled={
															candidateControlsDisabled || !candidatesChanged
														}
														onClick={() => {
															expectedVersionRef.current = null;
															submittedCandidateIdsRef.current = null;
															setCandidateSelection(
																createRoomCandidateSelection(
																	actualCandidateIds
																		? actualCandidateIds.split(",")
																		: [],
																),
															);
															setCandidateError("");
														}}
													>
														변경 취소
													</button>
													<button
														type="submit"
														className="generate-button"
														disabled={
															candidateControlsDisabled || !candidatesChanged
														}
														aria-describedby={
															candidateError
																? `${id}-candidate-error`
																: undefined
														}
													>
														{room.candidatesPending
															? "후보 적용 중…"
															: "후보 적용"}
													</button>
												</div>
												<output
													className="room-candidate-feedback"
													aria-live="polite"
												>
													{room.candidatesPending
														? "후보를 적용하고 있습니다."
														: busy
															? "추첨 중에는 후보를 변경할 수 없습니다."
															: candidatesChanged
																? "변경사항 있음"
																: "적용됨"}
												</output>
												<p
													id={`${id}-candidate-error`}
													role="alert"
													className={
														candidateError
															? "room-candidate-feedback room-error"
															: "room-empty-error"
													}
												>
													{candidateError}
												</p>
											</div>
											<fieldset disabled={candidateControlsDisabled}>
												<legend className="sr-only">
													함께 추첨할 음식점 선택
												</legend>
												<RoomEditableCandidateList
													places={visibleCandidates}
													selectedIds={candidateIds}
													onIncludedChange={setCandidateIncluded}
												/>
											</fieldset>
											{visibleCandidates.length === 0 && (
												<p className="room-candidate-empty">
													선택한 분류의 음식점이 없습니다. 분류를 하나 이상 켜
													주세요.
												</p>
											)}
										</form>
									) : (
										<>
											<div className="room-candidate-toolbar">
												<div className="room-candidate-toolbar-heading">
													<h2 id={`${id}-candidates`}>추첨 후보</h2>
													<span>
														표시 {guestVisibleCandidates.length}곳 · 실제 추첨{" "}
														{snapshot?.candidates.length ?? 0}곳
													</span>
												</div>
												<p className="room-candidate-feedback">
													목록 보기 필터입니다. 실제 추첨 대상은 바뀌지
													않습니다.
												</p>
												{candidateCategoryButtons(true)}
											</div>
											<RoomReadonlyCandidateList
												places={guestVisibleCandidates}
											/>
											{guestVisibleCandidates.length === 0 && (
												<p className="room-candidate-empty">
													선택한 분류의 후보가 없습니다. 다른 분류를 켜 보세요.
												</p>
											)}
										</>
									)}
								</section>
							</div>
							<aside
								className="room-chat-panel"
								aria-labelledby={`${id}-chat`}
								onFocusCapture={keepChatFocus}
								onPointerDownCapture={keepChatFocus}
							>
								<div className="room-chat-header">
									<h2 id={`${id}-chat`}>채팅</h2>
									<button
										type="button"
										ref={membersButtonRef}
										className="room-chat-members-button"
										aria-label={`참가자 ${members.length}명`}
										aria-expanded={chatPopover === "members"}
										aria-controls={`${id}-members-popover`}
										onClick={() =>
											setChatPopover((open) =>
												open === "members" ? null : "members",
											)
										}
									>
										<Users
											size={15}
											strokeWidth={2}
											absoluteStrokeWidth
											aria-hidden="true"
										/>
										<span>{members.length}</span>
									</button>
									{chatPopover === "members" && (
										<section
											id={`${id}-members-popover`}
											ref={membersPopoverRef}
											className="room-chat-popover room-members-popover"
											role="dialog"
											aria-labelledby={`${id}-members-title`}
										>
											<div className="room-popover-heading">
												<h3
													id={`${id}-members-title`}
													ref={membersTitleRef}
													tabIndex={-1}
												>
													참가자
												</h3>
												<button
													type="button"
													className="room-chat-icon-button"
													aria-label="참가자 목록 닫기"
													onClick={() => {
														setChatPopover(null);
														membersButtonRef.current?.focus();
													}}
												>
													<X size={16} aria-hidden="true" />
												</button>
											</div>
											<p className="room-roster-summary">
												접속 {participants.length}명 · 전체 {members.length}명
											</p>
											{!connected && (
												<p className="room-roster-note">
													연결이 끊겨 마지막으로 받은 상태를 표시합니다.
												</p>
											)}
											<ul className="room-member-list">
												{members.map((member) => (
													<li key={member.id}>
														<span
															className="room-presence-dot"
															data-status={member.status}
															aria-hidden="true"
														/>
														<div>
															<strong>{member.name}</strong>
															{member.id === room.self?.id && <small>나</small>}
															{member.isHost && (
																<Crown size={12} aria-label="방장" />
															)}
														</div>
														<span className="room-member-status">
															{presenceLabels[member.status]}
														</span>
													</li>
												))}
											</ul>
											<p className="room-roster-note">
												5분 동안 활동이 없으면 자리비움으로 표시됩니다.
											</p>
										</section>
									)}
								</div>
								<ul
									className="room-chat-list"
									ref={chatListRef}
									role="log"
									aria-label="방 채팅 메시지"
									aria-live="polite"
									aria-relevant="additions"
									// biome-ignore lint/a11y/noNoninteractiveTabindex: The chat log scrolls independently and needs keyboard access.
									tabIndex={0}
									onScroll={(event) => {
										const list = event.currentTarget;
										nearBottomRef.current =
											list.scrollHeight - list.scrollTop - list.clientHeight <
											48;
										if (nearBottomRef.current) setUnread(0);
									}}
								>
									{messages.map((entry, index) => {
										if (entry.event || entry.participantId === "system")
											return (
												<li key={entry.id} className="room-chat-system">
													<p>{entry.text}</p>
													<time
														dateTime={new Date(entry.timestamp).toISOString()}
													>
														{new Date(entry.timestamp).toLocaleTimeString(
															"ko-KR",
															{ hour: "2-digit", minute: "2-digit" },
														)}
													</time>
												</li>
											);
										const mine =
											entry.participantId === room.self?.id ||
											(ownIdsRoomRef.current === roomId &&
												ownParticipantIdsRef.current.has(entry.participantId));
										const continuation = sameMessageGroup(
											messages[index - 1],
											entry,
										);
										const lastInGroup = !sameMessageGroup(
											entry,
											messages[index + 1],
										);
										return (
											<li
												key={entry.id}
												className={`room-chat-bubble ${mine ? "is-mine" : "is-other"} ${continuation ? "is-continuation" : ""}`}
											>
												{!continuation ? (
													<strong className="room-message-author">
														{entry.name}
													</strong>
												) : (
													<span className="sr-only">
														{entry.name}의 메시지:{" "}
													</span>
												)}
												<div className="room-message-row">
													<p className="room-message-content">{entry.text}</p>
													{lastInGroup && (
														<time
															className="room-message-time"
															dateTime={new Date(entry.timestamp).toISOString()}
														>
															{new Date(entry.timestamp).toLocaleTimeString(
																"ko-KR",
																{ hour: "2-digit", minute: "2-digit" },
															)}
														</time>
													)}
												</div>
											</li>
										);
									})}
									{messages.length === 0 && (
										<li className="room-chat-empty">
											함께 먹고 싶은 메뉴를 이야기해 보세요.
										</li>
									)}
								</ul>
								{unread > 0 && (
									<button
										type="button"
										className="room-new-messages"
										onClick={() => {
											const list = chatListRef.current;
											if (list) list.scrollTop = list.scrollHeight;
											nearBottomRef.current = true;
											setUnread(0);
										}}
									>
										새 메시지 {unread}개 보기
									</button>
								)}
								<form
									className="room-chat-form"
									onSubmit={(event) => {
										event.preventDefault();
										submitChat();
									}}
								>
									<label className="sr-only" htmlFor={`${id}-message`}>
										메시지
									</label>
									<div className="room-composer-row">
										<textarea
											id={`${id}-message`}
											ref={chatInputRef}
											value={message}
											maxLength={500}
											rows={1}
											disabled={!connected}
											aria-describedby={`${id}-composer-help`}
											onChange={(event) => setMessage(event.target.value)}
											onCompositionStart={() => {
												composingRef.current = true;
											}}
											onCompositionEnd={() => {
												composingRef.current = false;
											}}
											onKeyDown={(event) => {
												if (
													event.key === "Enter" &&
													!event.shiftKey &&
													!composingRef.current &&
													!event.nativeEvent.isComposing &&
													event.nativeEvent.keyCode !== 229
												) {
													event.preventDefault();
													submitChat();
												}
											}}
											placeholder={
												connected ? "메시지 보내기" : "연결을 기다리는 중…"
											}
										/>
										<button
											type="submit"
											className="room-send-button"
											aria-label="메시지 보내기"
											disabled={!connected || !message.trim()}
										>
											<Send
												size={18}
												strokeWidth={2}
												absoluteStrokeWidth
												aria-hidden="true"
											/>
										</button>
									</div>
									<div className="room-composer-meta">
										<span id={`${id}-composer-help`}>
											Enter 전송 · Shift+Enter 줄바꿈
										</span>
										<span>{message.length}/500</span>
									</div>
								</form>
								<div className="room-chat-footer">
									<button
										type="button"
										ref={nicknameButtonRef}
										className="room-profile-trigger"
										aria-label={`내 프로필: ${room.nickname || "참가자"}, ${selfPresenceLabel}`}
										aria-expanded={editingName}
										aria-controls={`${id}-profile-popover`}
										onClick={() => {
											if (editingName) {
												setChatPopover(null);
												return;
											}
											setNameDraft(room.nickname);
											setNameError("");
											setChatPopover("profile");
										}}
									>
										<span className="room-profile-avatar" aria-hidden="true">
											{Array.from(room.nickname || "참가자")[0]}
											<span
												className="room-presence-dot"
												data-status={selfPresence}
											/>
										</span>
										<span className="room-profile-text">
											<strong>{room.nickname || "참가자"}</strong>
											<small>{selfPresenceLabel}</small>
										</span>
										<ChevronUp size={15} aria-hidden="true" />
									</button>
									{editingName && (
										<section
											id={`${id}-profile-popover`}
											ref={profilePopoverRef}
											className="room-chat-popover room-profile-popover"
											role="dialog"
											aria-labelledby={`${id}-profile-title`}
										>
											<div className="room-popover-heading">
												<h3 id={`${id}-profile-title`}>
													<Pencil size={14} aria-hidden="true" /> 내 프로필
												</h3>
												<button
													type="button"
													className="room-chat-icon-button"
													aria-label="프로필 닫기"
													onClick={() => {
														restoreNicknameFocusRef.current = true;
														setChatPopover(null);
													}}
												>
													<X size={16} aria-hidden="true" />
												</button>
											</div>
											<form
												className="room-name-form"
												onSubmit={(event) => {
													event.preventDefault();
													const value = nameDraft.trim();
													if (
														!value ||
														value.length > lunchRoomLimits.maxNicknameLength
													) {
														setNameError(
															`닉네임을 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`,
														);
														nicknameRef.current?.focus();
														return;
													}
													setNameError("");
													if (room.rename(value)) {
														restoreNicknameFocusRef.current = true;
														setChatPopover(null);
													}
												}}
											>
												<label htmlFor={`${id}-name`}>닉네임</label>
												<span className="room-name-count">
													{nameDraft.length}/{lunchRoomLimits.maxNicknameLength}
												</span>
												<input
													id={`${id}-name`}
													ref={nicknameRef}
													autoComplete="nickname"
													maxLength={lunchRoomLimits.maxNicknameLength}
													value={nameDraft}
													disabled={!connected}
													aria-invalid={Boolean(nameError)}
													aria-describedby={
														nameError ? `${id}-name-error` : undefined
													}
													onChange={(event) => {
														setNameDraft(event.target.value);
														setNameError("");
													}}
												/>
												<p
													id={`${id}-name-error`}
													role="alert"
													className={
														nameError ? "room-error" : "room-empty-error"
													}
												>
													{nameError}
												</p>
												<div className="room-profile-actions">
													<button
														type="submit"
														className="room-profile-save"
														disabled={!connected}
													>
														변경
													</button>
													<button
														type="button"
														className="room-name-cancel"
														onClick={() => {
															setNameDraft(room.nickname);
															setNameError("");
															restoreNicknameFocusRef.current = true;
															setChatPopover(null);
														}}
													>
														취소
													</button>
												</div>
											</form>
											<p className="room-roster-note">
												현재 상태: {selfPresenceLabel}
											</p>
										</section>
									)}
								</div>
							</aside>
						</div>
					</>
				)}
			</main>
			{selectedDraw && !closed && (
				<RoomDrawDialog
					draw={selectedDraw}
					columnRef={primaryColumnRef}
					returnFocusRef={selectedDrawTriggerRef}
					fallbackFocusRef={historyTitleRef}
					chatInputRef={chatInputRef}
					onClose={() => setSelectedDraw(null)}
				/>
			)}
		</div>
	);
}
