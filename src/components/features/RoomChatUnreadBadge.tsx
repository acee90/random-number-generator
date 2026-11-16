import { useEffect, useRef, useState } from "react";

/** The count is durable feedback; motion only calls attention to a new arrival. */
export default function RoomChatUnreadBadge({
	count,
	id,
	announce = true,
}: {
	count: number;
	id?: string;
	announce?: boolean;
}) {
	const previousCount = useRef(count);
	const [arrival, setArrival] = useState(0);
	const [nudging, setNudging] = useState(false);
	useEffect(() => {
		if (count > previousCount.current && count > 0) {
			setArrival((value) => value + 1);
			setNudging(true);
		} else if (count < previousCount.current) setNudging(false);
		previousCount.current = count;
	}, [count]);
	return (
		<>
			<span className="room-chat-unread" aria-hidden="true" hidden={count < 1}>
				<span
					key={arrival}
					className="room-chat-unread-count"
					data-arrival={nudging ? "new" : undefined}
					onAnimationEnd={() => setNudging(false)}
				>
					{count > 99 ? "99+" : count}
				</span>
			</span>
			{announce && (
				<output
					id={id}
					className="sr-only"
					aria-live="polite"
					aria-atomic="true"
				>
					{count > 0 ? `새 메시지 ${count}개` : ""}
				</output>
			)}
		</>
	);
}
