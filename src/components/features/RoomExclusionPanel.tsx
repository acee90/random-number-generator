import { ChevronDown, RotateCcw } from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { getRoomPhase, type RoomSnapshot } from "@/lib/lunchRoom";
import {
	getRoomExclusionHistory,
	roomExclusionRoundLabel,
} from "@/lib/roomExclusionHistory";
import type { ExclusionSetting } from "./RoomGameStage";
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
	action,
	renderGame,
	onToggle,
	onReset,
}: {
	snapshot: RoomSnapshot | null;
	isHost: boolean;
	locked: boolean;
	busy: boolean;
	showResult: boolean;
	action?: ReactNode;
	renderGame: (setting: ExclusionSetting, panel: ReactNode) => ReactNode;
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
	const panelRef = useRef<HTMLElement>(null);
	const [compact, setCompact] = useState(false);
	const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
	const expanded = expandedByUser ?? !compact;
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
		if (!expanded) return;
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
	}, [rowKey, expanded]);

	const note = inProgress
		? "추첨 후 변경할 수 있어요."
		: !excludeDrawn && rows.length > 0
			? showResult
				? "다음 게임으로 넘어가면 제외 내역을 비워요."
				: "다음 추첨을 시작하면 제외 내역을 비워요."
			: showResult && !excludeDrawn
				? "켜면 이번 당첨부터 제외해요."
				: null;

	const setting = {
		checked: excludeDrawn,
		disabled,
		descriptionId: note ? `${id}-note` : undefined,
		onToggle,
	};
	const showLedger = Boolean(action || note || excludeDrawn || rows.length);
	const showReset = isHost && (excludeDrawn || rows.length > 0);
	useLayoutEffect(() => {
		const panel = panelRef.current;
		if (!panel || !showLedger) return;
		const column = panel.closest<HTMLElement>(".room-primary-column");
		function measure() {
			if (panel?.clientWidth) {
				const availableHeight = column?.clientHeight || window.innerHeight;
				setCompact(panel.clientWidth < 600 || availableHeight < 550);
			}
		}
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(panel);
		if (column) observer.observe(column);
		return () => observer.disconnect();
	}, [showLedger]);
	const panel = showLedger ? (
		<aside
			className="room-draw-exclusions"
			ref={panelRef}
			data-result={showResult || undefined}
			aria-label={showResult ? "다음 게임 준비" : "후보 제외 목록"}
		>
			{(action || excludeDrawn || rows.length > 0) && (
				<div className="room-draw-exclusion-toggle">
					{(excludeDrawn || rows.length > 0) && (
						<h3 className="picnic-history-heading" aria-label="당첨 제외 내역">
							<Button
								variant="ghost"
								size="auto"
								className="picnic-history-toggle"
								aria-expanded={expanded}
								aria-controls={`${id}-entries`}
								onClick={() => setExpandedByUser(!expanded)}
							>
								<span>당첨 제외 내역</span>
								<span className="picnic-history-count">
									{rows.length}
									<span className="sr-only">개</span>
								</span>
								<ChevronDown size={16} aria-hidden="true" />
							</Button>
						</h3>
					)}
					{showReset && (
						<Button
							className="picnic-history-reset"
							variant="ghost"
							size="icon"
							aria-label="제외 목록 초기화"
							title="제외 목록 초기화"
							disabled={disabled || (snapshot?.excludedIds?.length ?? 0) === 0}
							onClick={onReset}
						>
							<RotateCcw size={14} aria-hidden="true" />
						</Button>
					)}
					{action}
				</div>
			)}
			{note && (
				<p className="room-draw-exclusion-note" id={`${id}-note`}>
					{note}
				</p>
			)}
			{(excludeDrawn || rows.length > 0) && (
				<div id={`${id}-entries`} hidden={!expanded}>
					{rows.length === 0 ? (
						<p className="room-draw-exclusion-note">
							아직 제외된 후보가 없어요.
						</p>
					) : (
						<>
							<div className="room-draw-exclusion-order">
								<span>최근 추첨순</span>
								{overflowing && <span id={`${id}-scroll-note`}>스크롤</span>}
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
													<time
														dateTime={new Date(record.drawnAt).toISOString()}
													>
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
				</div>
			)}
		</aside>
	) : null;
	return (
		<div className="room-lifecycle-main">{renderGame(setting, panel)}</div>
	);
}
