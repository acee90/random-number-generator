import { History, RotateCcw } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
import "./room-exclusion-panel.css";

const dateTime = new Intl.DateTimeFormat("ko-KR", {
	month: "numeric",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	hour12: false,
});

export type ExclusionOptions = {
	snapshot: RoomSnapshot | null;
	isHost: boolean;
	locked: boolean;
	busy: boolean;
	showResult: boolean;
	onToggle: (checked: boolean, revision: number) => Promise<boolean>;
	onReset: (revision: number) => Promise<boolean>;
};

export default function RoomExclusionPanel({
	snapshot,
	isHost,
	locked,
	busy,
	showResult,
	onToggle,
	onReset,
}: ExclusionOptions) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const [resetRevision, setResetRevision] = useState<number | null>(null);
	const [resetError, setResetError] = useState("");
	const [toggleError, setToggleError] = useState("");
	const titleRef = useRef<HTMLHeadingElement>(null);
	const popupRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLElement>(null);
	const listRef = useRef<HTMLOListElement>(null);
	const phase = snapshot ? getRoomPhase(snapshot) : "waiting";
	const excludeDrawn = snapshot?.excludeDrawn ?? false;
	const revision = snapshot?.revision ?? snapshot?.listVersion ?? 1;
	const rows = open ? getRoomExclusionHistory(snapshot) : [];
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

	useEffect(() => {
		const region = scrollRef.current,
			list = listRef.current;
		if (!hasRows || !region || !list || typeof ResizeObserver === "undefined")
			return;
		function measure() {
			if (region) setOverflowing(region.scrollHeight > region.clientHeight + 1);
		}
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(region);
		observer.observe(list);
		return () => observer.disconnect();
	}, [hasRows]);

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
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) setResetRevision(null);
				setResetError("");
			}}
		>
			<div className="picnic-options">
				<Label
					htmlFor={id}
					className="picnic-exclusion"
					data-disabled={disabled || undefined}
				>
					중복 없이 추첨
					<Switch
						id={id}
						checked={excludeDrawn}
						disabled={disabled}
						aria-label="중복 없이 추첨 · 뽑힌 후보 제외"
						aria-description={note ?? undefined}
						onCheckedChange={(checked) => void changeSetting(checked)}
					/>
				</Label>
				<DialogTrigger asChild>
					<Button
						variant="outline"
						size="auto"
						className="picnic-history-button"
						aria-label="당첨 제외 내역 열기"
						title="당첨 제외 내역"
					>
						<History size={16} aria-hidden />
						<span>제외 내역</span>
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
					ref={popupRef}
					container={container}
					className="picnic-popup"
					aria-modal="true"
					inert={resetRevision !== null}
					aria-describedby={undefined}
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						popupRef.current?.scrollIntoView?.({
							block: "nearest",
							inline: "nearest",
							behavior: "instant",
						});
						titleRef.current?.focus({ preventScroll: true });
					}}
				>
					<div className="picnic-ledger-heading">
						<DialogTitle ref={titleRef} tabIndex={-1}>
							당첨 제외 내역
						</DialogTitle>
						<span>{rows.length}개</span>
					</div>
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
									disabled={disabled || !snapshot?.excludedIds?.length}
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
								<AlertDialogTitle>제외 목록을 초기화할까요?</AlertDialogTitle>
								<AlertDialogDescription>
									당첨 제외 내역만 비웁니다. 후보 원본, 직접 제외, 지난 기록과
									현재 결과는 유지됩니다.
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
				</DialogContent>
			)}
		</Dialog>
	);
}
