import { ArrowDown, RotateCcw } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getRoomPhase, type RoomSnapshot } from "@/lib/lunchRoom";
import {
	getRoomExclusionHistory,
	roomExclusionRoundLabel,
} from "@/lib/roomExclusionHistory";
import "./room-exclusion-panel.css";

const dateTime = new Intl.DateTimeFormat("ko-KR", {
	month: "numeric",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

export default function RoomExclusionPanel({
	snapshot,
	isHost,
	locked,
	busy,
	showResult,
	onToggle,
	onReset,
}: {
	snapshot: RoomSnapshot | null;
	isHost: boolean;
	locked: boolean;
	busy: boolean;
	showResult: boolean;
	onToggle: (checked: boolean) => void;
	onReset: () => void;
}) {
	const id = useId();
	const phase = snapshot ? getRoomPhase(snapshot) : "waiting";
	const excludeDrawn = snapshot?.excludeDrawn ?? false;
	const rows = getRoomExclusionHistory(snapshot);
	const rowKey = rows
		.map((entry) => `${entry.candidate.id}:${entry.record?.drawnAt ?? ""}`)
		.join("|");
	const scrollRef = useRef<HTMLElement>(null);
	const listRef = useRef<HTMLOListElement>(null);
	const [overflowing, setOverflowing] = useState(rows.length > 4);
	const inProgress = busy || ["fetching", "drawing"].includes(phase);
	const disabled = !isHost || locked || inProgress || phase === "closed";
	const partialNumbers = rows.some(
		(entry) => entry.record?.roundNumberIsExact === false,
	);

	useEffect(() => {
		if (!rowKey) {
			setOverflowing(false);
			return;
		}
		const region = scrollRef.current;
		const list = listRef.current;
		if (!region || !list) {
			setOverflowing(false);
			return;
		}
		function measure() {
			if (region && region.clientHeight > 0)
				setOverflowing(region.scrollHeight > region.clientHeight + 1);
		}
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(region);
		observer.observe(list);
		return () => observer.disconnect();
	}, [rowKey]);

	const note = inProgress
		? "추첨 후 변경할 수 있어요."
		: showResult
			? "다음 추첨부터 적용돼요."
			: null;

	return (
		<aside className="room-draw-exclusions" aria-label="후보 제외 목록">
			<div className="room-draw-exclusion-toggle">
				<Label htmlFor={`${id}-enabled`}>중복 없이 추첨</Label>
				<Switch
					id={`${id}-enabled`}
					size="lg"
					aria-label="중복 없이 추첨 · 뽑힌 후보 제외"
					aria-describedby={note ? `${id}-note` : undefined}
					checked={excludeDrawn}
					disabled={disabled}
					onCheckedChange={onToggle}
				/>
			</div>
			{note && (
				<p className="room-draw-exclusion-note" id={`${id}-note`}>
					{note}
				</p>
			)}
			<div className="room-draw-exclusion-heading">
				<h3>{excludeDrawn ? "당첨 제외 내역" : "저장된 당첨 내역"}</h3>
				<span className="room-draw-exclusion-count">
					{rows.length}
					<span className="sr-only">개</span>
				</span>
			</div>
			{rows.length > 0 && (
				<>
					<div className="room-draw-exclusion-order">
						<span>최근 추첨순</span>
						{overflowing && (
							<span id={`${id}-scroll-note`}>
								<ArrowDown size={12} aria-hidden="true" /> 스크롤
							</span>
						)}
					</div>
					<section
						className="room-draw-exclusion-scroll"
						ref={scrollRef}
						// biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded ledger must be keyboard-scrollable.
						tabIndex={0}
						aria-label="당첨 제외 내역 스크롤"
						aria-describedby={overflowing ? `${id}-scroll-note` : undefined}
					>
						<ol ref={listRef} aria-label="당첨 제외 내역">
							{rows.map(({ candidate, record }) => (
								<li key={candidate.id}>
									<strong>{candidate.name}</strong>
									<div className="room-draw-exclusion-meta">
										<span>{roomExclusionRoundLabel(record)}</span>
										{record ? (
											<time dateTime={new Date(record.drawnAt).toISOString()}>
												{dateTime.format(record.drawnAt)}
											</time>
										) : (
											<span>시각 정보 없음</span>
										)}
									</div>
								</li>
							))}
						</ol>
					</section>
					{partialNumbers && (
						<p className="room-draw-exclusion-note">
							‘기록’ 번호는 남아 있는 추첨 기록 기준입니다.
						</p>
					)}
				</>
			)}
			{isHost && (snapshot?.excludedIds?.length ?? 0) > 0 && (
				<Button
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={onReset}
				>
					<RotateCcw size={14} aria-hidden="true" /> 제외 목록 초기화
				</Button>
			)}
		</aside>
	);
}
