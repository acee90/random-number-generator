import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import CopyFallback from "@/components/features/CopyFallback";
import { roomCandidateNumbers } from "@/components/features/RoomCandidateList";
import RoomChatPanel from "@/components/features/RoomChatPanel";
import RoomDrawDialog from "@/components/features/RoomDrawDialog";
import RoomEntryGate from "@/components/features/RoomEntryGate";
import RoomGameStage from "@/components/features/RoomGameStage";
import RoomHeader from "@/components/features/RoomHeader";
import RoomLifecyclePanel from "@/components/features/RoomLifecyclePanel";
import SiteHeader from "@/components/layout/SiteHeader";
import { useDrawSound } from "@/hooks/useDrawPresentation";
import type { useLunchRoom } from "@/hooks/useLunchRoom";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import { useSpinAdjustment } from "@/hooks/useSpinAdjustment";
import { type DrawView, drawViewLabels } from "@/lib/drawView";
import type { LunchHistoryRecord } from "@/lib/lunchHistory";
import {
	getEligibleRoomCandidates,
	getRoomDrawView,
	getRoomPhase,
	type RoomDraw,
	type RoomDrawStartOptions,
} from "@/lib/lunchRoom";
import { getRoomArchiveDraws } from "@/lib/roomGame";
import {
	changeSpinDrive,
	getSpinDeadline,
	getSpinLanding,
	type SpinDrive,
	startSpinDrive,
} from "@/lib/spinDrive";
import ClosedRoomHistory, {
	ClosedRoomArchive,
	RoomTerminalActions,
} from "./ClosedRoomHistory";
import "./lunch-room.css";
import "./lunch-room-mobile.css";

type RoomView = "wheel" | "history";
type CopyKind = "invite";
type LocalSpin = {
	id: string;
	mode: DrawView;
	drive: SpinDrive;
};

/** Shared presentation; transports and local session state live in their hooks. */
export default function LunchSessionPage({
	room,
	roomId,
	solo = false,
	legacyHistory = [],
	previousDraws = [],
	storageFailed = false,
}: {
	room: ReturnType<typeof useLunchRoom>;
	roomId: string;
	solo?: boolean;
	legacyHistory?: readonly LunchHistoryRecord[];
	previousDraws?: readonly RoomDraw[];
	storageFailed?: boolean;
}) {
	const id = useId();
	const [view, setView] = useState<RoomView>("wheel");
	const [chatCollapsed, setChatCollapsed] = useState(false);
	const [reducedMotion, setReducedMotion] = useState(false);
	const [localLaunch, setLocalLaunch] = useState(false);
	const localSpinRef = useRef<LocalSpin | null>(null);
	const [localSpin, setLocalSpin] = useState<LocalSpin | null>(null);
	const [copied, setCopied] = useState<CopyKind | null>(null);
	const [copyHelp, setCopyHelp] = useState<{
		kind: CopyKind;
		text: string;
	} | null>(null);
	const [inviteUrl, setInviteUrl] = useState("");
	const [selectedDraw, setSelectedDraw] = useState<{
		draw: RoomDraw;
		votingWasOpen: boolean;
	} | null>(null);
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
	const chatInputRef = useRef<HTMLTextAreaElement>(null);
	const focusChatAfterExpand = useRef(false);
	const copyAttemptRef = useRef(0);
	const copyReturnRef = useRef<HTMLButtonElement | null>(null);
	const restoreCopyFocusRef = useRef(false);
	const focusResultRef = useRef(false);
	const snapshot = room.snapshot;
	const draw = snapshot?.draw ?? null;
	const drawMatchesCandidates = draw?.listVersion === snapshot?.listVersion;
	const drawArchived =
		snapshot?.history.some((entry) => entry.id === draw?.id) ?? false;
	const fetching = room.startPending || snapshot?.status === "fetching";
	const displayedDraw =
		fetching ||
		room.connection === "closed" ||
		(!drawMatchesCandidates && drawArchived)
			? null
			: draw;
	const phase = snapshot && getRoomPhase(snapshot);
	const boardVisible =
		phase !== "editing" && phase !== "collecting" && phase !== "reviewing";
	useEffect(() => {
		if (!boardVisible) setView("wheel");
	}, [boardVisible]);
	const viewMode = getRoomDrawView(snapshot);
	const viewLabel = drawViewLabels[viewMode];
	const serverDrive = displayedDraw?.drive;
	const optimisticSpin =
		localSpin &&
		((fetching && !displayedDraw) || displayedDraw?.id === localSpin.id) &&
		(!serverDrive || serverDrive.sequence < localSpin.drive.sequence) &&
		!(displayedDraw && snapshot?.status === "result")
			? localSpin
			: null;
	useLayoutEffect(() => {
		if (localSpin && !optimisticSpin && localSpinRef.current === localSpin) {
			localSpinRef.current = null;
			setLocalSpin(null);
		}
	}, [localSpin, optimisticSpin]);
	const finished = useRoomTimeline(
		optimisticSpin ? null : displayedDraw,
		room.clockOffset,
		rotorRef,
		reducedMotion,
		localLaunch,
	);
	const showResult = Boolean(
		displayedDraw &&
			finished &&
			(!displayedDraw.drive || snapshot?.status === "result"),
	);
	const drive = showResult ? undefined : (optimisticSpin?.drive ?? serverDrive);
	const driveId = optimisticSpin?.id ?? displayedDraw?.id;
	const eligibleCandidates = snapshot
		? getEligibleRoomCandidates(snapshot)
		: [];
	const places =
		(drawMatchesCandidates || viewMode === "slot-v1"
			? displayedDraw?.candidates
			: undefined) ?? eligibleCandidates;
	const driveAdjustment = useSpinAdjustment(
		driveId,
		drive,
		viewMode,
		room.clockOffset,
		places.length,
	);
	const spinning = Boolean(optimisticSpin || (displayedDraw && !showResult));
	useEffect(() => {
		if (!fetching && !spinning) setLocalLaunch(false);
	}, [fetching, spinning]);
	const busy = fetching || spinning || room.nextPending;
	const connected = room.connection === "connected";
	const isHost = connected && room.self?.isHost === true;
	const winner =
		displayedDraw && showResult
			? displayedDraw.candidates[displayedDraw.winnerIndex]
			: null;
	const participants = snapshot?.participants ?? [];
	const hostOnline = participants.some((participant) => participant.isHost);
	const canStart =
		isHost &&
		!busy &&
		!room.candidatesPending &&
		!room.mutationPending &&
		Boolean(snapshot && getRoomPhase(snapshot) === "waiting") &&
		eligibleCandidates.length >= 1;
	const closed = room.connection === "closed";
	const awaitingEntry =
		!closed && (room.entryLoading || room.waitingForEntry || room.entryPending);
	const presentationScope = closed || awaitingEntry ? null : roomId;
	const sound = useDrawSound(
		presentationScope,
		connected && (view === "wheel" || viewMode === "slot-v1"),
		driveId,
		showResult
			? "result"
			: spinning &&
					(!displayedDraw || room.serverNow() < getSpinDeadline(displayedDraw))
				? "spinning"
				: null,
		viewMode,
	);
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
		if (!solo)
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
	}, [roomId, solo]);
	useEffect(() => {
		if (
			showResult &&
			!selectedDraw &&
			focusResultRef.current &&
			view === "wheel"
		) {
			resultTitleRef.current?.focus({ preventScroll: viewMode === "slot-v1" });
			focusResultRef.current = false;
		}
	}, [showResult, view, selectedDraw, viewMode]);
	const focusNextRoundRef = useRef(false);
	const [editingAfterResult, setEditingAfterResult] = useState(false);
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
		if (!chatCollapsed && focusChatAfterExpand.current) {
			focusChatAfterExpand.current = false;
			chatInputRef.current?.focus();
		}
	}, [chatCollapsed]);
	function changeView(next: RoomView) {
		historyRecordFocusRef.current = null;
		setSelectedDraw(null);
		focusResultRef.current = false;
		copyAttemptRef.current++;
		setCopyHelp(null);
		setView(next);
	}
	function keepChatFocus() {
		focusResultRef.current = false;
		focusNextRoundRef.current = false;
	}
	function openRecord(draw: RoomDraw, trigger: HTMLButtonElement) {
		historyRecordFocusRef.current = draw.id;
		focusResultRef.current = false;
		selectedDrawTriggerRef.current = trigger;
		setSelectedDraw({
			draw: structuredClone(draw),
			votingWasOpen: draw.id === snapshot?.draw?.id && !drawArchived,
		});
	}
	function start(options?: RoomDrawStartOptions) {
		if (!room.startDraw(options)) return false;
		setLocalLaunch(true);
		copyAttemptRef.current++;
		setCopyHelp(null);
		setCopied(null);
		setView("wheel");
		focusResultRef.current = true;
		return true;
	}
	function beginDrive(
		requestStart: (options: RoomDrawStartOptions) => boolean,
	) {
		const id = crypto.randomUUID();
		if (!requestStart({ driveId: id })) return false;
		const local = {
			id,
			mode: viewMode,
			drive: startSpinDrive(room.serverNow(), viewMode),
		};
		localSpinRef.current = local;
		setLocalSpin(local);
		return true;
	}
	function changeDrive(held: boolean) {
		const pending =
			localSpinRef.current === localSpin
				? optimisticSpin
				: localSpinRef.current;
		const current = pending?.drive ?? serverDrive;
		const id = pending?.id ?? displayedDraw?.id;
		if (!current || !id || current.held === held) return false;
		// Until the winner arrives, coast to a full turn or any integer slot row.
		const target =
			displayedDraw?.id === id
				? getSpinLanding(displayedDraw)
				: {
						mode: pending?.mode ?? viewMode,
						landing: 0,
						period: 1,
					};
		const updated = changeSpinDrive(
			current,
			held,
			current.sequence + 1,
			room.serverNow(),
			target.mode,
			target.landing,
			target.period,
		);
		if (updated === current) return false;
		const next = { id, mode: target.mode, drive: updated };
		localSpinRef.current = next;
		setLocalSpin(next);
		room.setDriveHeld(id, held, updated.sequence);
		return true;
	}
	function redraw(options?: RoomDrawStartOptions) {
		if (!displayedDraw || !snapshot) return false;
		return start({
			previousDrawId: displayedDraw.id,
			expectedRevision: snapshot.revision ?? snapshot.listVersion,
			...options,
		});
	}
	function advanceRound(editCandidates = false) {
		if (!displayedDraw) return false;
		const accepted = editCandidates
			? room.nextRound(displayedDraw.id, true)
			: room.nextRound(displayedDraw.id);
		if (!accepted) return false;
		focusNextRoundRef.current = !editCandidates;
		setEditingAfterResult(editCandidates);
		copyAttemptRef.current++;
		setCopyHelp(null);
		setCopied(null);
		return true;
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
	const status =
		room.connection === "reconnecting"
			? "다시 연결 중"
			: !connected
				? "방에 연결 중"
				: drive || fetching || spinning
					? "추첨 중입니다."
					: winner
						? `추첨 결과: ${winner.name}`
						: isHost
							? "돌리기 버튼으로 추첨을 시작하세요."
							: hostOnline
								? "방장이 추첨을 시작하면 결과를 함께 볼 수 있습니다."
								: "방장이 오프라인입니다. 방장이 돌아오면 추첨을 시작할 수 있습니다.";

	if (awaitingEntry)
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
			className={`random-lab lunch-room${closed ? "" : " room-live"}`}
		>
			<RoomHeader
				room={room}
				solo={solo}
				busy={busy}
				canInvite={Boolean(inviteUrl)}
				copied={copied === "invite"}
				onCopyInvite={(button) => void copy(inviteUrl, "invite", button)}
			/>
			<main id="main-content" className="room-main">
				{storageFailed && (
					<output className="room-error" aria-live="polite">
						이 브라우저에 기록을 저장하거나 불러오지 못했습니다. 현재 화면에서는
						추첨을 계속할 수 있습니다.
					</output>
				)}
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
						<RoomTerminalActions />
						{solo ? (
							snapshot &&
							snapshot.expiresAt > room.serverNow() && (
								<ClosedRoomArchive
									roomId={roomId}
									archive={{
										title: snapshot.title,
										expiresAt: snapshot.expiresAt,
										draws: getRoomArchiveDraws(snapshot),
									}}
								/>
							)
						) : (
							<ClosedRoomHistory key={roomId} roomId={roomId} />
						)}
					</section>
				) : (
					<>
						{connected && !hostOnline && (
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
						<output className={sound.error ? "room-error" : "sr-only"}>
							{sound.error}
						</output>
						<div
							className="room-layout"
							data-chat-collapsed={solo ? undefined : chatCollapsed}
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
									key={roomId}
									busy={busy}
									showResult={showResult}
									onEditResult={
										showResult && isHost && !drawArchived
											? () => advanceRound(true)
											: undefined
									}
									onStart={start}
								>
									{(requestStart, exclusion) => (
										<section
											id={`${id}-draw-panel`}
											className="room-draw-panel"
											hidden={false}
											aria-labelledby={`${id}-wheel`}
										>
											<h2 id={`${id}-wheel`} className="sr-only">
												{viewLabel}
											</h2>
											<RoomGameStage
												viewMode={viewMode}
												activeDraw={displayedDraw}
												drive={drive}
												driveAdjustment={driveAdjustment}
												canDrive={
													isHost &&
													view === "wheel" &&
													!selectedDraw &&
													room.serverNow() < (drive?.stopAt ?? Infinity)
												}
												onDrivePress={(redrawing) =>
													drive
														? changeDrive(true)
														: beginDrive(redrawing ? redraw : requestStart)
												}
												onDriveRelease={() => {
													changeDrive(false);
												}}
												clockOffset={room.clockOffset}
												draw={showResult ? displayedDraw : null}
												wheel={{
													candidates: places,
													candidateNumbers: places.map(
														(place, index) =>
															roomCandidateNumbers.get(place.id) ?? index + 1,
													),
													rotation: showResult
														? (displayedDraw?.toRotation ?? 0)
														: 0,
													phase: fetching
														? "fetching"
														: spinning
															? "spinning"
															: winner
																? "done"
																: "idle",
													onComplete: () => {},
													onDraw: () => requestStart(),
													buttonId: `${id}-start`,
													errorId: room.error ? `${id}-error` : undefined,
													covered: !canStart,
													canDraw: isHost,
													drawLabel:
														places.length === 1
															? "마지막 후보 확정"
															: "룰렛 돌리기",
													drawText:
														places.length === 1 ? "후보 확정" : "돌리기",
													buttonRef: drawButtonRef,
													rotorRef,
													controlled: true,
												}}
												sound={sound}
												exclusion={{
													...exclusion,
													history: {
														open: view === "history" && !selectedDraw,
														onOpenChange: (open) =>
															changeView(open ? "history" : "wheel"),
														onRecord: openRecord,
														triggerRef: historyTriggerRef,
														titleRef: historyTitleRef,
														recordRef: selectedDrawTriggerRef,
														returnDrawId: historyRecordFocusRef.current,
														serverNow: room.serverNow,
														previousDraws,
														legacyHistory,
													},
												}}
												canNext={
													connected &&
													!busy &&
													!room.candidatesPending &&
													!room.mutationPending
												}
												reducedMotion={reducedMotion}
												nextPending={room.nextPending && !editingAfterResult}
												selfId={room.self?.id}
												isHost={room.self?.isHost === true}
												connected={connected}
												pending={Boolean(
													displayedDraw &&
														room.votePendingDrawId === displayedDraw.id,
												)}
												readOnly={drawArchived}
												onNext={() => advanceRound()}
												canRedraw={
													eligibleCandidates.length > 0 &&
													Boolean(
														snapshot && getRoomPhase(snapshot) === "result",
													)
												}
												canDriveRedraw={eligibleCandidates.length > 1}
												onRedraw={() => redraw()}
												onVote={room.vote}
												titleRef={resultTitleRef}
												titleId={`${id}-winner`}
											/>
											<output className="sr-only" aria-live="polite">
												{status}
											</output>
										</section>
									)}
								</RoomLifecyclePanel>
							</div>
							{!solo && (
								<RoomChatPanel
									key={roomId}
									room={room}
									roomId={roomId}
									collapsed={chatCollapsed}
									recordOpen={Boolean(selectedDraw)}
									inputRef={chatInputRef}
									onToggle={() => setChatCollapsed((value) => !value)}
									onInteract={keepChatFocus}
								/>
							)}
						</div>
					</>
				)}
			</main>
			{selectedDraw && !closed && (
				<RoomDrawDialog
					draw={selectedDraw.draw}
					votingWasOpen={selectedDraw.votingWasOpen}
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
