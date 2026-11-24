import { ChevronRight } from "lucide-react";
import { type CSSProperties, type RefObject, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LunchHistoryRecord } from "@/lib/lunchHistory";
import {
	lunchRoomLimits,
	type RoomDraw,
	type RoomSnapshot,
} from "@/lib/lunchRoom";
import {
	getRoomHistoryTimeline,
	type RoomHistoryEvent,
} from "@/lib/roomWinHistory";

export type RoomHistoryNavigation = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRecord: (draw: RoomDraw, trigger: HTMLButtonElement) => void;
	triggerRef: RefObject<HTMLButtonElement | null>;
	titleRef: RefObject<HTMLHeadingElement | null>;
	recordRef: RefObject<HTMLButtonElement | null>;
	returnDrawId: string | null;
	serverNow: () => number;
	previousDraws: readonly RoomDraw[];
	legacyHistory: readonly LunchHistoryRecord[];
};

const dateTime = new Intl.DateTimeFormat("ko-KR", {
	month: "numeric",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});
function WinTime({ timestamp }: { timestamp: number }) {
	return (
		<time dateTime={new Date(timestamp).toISOString()}>
			{dateTime.format(timestamp)}
		</time>
	);
}

function WinningDraw({
	draw,
	navigation,
}: {
	draw: RoomDraw;
	navigation?: RoomHistoryNavigation;
}) {
	const metaId = useId();
	const name = draw.candidates[draw.winnerIndex].name;
	const summary = (
		<span className="room-win-summary">
			<strong>{name}</strong>
			<span className="room-win-meta" id={metaId}>
				{draw.roundNumber !== undefined &&
					draw.roundNumberIsExact !== false &&
					`${draw.roundNumber}회차 · `}
				<WinTime timestamp={draw.timestamp} />
			</span>
		</span>
	);
	return (
		<li>
			{navigation ? (
				<Button
					variant="ghost"
					size="auto"
					className="room-win-entry room-win-details"
					data-draw-id={draw.id}
					ref={(node) => {
						if (node && draw.id === navigation.returnDrawId)
							navigation.recordRef.current = node;
					}}
					aria-label={`${name} 상세 기록 열기`}
					aria-describedby={metaId}
					aria-haspopup="dialog"
					onClick={(event) => navigation.onRecord(draw, event.currentTarget)}
				>
					{summary}
					<ChevronRight aria-hidden />
				</Button>
			) : (
				<div className="room-win-entry">{summary}</div>
			)}
		</li>
	);
}

export default function RoomWinHistory({
	snapshot,
	showResult,
	navigation,
	titleRef,
	includePrevious,
	onIncludePreviousChange,
}: {
	snapshot: RoomSnapshot | null;
	showResult: boolean;
	navigation?: RoomHistoryNavigation;
	titleRef: RefObject<HTMLHeadingElement | null>;
	includePrevious: boolean;
	onIncludePreviousChange: (checked: boolean) => void;
}) {
	const listId = useId();
	const timeline = getRoomHistoryTimeline(
		snapshot,
		navigation?.serverNow() ?? Date.now(),
		showResult,
		navigation?.previousDraws,
		navigation?.legacyHistory,
	);
	const version = snapshot?.candidateSetVersion ?? snapshot?.listVersion;
	const current = timeline.filter(
		(entry) =>
			entry.kind !== "change" &&
			version !== undefined &&
			entry.version === version,
	);
	const hasPrevious = current.length < timeline.length;
	const entries = includePrevious ? timeline : current;
	return (
		<>
			<div className="picnic-ledger-heading room-win-heading">
				<DialogTitle ref={titleRef} tabIndex={-1}>
					당첨 내역
				</DialogTitle>
				{hasPrevious && (
					<Label className="room-win-filter">
						<Input
							type="checkbox"
							checked={includePrevious}
							aria-controls={listId}
							onChange={(event) =>
								onIncludePreviousChange(event.currentTarget.checked)
							}
						/>
						이전 게임 포함
					</Label>
				)}
			</div>
			<div
				id={listId}
				className="picnic-ledger-panel room-win-history"
				style={{ "--win-count": timeline.length } as CSSProperties}
			>
				{entries.length ? (
					<WinList
						key={includePrevious ? "all" : "current"}
						entries={entries}
						navigation={navigation}
					/>
				) : (
					<p className="room-draw-exclusion-note room-win-empty">
						{hasPrevious
							? "현재 후보로 당첨된 내역이 없어요."
							: "아직 당첨 내역이 없어요."}
					</p>
				)}
			</div>
		</>
	);
}

function WinList({
	entries,
	navigation,
}: {
	entries: RoomHistoryEvent[];
	navigation?: RoomHistoryNavigation;
}) {
	const pageSize = lunchRoomLimits.maxHistory;
	const [limit, setLimit] = useState<number>(pageSize);
	const returnIndex = navigation?.returnDrawId
		? entries.findIndex(
				(entry) =>
					entry.kind === "draw" && entry.id === navigation.returnDrawId,
			)
		: -1;
	const visibleCount = Math.max(
		limit,
		Math.ceil((returnIndex + 1) / pageSize) * pageSize,
	);
	return (
		<section
			className="room-draw-exclusion-scroll room-win-scroll"
			aria-label="당첨 목록"
			// biome-ignore lint/a11y/noNoninteractiveTabindex: Allow keyboard scrolling through older winner-only rows.
			tabIndex={0}
		>
			<ol>
				{entries.slice(0, visibleCount).map((entry) => {
					if (entry.kind === "draw")
						return (
							<WinningDraw
								key={`win-${entry.id}`}
								draw={entry.draw}
								navigation={navigation}
							/>
						);
					if (entry.kind === "change")
						return (
							<li key={`change-${entry.id}`} className="room-history-change">
								<div>
									<strong>후보 변경</strong>
									{entry.exactTime && <WinTime timestamp={entry.timestamp} />}
								</div>
								{entry.summary && <span>{entry.summary}</span>}
							</li>
						);
					return (
						<li
							key={`win-${entry.id}`}
							className="room-win-static room-win-summary"
						>
							<strong>{entry.name}</strong>
							<WinTime timestamp={entry.timestamp} />
						</li>
					);
				})}
			</ol>
			{entries.length > visibleCount && (
				<Button
					variant="ghost"
					size="touch"
					onClick={() => setLimit(visibleCount + pageSize)}
				>
					이전 기록 더 보기
				</Button>
			)}
		</section>
	);
}
