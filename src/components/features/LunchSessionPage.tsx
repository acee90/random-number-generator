import {
	ArrowDown,
	Check,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	Copy,
	Crown,
	Info,
	Pencil,
	Send,
	Users,
	Wifi,
	WifiOff,
	X,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import CopyFallback from "@/components/features/CopyFallback";
import { LunchWheel } from "@/components/features/LunchWheel";
import { roomCandidateNumbers } from "@/components/features/RoomCandidateList";
import RoomChatUnreadBadge from "@/components/features/RoomChatUnreadBadge";
import RoomDrawDialog from "@/components/features/RoomDrawDialog";
import RoomDrawResult from "@/components/features/RoomDrawResult";
import RoomEntryGate from "@/components/features/RoomEntryGate";
import RoomLifecyclePanel from "@/components/features/RoomLifecyclePanel";
import RoomSettingsDialog from "@/components/features/RoomSettingsDialog";
import SiteHeader from "@/components/layout/SiteHeader";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LocalChatMessage, useLunchRoom } from "@/hooks/useLunchRoom";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import type { LunchHistoryRecord } from "@/lib/lunchHistory";
import {
	type ChatMessage,
	getEligibleRoomCandidates,
	getRoomPhase,
	lunchRoomLimits,
	type RoomDraw,
} from "@/lib/lunchRoom";
import { getSourceDisplayName } from "@/services/randomService";
import "./lunch-room.css";
import "./lunch-room-mobile.css";

type RoomView = "wheel" | "history";
type CopyKind = "invite";
const presenceLabels = {
	online: "온라인",
	away: "자리비움",
	offline: "오프라인",
} as const;
type DisplayChatMessage = ChatMessage & Partial<LocalChatMessage>;
const noLocalChatMessages: LocalChatMessage[] = [];

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

/** Shared presentation; transports and local session state live in their hooks. */
export default function LunchSessionPage({
	room,
	roomId,
	solo = false,
	legacyHistory = [],
	storageFailed = false,
}: {
	room: ReturnType<typeof useLunchRoom>;
	roomId: string;
	solo?: boolean;
	legacyHistory?: readonly LunchHistoryRecord[];
	storageFailed?: boolean;
}) {
	const id = useId();
	const [view, setView] = useState<RoomView>("wheel");
	const [message, setMessage] = useState("");
	const [chatCollapsed, setChatCollapsed] = useState(false);
	const toggleChat = () => {
		setChatPopover(null);
		setChatCollapsed((value) => !value);
	};

	const [nameDraft, setNameDraft] = useState("");
	const [nameError, setNameError] = useState("");
	const [chatPopover, setChatPopover] = useState<"profile" | "members" | null>(
		null,
	);
	const editingName = chatPopover === "profile";
	const [connectionEvents, setConnectionEvents] = useState<ChatMessage[]>([]);
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
	const historyTriggerRef = useRef<HTMLButtonElement>(null);
	const historyRecordFocusRef = useRef<string | null>(null);
	const terminalTitleRef = useRef<HTMLHeadingElement>(null);
	const nicknameRef = useRef<HTMLInputElement>(null);
	const nicknameButtonRef = useRef<HTMLButtonElement>(null);
	const profilePopoverRef = useRef<HTMLElement>(null);
	const membersPopoverRef = useRef<HTMLElement>(null);
	const membersButtonRef = useRef<HTMLButtonElement>(null);
	const membersTitleRef = useRef<HTMLHeadingElement>(null);
	const chatInputRef = useRef<HTMLTextAreaElement>(null);
	const focusChatAfterExpand = useRef(false);
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
	const snapshot = room.snapshot;
	const draw = snapshot?.draw ?? null;
	const drawMatchesCandidates = draw?.listVersion === snapshot?.listVersion;
	const drawArchived =
		!solo &&
		(snapshot?.history.some((entry) => entry.id === draw?.id) ?? false);
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
		reducedMotion,
	);
	const showResult = Boolean(displayedDraw && finished);
	const spinning = Boolean(displayedDraw && !finished);
	const busy = fetching || spinning || room.nextPending;
	const connected = room.connection === "connected";
	const isHost = connected && room.self?.isHost === true;
	const eligibleCandidates = snapshot
		? getEligibleRoomCandidates(snapshot)
		: [];
	const places =
		(drawMatchesCandidates ? displayedDraw?.candidates : undefined) ??
		eligibleCandidates;
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
	const serverMessages = snapshot?.messages;
	const localMessages = room.localChatMessages ?? noLocalChatMessages;
	const messages = useMemo((): DisplayChatMessage[] => {
		const confirmedIds = new Set(serverMessages?.map((entry) => entry.id));
		const confirmedMessages = [...(serverMessages ?? []), ...connectionEvents]
			.sort((left, right) => left.timestamp - right.timestamp)
			.slice(-lunchRoomLimits.maxMessages);
		return [
			...confirmedMessages,
			...localMessages.filter((entry) => !confirmedIds.has(entry.id)),
		].sort((left, right) => left.timestamp - right.timestamp);
	}, [serverMessages, localMessages, connectionEvents]);
	const hostOnline = participants.some((participant) => participant.isHost);
	const canStart =
		isHost &&
		!busy &&
		!room.candidatesPending &&
		!room.mutationPending &&
		Boolean(snapshot && getRoomPhase(snapshot) === "waiting") &&
		eligibleCandidates.length >= 1;
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
		if (view === "history" && !selectedDraw) {
			const record = historyRecordFocusRef.current
				? document.querySelector<HTMLButtonElement>(
						`[data-draw-id="${historyRecordFocusRef.current}"]`,
					)
				: null;
			(record ?? historyTitleRef.current)?.focus();
		}
	}, [view, selectedDraw]);
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
		if (chatCollapsed) {
			if (added > 0) setUnread((count) => count + added);
			return;
		}
		if (nearBottomRef.current) {
			list.scrollTop = list.scrollHeight;
			setUnread(0);
		} else if (added > 0) setUnread((count) => count + added);
	}, [messages, chatCollapsed]);
	useEffect(() => {
		if (!chatCollapsed && focusChatAfterExpand.current) {
			focusChatAfterExpand.current = false;
			chatInputRef.current?.focus();
		}
	}, [chatCollapsed]);
	useEffect(() => {
		const list = chatListRef.current;
		if (
			!list ||
			chatCollapsed ||
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
	}, [closed, room.waitingForEntry, room.entryPending, chatCollapsed]);
	function changeView(next: RoomView) {
		historyRecordFocusRef.current = null;
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
		historyRecordFocusRef.current = draw.id;
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
	function start(options?: { expectedRevision?: number }) {
		if (!room.startDraw(options)) return;
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
	function restoreFailedChat(entry: DisplayChatMessage) {
		if (entry.delivery !== "failed" || message) return;
		setMessage(entry.text);
		room.dismissLocalChat(entry.id);
		chatInputRef.current?.focus();
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
	const status = solo
		? fetching
			? "난수 출처에서 추첨 결과를 가져오고 있습니다."
			: spinning
				? "룰렛이 멈추면 결과를 공개합니다."
				: winner
					? `추첨 결과: ${winner.name}`
					: "가운데 버튼으로 추첨을 시작하세요."
		: room.connection === "closed"
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

	if (
		!closed &&
		(room.entryLoading || room.waitingForEntry || room.entryPending)
	)
		return (
			<div className="random-lab lunch-room">
				<SiteHeader active="lunch" />
				<main id="main-content" className="room-entry-main">
					<RoomEntryGate
						key={roomId}
						roomId={roomId}
						loading={room.entryLoading}
						pending={room.entryPending}
						error={room.error}
						onEnter={room.enter}
						onClearError={room.clearError}
						onReconnect={room.reconnect}
					/>
				</main>
			</div>
		);

	return (
		<div
			ref={roomViewportRef}
			className={`random-lab lunch-room${closed || solo ? "" : " room-live"}${solo ? " lunch-solo" : ""}`}
		>
			<SiteHeader active="lunch" />
			<main id="main-content" className="room-main">
				{solo && storageFailed && (
					<output className="room-error" aria-live="polite">
						이 브라우저에 기록을 저장하거나 불러오지 못했습니다. 현재 화면에서는
						추첨을 계속할 수 있습니다.
					</output>
				)}
				<div className="room-heading">
					<div className="room-title-block">
						<h1>
							{closed ? "점심 추첨방" : (snapshot?.title ?? "점심 추첨방")}
						</h1>
						{!closed && !solo && (
							<div className="room-connection" data-connected={connected}>
								{connected ? (
									<Wifi size={15} aria-hidden="true" />
								) : (
									<WifiOff size={15} aria-hidden="true" />
								)}
								<span>
									{connected
										? "연결됨"
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
									<Button
										variant="ghost"
										size="sm"
										type="button"
										className="room-text-action"
										onClick={room.reconnect}
									>
										다시 연결
									</Button>
								)}
							</div>
						)}
					</div>
					{!closed && !solo && (
						<div className="room-heading-actions">
							<Button
								variant="outline"
								size="default"
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
							</Button>
							{snapshot && (
								<details className="room-info">
									<Button asChild variant="outline" size="icon">
										<summary title="방 정보">
											<Info size={18} aria-hidden="true" />
											<span className="sr-only">방 정보</span>
										</summary>
									</Button>

									<div className="room-lifetime">
										<span>
											생성{" "}
											<time
												dateTime={new Date(snapshot.createdAt).toISOString()}
											>
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
											<time
												dateTime={new Date(snapshot.expiresAt).toISOString()}
											>
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
								</details>
							)}
							<RoomSettingsDialog room={room} busy={busy} />
						</div>
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
						<Button asChild size="lg" className="room-terminal-action">
							<a href="/create">새 방 만들기</a>
						</Button>
						<Button asChild variant="outline">
							<a href="/solo">혼자 추첨하기</a>
						</Button>
					</section>
				) : (
					<>
						{!solo && connected && !hostOnline && (
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
						<div
							className="room-layout"
							data-chat-collapsed={solo || chatCollapsed}
						>
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
										<h2>초대 링크 직접 복사</h2>
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
								<RoomLifecyclePanel
									room={room}
									solo={solo}
									key={roomId}
									historyButtonRef={historyTriggerRef}
									busy={busy}
									showResult={showResult}
									onStart={start}
									onHistory={() => changeView("history")}
								>
									{(requestStart) => (
										<section
											id={`${id}-draw-panel`}
											className="room-draw-panel"
											hidden={false}
											aria-labelledby={`${id}-wheel`}
										>
											<h2 id={`${id}-wheel`} className="sr-only">
												룰렛
											</h2>
											<div className="room-wheel-stage">
												<div
													className={`room-wheel-area ${showResult ? "is-covered" : ""}`}
													aria-hidden={showResult || undefined}
												>
													<LunchWheel
														candidates={places}
														candidateNumbers={places.map(
															(place, index) =>
																roomCandidateNumbers.get(place.id) ?? index + 1,
														)}
														rotation={
															finished ? (displayedDraw?.toRotation ?? 0) : 0
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
														onDraw={requestStart}
														buttonId={`${id}-start`}
														errorId={room.error ? `${id}-error` : undefined}
														covered={!canStart || showResult}
														canDraw={isHost}
														drawLabel={
															places.length === 1
																? "마지막 후보 확정"
																: "룰렛 돌리기"
														}
														drawText={
															places.length === 1 ? "후보 확정" : "돌리기"
														}
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
															solo={solo}
															selfId={room.self?.id}
															isHost={room.self?.isHost === true}
															connected={connected}
															pending={
																room.votePendingDrawId === displayedDraw.id
															}
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

											{spinning && reducedMotion && (
												<p className="room-motion-note">
													동작 줄이기 설정을 적용했습니다. 추첨이 끝나면 결과를
													표시합니다.
												</p>
											)}
										</section>
									)}
								</RoomLifecyclePanel>
								<Dialog
									open={view === "history" && !selectedDraw}
									onOpenChange={(open) => {
										if (!open) setView("wheel");
									}}
								>
									<DialogContent
										className="room-history-dialog"
										showCloseButton={false}
										onOpenAutoFocus={(event) => {
											event.preventDefault();
											const record = historyRecordFocusRef.current
												? document.querySelector<HTMLButtonElement>(
														`[data-draw-id="${historyRecordFocusRef.current}"]`,
													)
												: null;
											(record ?? historyTitleRef.current)?.focus();
										}}
										onCloseAutoFocus={(event) => {
											event.preventDefault();
											if (!selectedDraw) historyTriggerRef.current?.focus();
										}}
									>
										<DialogTitle className="sr-only">
											지난 추첨 기록
										</DialogTitle>
										<DialogDescription className="sr-only">
											{solo
												? "이 브라우저에서 완료한 추첨 기록을 확인합니다."
												: "같은 방에서 완료한 추첨과 당시 후보를 확인합니다."}
										</DialogDescription>
										<section
											id={`${id}-history-panel`}
											className="room-history-panel"
											hidden={false}
											aria-labelledby={`${id}-history-title`}
										>
											<div className="room-panel-heading">
												<h2
													id={`${id}-history-title`}
													ref={historyTitleRef}
													className="room-history-title"
													tabIndex={-1}
												>
													{solo ? "추첨 기록" : "방 추첨 기록"}
												</h2>
												<div className="room-history-heading-actions">
													<span>최근 {lunchRoomLimits.maxHistory}개</span>
													<DialogClose asChild>
														<Button
															variant="ghost"
															size="icon"
															aria-label="닫기"
														>
															<X size={18} aria-hidden="true" />
														</Button>
													</DialogClose>
												</div>
											</div>
											{completedHistory.length === 0 ? (
												<p className="room-panel-note">
													아직 확정된 추첨 기록이 없습니다.
												</p>
											) : (
												<ol className="room-history-list">
													{completedHistory.map((entry) => {
														const place = entry.candidates[entry.winnerIndex];
														return (
															<li key={entry.id} className="room-history-item">
																<div className="room-history-summary">
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
																</div>
																<Button
																	variant="ghost"
																	size="icon"
																	type="button"
																	className="room-history-details"
																	title="상세 보기"
																	data-draw-id={entry.id}
																	ref={(node) => {
																		if (
																			node &&
																			entry.id === historyRecordFocusRef.current
																		)
																			selectedDrawTriggerRef.current = node;
																	}}
																	aria-expanded={selectedDraw?.id === entry.id}
																	aria-label={`${place.name} 상세 기록 열기`}
																	aria-haspopup="dialog"
																	onClick={(event) =>
																		openRecord(entry, event.currentTarget)
																	}
																>
																	<ChevronRight size={20} aria-hidden="true" />
																</Button>
															</li>
														);
													})}
												</ol>
											)}
										</section>
										{solo && legacyHistory.length > 0 && (
											<section aria-label="이전 추첨 기록">
												<h2>이전 추첨 기록</h2>
												<ol className="room-history-list">
													{legacyHistory.map((record) => (
														<li key={record.id} className="room-history-item">
															<div className="room-history-summary">
																<h3>{record.place.name}</h3>
																<span>{record.place.category}</span>
																<span>
																	{record.candidateCount}곳 중 추첨 ·{" "}
																	{getSourceDisplayName(record.source)}
																</span>
																<time
																	dateTime={new Date(
																		record.timestamp,
																	).toISOString()}
																>
																	{new Date(record.timestamp).toLocaleString(
																		"ko-KR",
																	)}
																</time>
															</div>
														</li>
													))}
												</ol>
											</section>
										)}
									</DialogContent>
								</Dialog>
							</div>
							{!solo && (
								<aside
									className="room-chat-panel"
									data-collapsed={chatCollapsed}
									aria-labelledby={`${id}-chat`}
									onFocusCapture={keepChatFocus}
									onPointerDownCapture={keepChatFocus}
								>
									<div className="room-chat-header">
										<h2 id={`${id}-chat`} className="sr-only">
											채팅
										</h2>
										<Button
											variant="ghost"
											size="auto"
											type="button"
											ref={nicknameButtonRef}
											className="room-profile-trigger"
											aria-label={`내 프로필: ${room.nickname || "참가자"}`}
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
											</span>
											<span className="room-profile-text">
												<strong>{room.nickname || "참가자"}</strong>
											</span>
										</Button>
										<Button
											variant="ghost"
											size="auto"
											className="room-chat-header-toggle"
											aria-label={chatCollapsed ? "채팅 펼치기" : "채팅 접기"}
											aria-expanded={!chatCollapsed}
											aria-controls={`${id}-chat-content`}
											aria-describedby={
												unread > 0 ? `${id}-chat-unread` : undefined
											}
											onClick={toggleChat}
										>
											<RoomChatUnreadBadge
												count={unread}
												id={`${id}-chat-unread`}
											/>
											{chatCollapsed ? (
												<ChevronUp size={17} aria-hidden="true" />
											) : (
												<ChevronDown size={17} aria-hidden="true" />
											)}
										</Button>
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
													<Button
														variant="ghost"
														size="icon"
														type="button"
														className="room-chat-icon-button"
														aria-label="프로필 닫기"
														onClick={() => {
															restoreNicknameFocusRef.current = true;
															setChatPopover(null);
														}}
													>
														<X size={16} aria-hidden="true" />
													</Button>
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
													<Label htmlFor={`${id}-name`}>닉네임</Label>
													<span className="room-name-count">
														{nameDraft.length}/
														{lunchRoomLimits.maxNicknameLength}
													</span>
													<Input
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
														<Button
															variant="default"
															size="sm"
															type="submit"
															className="room-profile-save"
															disabled={!connected}
														>
															변경
														</Button>
														<Button
															variant="ghost"
															size="sm"
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
														</Button>
													</div>
												</form>
											</section>
										)}
										<Button
											variant="ghost"
											size="sm"
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
										</Button>
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
													<Button
														variant="ghost"
														size="icon"
														type="button"
														className="room-chat-icon-button"
														aria-label="참가자 목록 닫기"
														onClick={() => {
															setChatPopover(null);
															membersButtonRef.current?.focus();
														}}
													>
														<X size={16} aria-hidden="true" />
													</Button>
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
																{member.id === room.self?.id && (
																	<small>나</small>
																)}
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
									<div
										id={`${id}-chat-content`}
										className="room-chat-body"
										hidden={chatCollapsed}
									>
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
												if (chatCollapsed) return;
												const list = event.currentTarget;
												nearBottomRef.current =
													list.scrollHeight -
														list.scrollTop -
														list.clientHeight <
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
																dateTime={new Date(
																	entry.timestamp,
																).toISOString()}
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
														ownParticipantIdsRef.current.has(
															entry.participantId,
														));
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
														data-delivery={entry.delivery}
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
															<p className="room-message-content">
																{entry.text}
															</p>
															{lastInGroup && (
																<time
																	className="room-message-time"
																	dateTime={new Date(
																		entry.timestamp,
																	).toISOString()}
																>
																	{new Date(entry.timestamp).toLocaleTimeString(
																		"ko-KR",
																		{ hour: "2-digit", minute: "2-digit" },
																	)}
																</time>
															)}
														</div>
														{entry.delivery && (
															<output className="room-message-delivery">
																<span>
																	{entry.delivery === "sending"
																		? "전송 중…"
																		: entry.delivery === "failed"
																			? "전송 실패"
																			: "전송 확인 안 됨"}
																</span>
																{entry.reason && <span>{entry.reason}</span>}
																{entry.delivery === "failed" && (
																	<Button
																		variant="link"
																		size="sm"
																		type="button"
																		disabled={Boolean(message)}
																		title={
																			message
																				? "작성 중인 메시지를 먼저 보내 주세요."
																				: undefined
																		}
																		onClick={() => restoreFailedChat(entry)}
																	>
																		다시 작성
																	</Button>
																)}
																{entry.delivery === "unconfirmed" && (
																	<>
																		<span>
																			같은 내용을 다시 보내기 전에 확인해
																			주세요.
																		</span>
																		<Button
																			variant="link"
																			size="sm"
																			type="button"
																			title="이 화면의 미확인 표시만 닫습니다. 메시지 전송을 취소하지 않습니다."
																			onClick={() =>
																				room.dismissLocalChat(entry.id)
																			}
																		>
																			표시 닫기
																		</Button>
																	</>
																)}
															</output>
														)}
													</li>
												);
											})}
											{messages.length === 0 && (
												<li className="room-chat-empty">
													함께 먹고 싶은 메뉴를 이야기해 보세요.
												</li>
											)}
										</ul>
										<Button
											variant="secondary"
											size="sm"
											type="button"
											className="room-new-messages"
											hidden={unread === 0}
											aria-label={`새 메시지 ${unread}개 보기`}
											onClick={() => {
												const list = chatListRef.current;
												if (list) list.scrollTop = list.scrollHeight;
												nearBottomRef.current = true;
												setUnread(0);
											}}
										>
											<ArrowDown size={16} aria-hidden="true" />
											<RoomChatUnreadBadge count={unread} announce={false} />
										</Button>
										<form
											className="room-chat-form"
											onSubmit={(event) => {
												event.preventDefault();
												submitChat();
											}}
										>
											<Label className="sr-only" htmlFor={`${id}-message`}>
												메시지
											</Label>
											<div className="room-composer-row">
												<Textarea
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
												<Button
													variant="default"
													size="icon"
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
												</Button>
											</div>
											<div className="room-composer-meta">
												<span id={`${id}-composer-help`}>
													Enter 전송 · Shift+Enter 줄바꿈
												</span>
												<span>{message.length}/500</span>
											</div>
										</form>
									</div>
								</aside>
							)}
						</div>
					</>
				)}
			</main>
			{selectedDraw && !closed && (
				<RoomDrawDialog
					solo={solo}
					draw={selectedDraw}
					columnRef={primaryColumnRef}
					returnFocusRef={selectedDrawTriggerRef}
					fallbackFocusRef={
						view === "history" ? historyTitleRef : historyTriggerRef
					}
					chatInputRef={chatInputRef}
					onChatFocus={
						solo
							? undefined
							: () => {
									setView("wheel");
									if (chatCollapsed) {
										focusChatAfterExpand.current = true;
										setChatCollapsed(false);
									} else chatInputRef.current?.focus();
								}
					}
					onClose={() => setSelectedDraw(null)}
				/>
			)}
		</div>
	);
}
