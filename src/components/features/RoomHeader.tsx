import { Check, Copy, Crown, Info, Monitor, Wifi, WifiOff } from "lucide-react";
import { useId, useState } from "react";
import SiteHeader from "@/components/layout/SiteHeader";
import { Button } from "@/components/ui/button";
import type { useLunchRoom } from "@/hooks/useLunchRoom";
import type { RoomSnapshot } from "@/lib/lunchRoom";
import RoomSettingsDialog from "./RoomSettingsDialog";

const roomDate = new Intl.DateTimeFormat("ko-KR", {
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
});

function RoomInfo({
	snapshot,
	solo,
}: {
	snapshot: RoomSnapshot;
	solo: boolean;
}) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	return (
		<div
			className="room-info"
			data-open={open || undefined}
			data-dismissed={dismissed || undefined}
			onPointerEnter={() => setDismissed(false)}
			onFocusCapture={() => setDismissed(false)}
			onBlurCapture={() => setOpen(false)}
		>
			<Button
				variant="ghost"
				size="icon-sm"
				className="room-info-trigger"
				aria-label="방 정보"
				aria-controls={id}
				aria-describedby={id}
				aria-expanded={open}
				onClick={() => {
					setOpen(!open);
					setDismissed(open);
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						setOpen(false);
						setDismissed(true);
					}
				}}
			>
				<Info aria-hidden="true" />
			</Button>
			<div id={id} className="room-lifetime" role="tooltip">
				<strong>{snapshot.title}</strong>
				<span>
					생성{" "}
					<time dateTime={new Date(snapshot.createdAt).toISOString()}>
						{roomDate.format(snapshot.createdAt)}
					</time>
				</span>
				<span>
					종료{" "}
					<time dateTime={new Date(snapshot.expiresAt).toISOString()}>
						{roomDate.format(snapshot.expiresAt)}
					</time>
				</span>
				<p>
					{solo
						? "혼자 만든 추첨과 기록은 이 브라우저에 최대 24시간 보관됩니다."
						: "방장이 나가도 생성 후 24시간, 표시된 종료 시각까지 방이 유지됩니다."}
				</p>
			</div>
		</div>
	);
}

export default function RoomHeader({
	room,
	solo,
	busy,
	canInvite,
	copied,
	onCopyInvite,
}: {
	room: ReturnType<typeof useLunchRoom>;
	solo: boolean;
	busy: boolean;
	canInvite: boolean;
	copied: boolean;
	onCopyInvite: (button: HTMLButtonElement) => void;
}) {
	const { snapshot, connection } = room;
	const closed = connection === "closed";
	const connected = connection === "connected";

	const inviteLabel = copied ? "링크 복사됨" : "초대 링크 복사";
	return (
		<SiteHeader className="room-header">
			<div className="room-title-block">
				<div className="room-title-row">
					<h1>{(!closed && snapshot?.title) || "점심 추첨방"}</h1>
					{!closed && snapshot && <RoomInfo snapshot={snapshot} solo={solo} />}
				</div>
				{!closed && (
					<div className="room-connection" data-connected={connected}>
						<span className="room-connection-state">
							{solo ? (
								<Monitor size={14} aria-hidden="true" />
							) : connected ? (
								<Wifi size={14} aria-hidden="true" />
							) : (
								<WifiOff size={14} aria-hidden="true" />
							)}
							{solo
								? "혼자 추첨"
								: connected
									? "연결됨"
									: connection === "reconnecting"
										? "연결 끊김 · 다시 연결 중"
										: "연결 중"}
						</span>
						{!solo && <span>참가 {snapshot?.participants.length ?? 0}명</span>}
						{!solo && room.self?.isHost && (
							<span className="room-host-badge">
								<Crown size={12} aria-hidden="true" />
								방장
							</span>
						)}
						{!connected && (
							<Button variant="link" size="sm" onClick={room.reconnect}>
								다시 연결
							</Button>
						)}
					</div>
				)}
			</div>
			{!closed && (
				<div className="room-heading-actions">
					{!solo && (
						<Button
							variant="outline"
							className="room-invite-button"
							aria-label={inviteLabel}
							title={inviteLabel}
							disabled={!canInvite}
							onClick={(event) => onCopyInvite(event.currentTarget)}
						>
							{copied ? (
								<Check aria-hidden="true" />
							) : (
								<Copy aria-hidden="true" />
							)}
							<span>{inviteLabel}</span>
						</Button>
					)}
					<RoomSettingsDialog room={room} busy={busy} solo={solo} />
				</div>
			)}
		</SiteHeader>
	);
}
