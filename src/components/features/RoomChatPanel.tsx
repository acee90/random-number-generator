import {
	ArrowDown,
	ChevronDown,
	ChevronUp,
	Crown,
	Pencil,
	Send,
	Users,
	X,
} from "lucide-react";
import {
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerProvider,
	MessageScrollerViewport,
	useMessageScroller,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import type { LocalChatMessage, useLunchRoom } from "@/hooks/useLunchRoom";
import { type ChatMessage, lunchRoomLimits } from "@/lib/lunchRoom";
import RoomChatMessages, { type DisplayChatMessage } from "./RoomChatMessages";
import RoomChatUnreadBadge from "./RoomChatUnreadBadge";
import "./room-chat.css";

const presenceLabels = {
	online: "온라인",
	away: "자리비움",
	offline: "오프라인",
} as const;
const noLocalChatMessages: LocalChatMessage[] = [];
const liveEdgeThreshold = 48;

type Props = {
	room: ReturnType<typeof useLunchRoom>;
	roomId: string;
	collapsed: boolean;
	recordOpen: boolean;
	inputRef: RefObject<HTMLTextAreaElement | null>;
	onToggle: () => void;
	onInteract: () => void;
};

export default function RoomChatPanel(props: Props) {
	const [followLatest, setFollowLatest] = useState(true);
	return (
		<MessageScrollerProvider
			autoScroll={!props.collapsed && followLatest}
			defaultScrollPosition="end"
			scrollEdgeThreshold={liveEdgeThreshold}
		>
			<RoomChatPanelContent {...props} onFollowChange={setFollowLatest} />
		</MessageScrollerProvider>
	);
}

function RoomChatPanelContent({
	room,
	roomId,
	collapsed: chatCollapsed,
	recordOpen,
	inputRef: chatInputRef,
	onToggle,
	onInteract,
	onFollowChange,
}: Props & { onFollowChange: (follow: boolean) => void }) {
	const id = useId();
	const { scrollToEnd } = useMessageScroller();
	const [message, setMessage] = useState("");
	const [chatTogglePointerFocus, setChatTogglePointerFocus] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [nameError, setNameError] = useState("");
	const [chatPopover, setChatPopover] = useState<"profile" | "members" | null>(
		null,
	);
	const [connectionEvents, setConnectionEvents] = useState<ChatMessage[]>([]);
	const [unread, setUnread] = useState(0);
	const editingName = chatPopover === "profile";
	const nicknameRef = useRef<HTMLInputElement>(null);
	const nicknameButtonRef = useRef<HTMLButtonElement>(null);
	const profilePopoverRef = useRef<HTMLElement>(null);
	const membersPopoverRef = useRef<HTMLElement>(null);
	const membersButtonRef = useRef<HTMLButtonElement>(null);
	const membersTitleRef = useRef<HTMLHeadingElement>(null);
	const composingRef = useRef(false);
	const restoreNicknameFocusRef = useRef(false);
	const connectionEventIdRef = useRef(0);
	const connectionStateRef = useRef({
		roomId,
		wasConnected: false,
		previous: room.connection,
	});
	const chatListRef = useRef<HTMLDivElement>(null);
	const nearBottomRef = useRef(true);
	const previousMessagesRef = useRef(new Set<string>());
	const ownParticipantIdsRef = useRef(new Set<string>());
	const snapshot = room.snapshot;
	const connected = room.connection === "connected";
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

	useEffect(() => {
		if (recordOpen || chatCollapsed) setChatPopover(null);
	}, [recordOpen, chatCollapsed]);
	useEffect(() => setNameDraft(room.nickname), [room.nickname]);
	useEffect(() => {
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
	useLayoutEffect(() => {
		const field = chatInputRef.current;
		if (!field || chatCollapsed) return;
		if (!message) {
			field.style.height = "";
			return;
		}
		field.style.height = "0px";
		field.style.height = `${field.scrollHeight}px`;
	}, [chatInputRef, message, chatCollapsed]);
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
		const previous = previousMessagesRef.current;
		const added = messages.filter((entry) => !previous.has(entry.id)).length;
		previousMessagesRef.current = new Set(messages.map((entry) => entry.id));
		if (!chatCollapsed && nearBottomRef.current) setUnread(0);
		else if (added > 0) setUnread((count) => count + added);
	}, [messages, chatCollapsed]);

	function showLatest() {
		nearBottomRef.current = true;
		scrollToEnd();
		onFollowChange(true);
		setUnread(0);
	}
	function submitChat() {
		if (room.sendChat(message)) {
			setMessage("");
			showLatest();
		}
	}
	function restoreFailedChat(entry: DisplayChatMessage) {
		if (entry.delivery !== "failed" || message) return;
		setMessage(entry.text);
		room.dismissLocalChat(entry.id);
		chatInputRef.current?.focus();
	}

	return (
		<aside
			className="room-chat-panel"
			data-collapsed={chatCollapsed}
			aria-labelledby={`${id}-chat`}
			onFocusCapture={onInteract}
			onPointerDownCapture={onInteract}
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
					data-pointer-focused={chatTogglePointerFocus || undefined}
					aria-label={chatCollapsed ? "채팅 펼치기" : "채팅 접기"}
					aria-expanded={!chatCollapsed}
					aria-controls={`${id}-chat-content`}
					aria-describedby={unread > 0 ? `${id}-chat-unread` : undefined}
					onPointerDown={() => setChatTogglePointerFocus(true)}
					onFocus={(event) => {
						if (event.currentTarget.matches(":focus-visible"))
							setChatTogglePointerFocus(false);
					}}
					onKeyDown={() => setChatTogglePointerFocus(false)}
					onBlur={() => setChatTogglePointerFocus(false)}
					onClick={onToggle}
				>
					<RoomChatUnreadBadge count={unread} id={`${id}-chat-unread`} />
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
								{nameDraft.length}/{lunchRoomLimits.maxNicknameLength}
							</span>
							<Input
								id={`${id}-name`}
								ref={nicknameRef}
								autoComplete="nickname"
								maxLength={lunchRoomLimits.maxNicknameLength}
								value={nameDraft}
								disabled={!connected}
								aria-invalid={Boolean(nameError)}
								aria-describedby={nameError ? `${id}-name-error` : undefined}
								onChange={(event) => {
									setNameDraft(event.target.value);
									setNameError("");
								}}
							/>
							<p
								id={`${id}-name-error`}
								role="alert"
								className={nameError ? "room-error" : "room-empty-error"}
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
						setChatPopover((open) => (open === "members" ? null : "members"))
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
										{member.id === room.self?.id && <small>나</small>}
										{member.isHost && <Crown size={12} aria-label="방장" />}
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
				<MessageScroller className="room-chat-transcript">
					<MessageScrollerViewport
						className="room-chat-list"
						ref={chatListRef}
						role="log"
						aria-label="방 채팅 메시지"
						aria-live="polite"
						aria-relevant="additions"
						onScroll={(event) => {
							if (chatCollapsed) return;
							const list = event.currentTarget;
							const atLatest =
								list.scrollHeight - list.scrollTop - list.clientHeight <=
								liveEdgeThreshold;
							if (atLatest !== nearBottomRef.current) {
								nearBottomRef.current = atLatest;
								onFollowChange(atLatest);
							}
							if (atLatest) setUnread(0);
						}}
					>
						<MessageScrollerContent role="list" className="room-chat-messages">
							<RoomChatMessages
								messages={messages}
								hasDraft={Boolean(message)}
								isMine={(entry) =>
									entry.participantId === room.self?.id ||
									ownParticipantIdsRef.current.has(entry.participantId)
								}
								onRestore={restoreFailedChat}
								onDismiss={room.dismissLocalChat}
							/>
						</MessageScrollerContent>
					</MessageScrollerViewport>
					<Button
						variant="secondary"
						size="sm"
						className="room-new-messages"
						hidden={unread === 0}
						aria-label={`새 메시지 ${unread}개 보기`}
						onClick={() => {
							chatListRef.current?.focus({ preventScroll: true });
							showLatest();
						}}
					>
						<ArrowDown size={16} aria-hidden="true" />
						<span>새 메시지</span>
						<RoomChatUnreadBadge count={unread} announce={false} />
					</Button>
				</MessageScroller>
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
							placeholder={connected ? "메시지 보내기" : "연결을 기다리는 중…"}
						/>
						<Button
							variant="default"
							size="icon"
							type="submit"
							className="size-11"
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
	);
}
