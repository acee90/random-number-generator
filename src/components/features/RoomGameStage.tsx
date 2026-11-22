import {
	type ComponentProps,
	type CSSProperties,
	type RefObject,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { useDrawSound } from "@/hooks/useDrawPresentation";
import { type FeedbackOptions, useRoomFeedback } from "@/hooks/useRoomFeedback";
import type { RoomDraw } from "@/lib/lunchRoom";
import DrawPresentationControls from "./DrawPresentationControls";
import { LunchWheel } from "./LunchWheel";
import {
	type Control,
	getWheelLabels,
	type StageScene,
	stageLayout,
} from "./picnic/layout";
import { PicnicArt } from "./picnic/PicnicArt";
import { roomCandidateNumbers } from "./RoomCandidateList";
import { RoomFeedbackDetails } from "./RoomDrawFeedback";
import RoomExclusionPanel, {
	type ExclusionOptions,
} from "./RoomExclusionPanel";
import RoomNextGameButton from "./RoomNextGameButton";

type WheelProps = ComponentProps<typeof LunchWheel>;
type Props = Omit<FeedbackOptions, "draw"> & {
	draw: RoomDraw | null;
	solo?: boolean;
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
};

function hitTarget(target: EventTarget | null): Control | null {
	return target instanceof Element
		? ((target.closest<HTMLElement>("[data-hit]")?.dataset.hit as Control) ??
				null)
		: null;
}

export default function RoomGameStage({
	draw,
	solo = false,
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
	...voting
}: Props) {
	const id = useId();
	const frame = useRef<HTMLElement>(null);
	const main = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({
		width: 320,
		height: 352,
		mainHeight: 352,
	});
	const [hover, setHover] = useState<Control | null>(null);
	const [pressed, setPressed] = useState<Control | null>(null);
	useLayoutEffect(() => {
		const el = frame.current;
		if (!el) return;
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
	}, []);
	const feedback = useRoomFeedback({ draw, ...voting });
	const winner = draw?.candidates[draw.winnerIndex];
	const result =
		draw && winner
			? {
					name: winner.name,
					category: winner.category,
					number: roomCandidateNumbers.get(winner.id) ?? draw.winnerIndex + 1,
					votes: solo
						? undefined
						: {
								up: feedback.upVotes.length,
								down: feedback.downVotes.length,
								selected: feedback.ownChoice,
								enabled: feedback.canVote,
							},
				}
			: null;
	const phase = wheel?.phase ?? "idle";
	const caption =
		phase === "fetching"
			? "준비 중"
			: phase === "spinning"
				? "회전 중"
				: !wheel?.canDraw
					? "방장 대기"
					: (wheel.drawText ?? "돌리기");
	const scene: StageScene = {
		mainHeight: size.mainHeight,
		voteMotionRound:
			result?.votes && voting.connected && !voting.readOnly && !reducedMotion
				? draw?.id
				: undefined,
		sound: sound && { enabled: sound.enabled, supported: sound.supported },
		wheel: {
			labels:
				wheel && !result
					? getWheelLabels(wheel.candidates, wheel.candidateNumbers)
					: [],
			count: wheel?.candidates.length ?? 0,
			phase,
			caption,
			disabled:
				!wheel?.canDraw ||
				wheel.covered ||
				phase === "spinning" ||
				phase === "fetching",
		},
		result,
		hover,
		pressed,
	};
	const layout = stageLayout(size.width, size.mainHeight);
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
	const headingId = titleId ?? `${id}-winner`;
	return (
		<div
			className={result ? "room-result-layout" : undefined}
			data-own-choice={feedback.ownChoice}
		>
			<section
				aria-label="게임 보드"
				className="picnic-frame"
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
					animate={!result && phase === "spinning" && !reducedMotion}
				/>
				{exclusion && <RoomExclusionPanel {...exclusion} />}
				<div
					ref={main}
					className="picnic-main"
					data-result={Boolean(result) || undefined}
				>
					{sound && (
						<div className="picnic-sound" data-hit="sound">
							<DrawPresentationControls sound={sound} />
						</div>
					)}
					{!result && wheel && (
						<div className="picnic-wheel">
							<LunchWheel {...wheel} />
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
				</div>
				<div className="picnic-details">
					{result && (result.votes || (isHost && !voting.readOnly)) && (
						<div className="picnic-result-tools">
							{result.votes && (
								<span className="picnic-participation">
									{result.votes.up + result.votes.down}명 참여
								</span>
							)}
							{isHost && !voting.readOnly && (
								<RoomNextGameButton
									disabled={!canNext || nextPending || voting.pending}
									pending={nextPending}
									onClick={onNext}
								/>
							)}
						</div>
					)}
					{result?.votes && draw && (
						<div className="picnic-sheet">
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
					)}
				</div>
			</section>
		</div>
	);
}
