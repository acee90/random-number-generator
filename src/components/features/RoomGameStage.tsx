import {
	type ComponentProps,
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { choices, RoomFeedbackDetails, VoteTally } from "./RoomDrawFeedback";
import RoomNextGameButton from "./RoomNextGameButton";

export type ExclusionSetting = {
	checked: boolean;
	disabled: boolean;
	descriptionId?: string;
	onToggle: (value: boolean) => void;
};
type WheelProps = ComponentProps<typeof LunchWheel>;
type Props = Omit<FeedbackOptions, "draw"> & {
	draw: RoomDraw | null;
	solo?: boolean;
	isHost: boolean;
	wheel?: WheelProps;
	exclusion?: ExclusionSetting;
	preparation?: ReactNode;
	sound?: ReturnType<typeof useDrawSound>;
	reducedMotion?: boolean;
	titleRef?: RefObject<HTMLHeadingElement | null>;
	titleId?: string;
	showNextAction?: boolean;
	canNext?: boolean;
	nextPending?: boolean;
	onNext: () => void;
};

export function PicnicExclusionSwitch({
	setting: exclusion,
}: {
	setting: ExclusionSetting;
}) {
	const id = useId();
	return (
		<div className="picnic-exclusion" data-hit="exclude">
			<Label htmlFor={id}>중복 없이 추첨</Label>
			<Switch
				id={id}
				size="lg"
				aria-label="중복 없이 추첨 · 뽑힌 후보 제외"
				aria-describedby={exclusion.descriptionId}
				checked={exclusion.checked}
				disabled={exclusion.disabled}
				onCheckedChange={exclusion.onToggle}
			/>
		</div>
	);
}

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
	preparation,
	sound,
	reducedMotion,
	titleRef,
	titleId,
	showNextAction = true,
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
		toolbar:
			exclusion && sound
				? {
						exclude: exclusion.checked,
						locked: exclusion.disabled,
						sound: sound.enabled,
						soundSupported: sound.supported,
					}
				: undefined,
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
	const layout = stageLayout(
		size.width,
		size.mainHeight,
		Boolean(result?.votes),
	);
	const box = {
		"--pad": `${layout.pad}px`,
		"--top": `${layout.top}px`,
		"--switch-width": `${layout.switchWidth}px`,
		"--wheel": `${layout.wheelSide}px`,
		"--wheel-y": `${layout.wheelY}px`,
		"--hub": `${layout.hubSize}px`,
		"--ticket-w": `${layout.heroWidth}px`,
		"--ticket-h": `${layout.heroHeight}px`,
		"--ticket-top": `${layout.ticketTop}px`,
		"--vote-w": `${layout.voteWidth}px`,
		"--vote-h": `${layout.voteHeight}px`,
		"--vote-top": `${layout.voteTop}px`,
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
				<div
					ref={main}
					className="picnic-main"
					data-result={Boolean(result) || undefined}
				>
					{exclusion && <PicnicExclusionSwitch setting={exclusion} />}
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
					{result?.votes && draw && (
						<fieldset className="picnic-ballots">
							<legend className="sr-only">이번 추첨 결과 투표</legend>
							{choices.map(({ vote }) => (
								<div
									key={vote}
									data-hit={vote}
									data-selected={feedback.ownChoice === vote || undefined}
								>
									<VoteTally
										key={draw.id}
										id={`${id}-${vote}`}
										choice={vote}
										count={
											vote === "up"
												? feedback.upVotes.length
												: feedback.downVotes.length
										}
										selected={feedback.ownChoice === vote}
										readOnly={Boolean(voting.readOnly)}
										animate={
											voting.connected && !voting.readOnly && !reducedMotion
										}
										canVote={feedback.canVote}
										onVote={() => feedback.submit(vote)}
									/>
								</div>
							))}
						</fieldset>
					)}
				</div>
				<div className="picnic-details">
					{draw && !solo && (
						<RoomFeedbackDetails
							draw={draw}
							{...voting}
							isHost={isHost}
							mode="results"
							feedback={feedback}
							stageTallies
						/>
					)}
					{draw && showNextAction && isHost && !voting.readOnly && (
						<div className="room-result-actions">
							<RoomNextGameButton
								disabled={!canNext || nextPending || voting.pending}
								pending={nextPending}
								onClick={onNext}
							/>
						</div>
					)}
					{preparation}
				</div>
			</section>
		</div>
	);
}
