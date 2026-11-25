import {
	type ComponentProps,
	type CSSProperties,
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { useDrawSound } from "@/hooks/useDrawPresentation";
import { type FeedbackOptions, useRoomFeedback } from "@/hooks/useRoomFeedback";
import { useSpinInput } from "@/hooks/useSpinInput";
import { type DrawView, defaultDrawView, readDrawView } from "@/lib/drawView";
import type { RoomDraw } from "@/lib/lunchRoom";
import { getSpinDeadline, type SpinDrive } from "@/lib/spinDrive";
import DrawPresentationControls from "./DrawPresentationControls";
import type { SpinAdjustment } from "./game-art/spin-motion";
import { LunchWheel } from "./LunchWheel";
import {
	type Control,
	getWheelLabels,
	type StageScene,
	stageLayout,
	wheelControl,
} from "./picnic/layout";
import { PicnicArt } from "./picnic/PicnicArt";
import { roomCandidateNumbers } from "./RoomCandidateList";
import { RoomFeedbackDetails } from "./RoomDrawFeedback";
import RoomExclusionPanel, {
	type ExclusionOptions,
} from "./RoomExclusionPanel";
import RoomResultActions from "./RoomResultActions";

import SlotMachine from "./slot/SlotMachine";

type WheelProps = ComponentProps<typeof LunchWheel>;
type Props = Omit<FeedbackOptions, "draw"> & {
	draw: RoomDraw | null;
	viewMode?: DrawView;
	/** Frozen round used by the animation before draw is released to voting. */
	activeDraw?: RoomDraw | null;
	clockOffset?: number;
	drive?: SpinDrive;
	driveAdjustment?: SpinAdjustment;
	canDrive?: boolean;
	onDrivePress?: (redraw: boolean) => boolean;
	onDriveRelease?: () => void;
	showVoting?: boolean;
	isHost: boolean;
	wheel?: WheelProps;
	exclusion?: ExclusionOptions;
	sound?: ReturnType<typeof useDrawSound>;
	reducedMotion?: boolean;
	titleRef?: RefObject<HTMLHeadingElement | null>;
	titleId?: string;
	canNext?: boolean;
	nextPending?: boolean;
	onNext: () => void;
	canRedraw?: boolean;
	canDriveRedraw?: boolean;
	onRedraw: () => void;
};

function hitTarget(target: EventTarget | null): Control | null {
	return target instanceof Element
		? ((target.closest<HTMLElement>("[data-hit]")?.dataset.hit as Control) ??
				null)
		: null;
}

function DrawRevealCountdown({
	deadline,
	clockOffset,
}: {
	deadline: number;
	clockOffset: number;
}) {
	const [seconds, setSeconds] = useState(() =>
		Math.ceil((deadline - Date.now() - clockOffset) / 1000),
	);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>;
		function tick() {
			const left = deadline - Date.now() - clockOffset;
			const next = Math.ceil(left / 1000);
			setSeconds(next);
			if (next > 0)
				timer = setTimeout(tick, Math.max(1, left - (next - 1) * 1000));
		}
		tick();
		return () => clearTimeout(timer);
	}, [clockOffset, deadline]);
	return (
		seconds > 0 && <p className="room-motion-note">결과 공개까지 {seconds}초</p>
	);
}

export default function RoomGameStage({
	draw,
	viewMode,
	activeDraw,
	clockOffset = 0,
	drive,
	driveAdjustment,
	canDrive = false,
	onDrivePress,
	onDriveRelease,
	showVoting = true,
	isHost,
	wheel,
	exclusion,
	sound,
	reducedMotion,
	titleRef,
	titleId,
	canNext = false,
	nextPending = false,
	onNext,
	canRedraw = true,
	canDriveRedraw = true,
	onRedraw,
	...voting
}: Props) {
	const id = useId();
	const round = activeDraw ?? draw;
	const mode =
		viewMode ?? (round ? readDrawView(round.viewMode) : defaultDrawView);
	const slot = mode === "slot-v1" && Boolean(wheel);
	const frame = useRef<HTMLElement>(null);
	const main = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({
		width: 320,
		height: 352,
		mainHeight: 352,
	});
	const [hover, setHover] = useState<Control | null>(null);
	const [pressed, setPressed] = useState<Control | null>(null);
	const focusPrimary = useRef(false);
	const activeDrive = draw ? undefined : (drive ?? round?.drive);
	const phase = activeDrive ? "spinning" : (wheel?.phase ?? "idle");
	const hostCanStart = Boolean(
		wheel &&
			isHost &&
			wheel.canDraw !== false &&
			!wheel.covered &&
			wheel.candidates.length &&
			phase === "idle",
	);
	const hostCanDrive = isHost && canDrive && Boolean(activeDrive);
	const resultDisabled = !canNext || nextPending || voting.pending;
	const primarySpinInput = Boolean(
		onDrivePress &&
			(hostCanDrive || (hostCanStart && (wheel?.candidates.length ?? 0) > 1)),
	);
	const redrawSpinInput = Boolean(
		onDrivePress &&
			isHost &&
			!voting.readOnly &&
			draw &&
			canRedraw &&
			canDriveRedraw &&
			!resultDisabled,
	);
	const buttonProps = useSpinInput({
		enabled: primarySpinInput || redrawSpinInput,
		onPress: (focus) => {
			if (!onDrivePress?.(Boolean(draw))) return false;
			focusPrimary.current = focus && Boolean(draw);
			return true;
		},
		onRelease: () => onDriveRelease?.(),
	});
	useLayoutEffect(() => {
		if (focusPrimary.current && !draw && wheel?.buttonRef.current) {
			focusPrimary.current = false;
			wheel.buttonRef.current.focus({ preventScroll: true });
		}
	}, [draw, wheel]);
	const primaryButtonProps = primarySpinInput
		? buttonProps
		: { onClick: () => wheel?.onDraw() };
	const spinButtonProps = draw
		? redrawSpinInput
			? buttonProps
			: { onClick: onRedraw }
		: primaryButtonProps;
	const holdHintId = `${id}-hold`;
	const motionHint = (primarySpinInput || redrawSpinInput) && (
		<p id={holdHintId} className="sr-only">
			길게 누르거나 연달아 누르면 빨라집니다. 놓으면 천천히 멈춥니다.
		</p>
	);
	const deadline = activeDrive
		? activeDrive.stopAt
		: round
			? getSpinDeadline(round)
			: undefined;
	const countdown =
		phase === "spinning" &&
		reducedMotion &&
		deadline !== undefined &&
		Number.isFinite(deadline) ? (
			<DrawRevealCountdown deadline={deadline} clockOffset={clockOffset} />
		) : undefined;
	useLayoutEffect(() => {
		const el = frame.current;
		if (!el || slot) return;
		function measure() {
			if (!el?.clientWidth || !el.clientHeight) return;
			const width = el.clientWidth,
				height = el.clientHeight;
			const mainHeight = main.current?.clientHeight || height;
			setSize((current) =>
				current.width === width &&
				current.height === height &&
				current.mainHeight === mainHeight
					? current
					: { width, height, mainHeight },
			);
		}
		measure();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure);
			return () => window.removeEventListener("resize", measure);
		}
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		if (main.current) observer.observe(main.current);
		return () => observer.disconnect();
	}, [slot]);
	const feedback = useRoomFeedback({ draw, ...voting });
	const winner = draw?.candidates[draw.winnerIndex];
	const result =
		draw && winner
			? {
					name: winner.name,
					category: winner.category,
					number: roomCandidateNumbers.get(winner.id) ?? draw.winnerIndex + 1,
					votes: showVoting
						? {
								up: feedback.upVotes.length,
								down: feedback.downVotes.length,
								selected: feedback.ownChoice,
								enabled: feedback.canVote,
							}
						: undefined,
				}
			: null;
	const headingId = titleId ?? `${id}-winner`;
	const showNext = isHost && !voting.readOnly;
	const spinDisabled = result
		? !showNext || !canRedraw || resultDisabled
		: !hostCanStart && !hostCanDrive;
	const resultActions =
		!wheel && result && showNext ? (
			<RoomResultActions
				canRedraw={canRedraw}
				holdHintId={redrawSpinInput ? holdHintId : undefined}
				redrawButtonProps={redrawSpinInput ? buttonProps : undefined}
				disabled={resultDisabled}
				nextPending={nextPending}
				onNext={onNext}
				onRedraw={onRedraw}
			/>
		) : null;
	const voteMotionRound =
		result?.votes && voting.connected && !voting.readOnly && !reducedMotion
			? draw?.id
			: undefined;
	const fullSlotName = slot && result && (
		<p className="slot-full-name" aria-hidden="true">
			{result.name}
		</p>
	);
	const details = (
		<div className="picnic-details">
			{result?.votes && draw ? (
				<div className="picnic-sheet">
					{fullSlotName}
					<span className="picnic-participation">
						{slot && result.category && `${result.category} · `}
						<span>{result.votes.up + result.votes.down}명 참여</span>
					</span>
					<RoomFeedbackDetails
						draw={draw}
						{...voting}
						isHost={isHost}
						mode="results"
						feedback={feedback}
						onBoard
						reducedMotion={reducedMotion}
					/>
				</div>
			) : (
				fullSlotName
			)}
			{resultActions}
		</div>
	);
	const options = exclusion && <RoomExclusionPanel {...exclusion} />;
	const soundControl = sound && (
		<div className="picnic-sound" data-hit="sound">
			<DrawPresentationControls sound={sound} />
		</div>
	);
	if (slot && wheel) {
		return (
			<div data-own-choice={feedback.ownChoice}>
				<section aria-label="게임 보드" className="picnic-frame slot-stage">
					{motionHint}
					{options}
					<div className="slot-stage-main">
						{soundControl}
						<SlotMachine
							candidates={wheel.candidates}
							numbers={wheel.candidateNumbers}
							draw={round}
							clockOffset={clockOffset}
							phase={phase}
							reduced={Boolean(reducedMotion)}
							host={isHost}
							disabled={spinDisabled}
							drive={activeDrive}
							driveClockOffset={clockOffset}
							driveAdjustment={driveAdjustment}
							holdHintId={
								primarySpinInput || redrawSpinInput ? holdHintId : undefined
							}
							drawButtonProps={spinButtonProps}
							countdown={countdown}
							canReplay={Boolean(result && showNext)}
							result={result}
							voteMotionRound={voteMotionRound}
							showVoting={showVoting}
							buttonRef={wheel.buttonRef}
							buttonId={wheel.buttonId}
							titleRef={titleRef}
							titleId={headingId}
						>
							{details}
						</SlotMachine>
					</div>
				</section>
			</div>
		);
	}
	const { busy, caption, label } = wheelControl(
		phase,
		Boolean(wheel && wheel.canDraw !== false),
		Boolean(activeDrive),
		wheel?.drawLabel,
		wheel?.drawText,
	);
	const candidates = draw?.candidates ?? wheel?.candidates ?? [];
	const numbers = draw
		? candidates.map(
				(place, index) => roomCandidateNumbers.get(place.id) ?? index + 1,
			)
		: (wheel?.candidateNumbers ?? []);
	const scene: StageScene = {
		mainHeight: size.mainHeight,
		continuous: Boolean(wheel),
		landing: draw?.toRotation,
		voteMotionRound,
		sound: sound && { enabled: sound.enabled, supported: sound.supported },
		wheel: {
			labels: getWheelLabels(candidates, numbers),
			count: candidates.length,
			phase,
			caption,
			busy,
			disabled: !hostCanStart && !hostCanDrive,
		},
		result,
		hover,
		pressed,
	};
	const layout = stageLayout(size.width, size.mainHeight, Boolean(wheel));
	const box = {
		"--pad": `${layout.pad}px`,
		"--top": `${layout.top}px`,
		"--wheel": `${layout.wheelSide}px`,
		"--wheel-y": `${layout.wheelY}px`,
		"--hub": `${layout.hubSize}px`,
		"--ticket-w": `${layout.heroWidth}px`,
		"--ticket-h": `${layout.heroHeight}px`,
		"--ticket-top": `${layout.ticketTop}px`,
	} as CSSProperties;

	return (
		<div
			className={result ? "room-result-layout" : undefined}
			data-own-choice={feedback.ownChoice}
		>
			<section
				aria-label="게임 보드"
				className="picnic-frame"
				data-continuous={Boolean(wheel) || undefined}
				data-voting={showVoting || undefined}
				data-next={showNext || undefined}
				ref={frame}
				style={box}
				onPointerOver={(e) =>
					setHover(e.pointerType === "touch" ? null : hitTarget(e.target))
				}
				onPointerLeave={() => {
					setHover(null);
					setPressed(null);
				}}
				onPointerDown={(e) => setPressed(hitTarget(e.target))}
				onPointerUp={() => setPressed(null)}
				onPointerCancel={() => setPressed(null)}
				onKeyDown={(e) => {
					if (e.key === " " || e.key === "Enter")
						setPressed(hitTarget(e.target));
				}}
				onKeyUp={() => setPressed(null)}
				onBlur={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget))
						setPressed(null);
				}}
			>
				<PicnicArt
					scene={scene}
					{...size}
					rotorRef={wheel?.rotorRef}
					motionOff={reducedMotion}
					drive={activeDrive}
					driveClockOffset={clockOffset}
					driveAdjustment={driveAdjustment}
				/>
				{motionHint}
				{options}
				<div
					ref={main}
					className="picnic-main"
					data-result={Boolean(result) || undefined}
				>
					{soundControl}
					{countdown && <div className="picnic-countdown">{countdown}</div>}
					{wheel && (
						<div className="picnic-wheel">
							<LunchWheel
								{...wheel}
								externalControl
								candidates={candidates}
								candidateNumbers={numbers}
								wheelSide={layout.wheelSide}
								covered={!hostCanStart && !hostCanDrive}
								phase={phase}
								drive={activeDrive}
								driveClockOffset={clockOffset}
								driveAdjustment={driveAdjustment}
								motionOff={reducedMotion}
								holdHintId={primarySpinInput ? holdHintId : undefined}
								drawButtonProps={primaryButtonProps}
							/>
						</div>
					)}
					{result && (
						<section className="picnic-ticket" aria-labelledby={headingId}>
							<div className="room-result-summary">
								<p>당첨 메뉴</p>
								<h3 id={headingId} ref={titleRef} tabIndex={-1}>
									{result.name}
								</h3>
								<p>{result.category}</p>
								<small>후보 {result.number}번</small>
							</div>
						</section>
					)}
					{wheel && details}
				</div>
				{!wheel && details}
				{wheel && !voting.readOnly && (
					<div className="picnic-spin-footer">
						<Button
							size="touch"
							ref={wheel.buttonRef}
							id={wheel.buttonId}
							className="touch-none select-none"
							disabled={spinDisabled}
							aria-describedby={
								[
									wheel.errorId,
									(redrawSpinInput || primarySpinInput) && holdHintId,
								]
									.filter(Boolean)
									.join(" ") || undefined
							}
							aria-label={!result ? label : undefined}
							aria-busy={busy || undefined}
							{...spinButtonProps}
						>
							{!isHost
								? "방장 대기"
								: busy
									? caption
									: (!result && wheel.candidates.length === 1) ||
											(result && !canDriveRedraw && canRedraw)
										? "마지막 후보 확정"
										: "룰렛 돌리기"}
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}
