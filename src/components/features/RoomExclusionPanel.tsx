import { History, RotateCcw } from "lucide-react";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getRoomPhase, type RoomSnapshot } from "@/lib/lunchRoom";
import {
	getRoomExclusionHistory,
	roomExclusionRoundLabel,
} from "@/lib/roomExclusionHistory";
import { getRoomHistoryTimeline } from "@/lib/roomWinHistory";
import RoomWinHistory, { type RoomHistoryNavigation } from "./RoomWinHistory";
import "./room-exclusion-panel.css";

const dateTime = new Intl.DateTimeFormat("ko-KR", {
	month: "numeric",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

export type ExclusionOptions = {
	history?: RoomHistoryNavigation;
	snapshot: RoomSnapshot | null;
	isHost: boolean;
	locked: boolean;
	busy: boolean;
	showResult: boolean;
	onToggle: (checked: boolean, revision: number) => Promise<boolean>;
	onReset: (revision: number) => Promise<boolean>;
};

function fitHistoryToBoard(popup: HTMLElement, layer: HTMLElement) {
	const column = layer.closest(".room-primary-column");
	const viewport = window.visualViewport;
	function position() {
		const board = layer.getBoundingClientRect();
		if (!board.width || !board.height) return;
		const pane = column?.getBoundingClientRect() ?? board;
		const viewX = viewport?.offsetLeft ?? 0;
		const viewY = viewport?.offsetTop ?? 0;
		const left = Math.max(board.left, pane.left, viewX);
		const top = Math.max(board.top, pane.top, viewY);
		const width =
			Math.min(
				board.right,
				pane.right,
				viewX + (viewport?.width ?? window.innerWidth),
			) - left;
		const height =
			Math.min(
				board.bottom,
				pane.bottom,
				viewY + (viewport?.height ?? window.innerHeight),
			) - top;
		if (width <= 0 || height <= 0) return;
		// Percentages keep the portal in board coordinates, including under browser zoom.
		popup.style.setProperty(
			"--win-x",
			`${(100 * (left + width / 2 - board.left)) / board.width}%`,
		);
		popup.style.setProperty(
			"--win-y",
			`${(100 * (top + height / 2 - board.top)) / board.height}%`,
		);
		popup.style.setProperty("--win-width", `${(100 * width) / board.width}%`);
		popup.style.setProperty(
			"--win-height",
			`${(100 * height) / board.height}%`,
		);
	}
	position();
	const observer =
		typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
	observer?.observe(layer);
	if (column) observer?.observe(column);
	column?.addEventListener("scroll", position);
	window.addEventListener("scroll", position);
	window.addEventListener("resize", position);
	viewport?.addEventListener("scroll", position);
	viewport?.addEventListener("resize", position);
	return () => {
		observer?.disconnect();
		column?.removeEventListener("scroll", position);
		window.removeEventListener("scroll", position);
		window.removeEventListener("resize", position);
		viewport?.removeEventListener("scroll", position);
		viewport?.removeEventListener("resize", position);
	};
}

export default function RoomExclusionPanel({
	snapshot,
	isHost,
	locked,
	busy,
	showResult,
	onToggle,
	onReset,
	history,
}: ExclusionOptions) {
	const id = useId();
	const [localOpen, setLocalOpen] = useState(false);
	const open = history?.open ?? localOpen;
	const [panel, setPanel] = useState<"current" | "all" | "exclusions">(
		"current",
	);
	const showingExclusions = panel === "exclusions";
	const switchRef = useRef<HTMLButtonElement>(null);
	const exclusionTrigger = useRef<HTMLButtonElement>(null);
	const localHistoryTrigger = useRef<HTMLButtonElement>(null);
	const historyTrigger = history?.triggerRef ?? localHistoryTrigger;
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const [resetRevision, setResetRevision] = useState<number | null>(null);
	const [resetError, setResetError] = useState("");
	const [toggleError, setToggleError] = useState("");
	const localTitleRef = useRef<HTMLHeadingElement>(null);
	const titleRef = history?.titleRef ?? localTitleRef;
	const [popup, setPopup] = useState<HTMLDivElement | null>(null);
	const scrollRef = useRef<HTMLElement>(null);
	const listRef = useRef<HTMLOListElement>(null);
	const phase = snapshot ? getRoomPhase(snapshot) : "waiting";
	const excludeDrawn = snapshot?.excludeDrawn ?? false;
	const revision = snapshot?.revision ?? snapshot?.listVersion ?? 1;
	const rows = useMemo(() => getRoomExclusionHistory(snapshot), [snapshot]);
	const drawCount = useMemo(
		() =>
			getRoomHistoryTimeline(
				snapshot,
				history?.serverNow() ?? Date.now(),
				showResult,
				history?.previousDraws,
				history?.legacyHistory,
			).filter((entry) => entry.kind !== "change").length,
		[snapshot, history, showResult],
	);
	const hasRows = rows.length > 0;
	const [overflowing, setOverflowing] = useState(false);
	const inProgress = busy || phase === "fetching" || phase === "drawing";
	const disabled = !isHost || locked || inProgress || phase === "closed";
	const partialNumbers = rows.some(
		(entry) => entry.record?.roundNumberIsExact === false,
	);
	const note = inProgress
		? "추첨 후 변경할 수 있어요."
		: !excludeDrawn && snapshot?.excludedIds?.length
			? showResult
				? "다음 게임으로 넘어가면 제외 내역을 비워요."
				: "다음 추첨을 시작하면 제외 내역을 비워요."
			: showResult && !excludeDrawn
				? "켜면 이번 당첨부터 제외해요."
				: null;

	useLayoutEffect(() => {
		if (!open || !container) return;
		// The portal lives inside the board. Its background spans siblings at each level.
		const background: HTMLElement[] = [];
		for (
			let node: HTMLElement | null = container;
			node?.parentElement && node !== document.body;
			node = node.parentElement
		) {
			for (const sibling of node.parentElement.children) {
				if (
					sibling !== node &&
					sibling instanceof HTMLElement &&
					!sibling.hasAttribute("inert")
				) {
					sibling.setAttribute("inert", "");
					background.push(sibling);
				}
			}
		}
		return () => {
			for (const el of background) el.removeAttribute("inert");
		};
	}, [open, container]);

	useLayoutEffect(() => {
		if (!popup || !container) return;
		if (!showingExclusions) return fitHistoryToBoard(popup, container);
		const reveal = () =>
			popup.scrollIntoView?.({
				block: "nearest",
				inline: "nearest",
				behavior: "instant",
			});
		reveal();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(reveal);
		observer.observe(popup);
		return () => observer.disconnect();
	}, [popup, container, showingExclusions]);

	useEffect(() => {
		const region = scrollRef.current,
			list = listRef.current;
		if (
			!open ||
			!showingExclusions ||
			!hasRows ||
			!region ||
			!list ||
			typeof ResizeObserver === "undefined"
		)
			return;
		function measure() {
			if (region) setOverflowing(region.scrollHeight > region.clientHeight + 1);
		}
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(region);
		observer.observe(list);
		return () => observer.disconnect();
	}, [open, showingExclusions, hasRows]);

	function changeOpen(next: boolean) {
		if (history) history.onOpenChange(next);
		else setLocalOpen(next);
		if (!next) setResetRevision(null);
		setResetError("");
	}

	async function changeSetting(checked: boolean) {
		setToggleError("");
		if (!(await onToggle(checked, revision)))
			setToggleError("설정을 변경하지 못했어요. 다시 시도해 주세요.");
	}
	async function reset() {
		if (resetRevision !== revision || disabled) {
			setResetError(
				"게임 조건이 바뀌었어요. 목록을 확인한 뒤 다시 진행해 주세요.",
			);
		} else if (!(await onReset(revision))) {
			setResetError("제외 목록을 초기화하지 못했어요. 다시 시도해 주세요.");
		}
	}

	return (
		<Dialog open={open} onOpenChange={changeOpen}>
			<div className="picnic-options">
				<div
					className="picnic-exclusion-group"
					data-has-exclusions={hasRows || undefined}
				>
					<Label
						htmlFor={id}
						className="picnic-exclusion"
						data-disabled={disabled || undefined}
					>
						<span>
							중복 없이<span className="picnic-draw-word"> 추첨</span>
						</span>
						<Switch
							ref={switchRef}
							id={id}
							checked={excludeDrawn}
							disabled={disabled}
							aria-label="중복 없이 추첨 · 뽑힌 후보 제외"
							aria-description={note ?? undefined}
							onCheckedChange={(checked) => void changeSetting(checked)}
						/>
					</Label>
					{hasRows && (
						<Button
							ref={exclusionTrigger}
							variant="ghost"
							size="auto"
							className="picnic-exclusion-count"
							aria-label={`당첨 제외 후보 ${rows.length}개 보기`}
							aria-haspopup="dialog"
							aria-expanded={open && showingExclusions}
							aria-controls={open && showingExclusions ? popup?.id : undefined}
							onClick={() => {
								setPanel("exclusions");
								changeOpen(true);
							}}
						>
							제외 {rows.length}
						</Button>
					)}
				</div>
				<DialogTrigger asChild>
					<Button
						variant="outline"
						size="auto"
						className="picnic-history-button"
						ref={historyTrigger}
						onClick={() => setPanel("current")}
						aria-label="당첨 내역 열기"
						aria-description={`${drawCount}건 쌓임`}
						title="당첨 내역"
					>
						<History size={16} aria-hidden />
						<span>당첨 내역</span>
						<span className="picnic-history-count" aria-hidden="true">
							{drawCount}
						</span>
					</Button>
				</DialogTrigger>
				{toggleError && (
					<p className="picnic-options-error" role="alert">
						{toggleError}
					</p>
				)}
			</div>
			<div className="picnic-popup-layer" ref={setContainer} />
			{container && (
				<DialogContent
					ref={setPopup}
					container={container}
					className="picnic-popup"
					aria-modal="true"
					inert={resetRevision !== null}
					aria-describedby={undefined}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						const record = history?.recordRef.current;
						if (
							record?.isConnected &&
							record.dataset.drawId === history?.returnDrawId
						) {
							record.focus({ preventScroll: true });
							record.scrollIntoView?.({
								block: "nearest",
								inline: "nearest",
								behavior: "instant",
							});
						} else titleRef.current?.focus({ preventScroll: true });
					}}
					onCloseAutoFocus={(event) => {
						if (showingExclusions) {
							event.preventDefault();
							const fallback = switchRef.current?.disabled
								? historyTrigger.current
								: switchRef.current;
							(exclusionTrigger.current ?? fallback)?.focus({
								preventScroll: true,
							});
						} else if (history?.returnDrawId) event.preventDefault();
					}}
				>
					{showingExclusions && (
						<div className="picnic-ledger-heading">
							<DialogTitle ref={titleRef} tabIndex={-1}>
								당첨 제외 후보
							</DialogTitle>
							<span>{rows.length}개</span>
						</div>
					)}
					{!showingExclusions ? (
						<RoomWinHistory
							snapshot={snapshot}
							showResult={showResult}
							navigation={history}
							titleRef={titleRef}
							includePrevious={panel === "all"}
							onIncludePreviousChange={(checked) =>
								setPanel(checked ? "all" : "current")
							}
						/>
					) : (
						<div className="picnic-ledger-panel">
							{rows.length ? (
								<>
									<div className="room-draw-exclusion-order">
										최근 추첨순
										{overflowing && <span id={`${id}-scroll`}>스크롤</span>}
									</div>
									<section
										className="room-draw-exclusion-scroll"
										ref={scrollRef}
										// biome-ignore lint/a11y/noNoninteractiveTabindex: The bounded ledger must be keyboard-scrollable.
										tabIndex={0}
										aria-label="당첨 제외 내역 스크롤"
										aria-describedby={overflowing ? `${id}-scroll` : undefined}
									>
										<ol ref={listRef} aria-label="당첨 제외 내역">
											{rows.map(({ candidate, record }) => (
												<li key={candidate.id}>
													<strong>{candidate.name}</strong>
													<div className="room-draw-exclusion-meta">
														<span>{roomExclusionRoundLabel(record)}</span>
														{record ? (
															<time
																dateTime={new Date(
																	record.drawnAt,
																).toISOString()}
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
							) : (
								<p className="room-draw-exclusion-note">
									아직 제외된 후보가 없어요.
								</p>
							)}
							{note && <p className="room-draw-exclusion-note">{note}</p>}
							{resetError && <p role="alert">{resetError}</p>}
							{((isHost && (excludeDrawn || hasRows)) ||
								resetRevision !== null) && (
								<AlertDialog
									open={resetRevision !== null}
									onOpenChange={(next) => {
										setResetRevision(next ? revision : null);
										if (next) setResetError("");
									}}
								>
									<AlertDialogTrigger asChild>
										<Button
											variant="ghost"
											size="auto"
											className="picnic-reset"
											disabled={disabled || !hasRows}
										>
											<RotateCcw size={15} aria-hidden />
											제외 목록 초기화
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent
										container={container}
										className="picnic-popup picnic-confirm"
										aria-modal="true"
										onCloseAutoFocus={(event) => {
											event.preventDefault();
											titleRef.current?.focus({ preventScroll: true });
										}}
									>
										<AlertDialogTitle>
											제외 목록을 초기화할까요?
										</AlertDialogTitle>
										<AlertDialogDescription>
											당첨 제외 내역만 비웁니다. 후보 원본, 직접 제외, 당첨
											내역과 현재 결과는 유지됩니다.
										</AlertDialogDescription>
										<AlertDialogFooter>
											<AlertDialogCancel>취소</AlertDialogCancel>
											<AlertDialogAction onClick={() => void reset()}>
												초기화
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
						</div>
					)}
				</DialogContent>
			)}
		</Dialog>
	);
}
