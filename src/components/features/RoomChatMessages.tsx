import { Button } from "@/components/ui/button";
import {
	Message,
	MessageAvatar,
	MessageContent,
	MessageFooter,
	MessageHeader,
} from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import type { LocalChatMessage } from "@/hooks/useLunchRoom";
import type { ChatMessage } from "@/lib/lunchRoom";
import { cn } from "@/lib/utils";

export type DisplayChatMessage = ChatMessage & Partial<LocalChatMessage>;

const clock = new Intl.DateTimeFormat("ko-KR", {
	hour: "2-digit",
	minute: "2-digit",
});
const deliveryLabels = {
	sending: "전송 중…",
	failed: "전송 실패",
	unconfirmed: "전송 확인 안 됨",
} as const;

function isSystemMessage(entry: ChatMessage) {
	return Boolean(entry.event) || entry.participantId === "system";
}

function sameMessageGroup(left?: ChatMessage, right?: ChatMessage) {
	return (
		left &&
		right &&
		!isSystemMessage(left) &&
		!isSystemMessage(right) &&
		left.participantId === right.participantId &&
		left.name === right.name &&
		Math.floor(left.timestamp / 60_000) === Math.floor(right.timestamp / 60_000)
	);
}

function MessageTime({ timestamp }: { timestamp: number }) {
	return (
		<time
			className="room-message-time"
			dateTime={new Date(timestamp).toISOString()}
		>
			{clock.format(timestamp)}
		</time>
	);
}

export default function RoomChatMessages({
	messages,
	isMine,
	hasDraft,
	onRestore,
	onDismiss,
}: {
	messages: readonly DisplayChatMessage[];
	isMine: (entry: ChatMessage) => boolean;
	hasDraft: boolean;
	onRestore: (entry: DisplayChatMessage) => void;
	onDismiss: (id: string) => void;
}) {
	if (!messages.length) {
		return (
			<MessageScrollerItem className="room-chat-empty" role="listitem">
				후보나 추첨 결과에 대해 이야기해 보세요.
			</MessageScrollerItem>
		);
	}

	return messages.map((entry, index) => {
		if (isSystemMessage(entry)) {
			return (
				<MessageScrollerItem
					key={entry.id}
					messageId={entry.id}
					className="room-chat-system"
					role="listitem"
				>
					<p>{entry.text}</p>
					<MessageTime timestamp={entry.timestamp} />
				</MessageScrollerItem>
			);
		}
		const mine = Boolean(entry.delivery) || isMine(entry);
		const continuation = sameMessageGroup(messages[index - 1], entry);
		const lastInGroup = !sameMessageGroup(entry, messages[index + 1]);
		const delivery = entry.delivery;
		return (
			<MessageScrollerItem
				key={entry.id}
				messageId={entry.id}
				role="listitem"
				className={cn(
					"room-chat-bubble",
					mine ? "is-mine" : "is-other",
					continuation && "is-continuation",
				)}
				data-delivery={delivery}
			>
				<Message align={mine ? "end" : "start"}>
					{!mine && !continuation && (
						<MessageAvatar aria-hidden="true">
							{Array.from(entry.name)[0]}
						</MessageAvatar>
					)}
					<MessageContent className="room-message-stack">
						{!continuation ? (
							<MessageHeader className="room-message-author">
								{entry.name}
							</MessageHeader>
						) : (
							<span className="sr-only">{entry.name}의 메시지: </span>
						)}
						<p className="room-message-content">{entry.text}</p>
						{lastInGroup && (
							<MessageFooter>
								<MessageTime timestamp={entry.timestamp} />
							</MessageFooter>
						)}
						{delivery && (
							<output className="room-message-delivery">
								<span>{deliveryLabels[delivery]}</span>
								{entry.reason && <span>{entry.reason}</span>}
								{delivery === "failed" && (
									<Button
										variant="link"
										size="sm"
										disabled={hasDraft}
										title={
											hasDraft
												? "작성 중인 메시지를 먼저 보내 주세요."
												: undefined
										}
										onClick={() => onRestore(entry)}
									>
										다시 작성
									</Button>
								)}
								{delivery === "unconfirmed" && (
									<>
										<span>같은 내용을 다시 보내기 전에 확인해 주세요.</span>
										<Button
											variant="link"
											size="sm"
											title="이 화면의 미확인 표시만 닫습니다. 메시지 전송을 취소하지 않습니다."
											onClick={() => onDismiss(entry.id)}
										>
											표시 닫기
										</Button>
									</>
								)}
							</output>
						)}
					</MessageContent>
				</Message>
			</MessageScrollerItem>
		);
	});
}
