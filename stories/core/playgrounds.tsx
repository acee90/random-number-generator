import { Play, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import RoomGameStage from "@/components/features/RoomGameStage";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import { randomWheelLandingFraction, sampleLunchPlaces } from "@/lib/lunch";
import {
	getRoomDrawDuration,
	getRoomDrawRotation,
	type RoomDraw,
} from "@/lib/lunchRoom";
import { startSpinDrive } from "@/lib/spinDrive";
import { previewSpinHeld } from "./draw-views/sample";
import {
	appendPreviewVote,
	createPreviewDraw,
	previewGuests,
	previewSelfId,
} from "./fixtures";

type ResultProps = ComponentProps<typeof RoomGameStage>;
export function ResultFrame(props: ResultProps) {
	return (
		<div className="sb-result-frame">
			<div className="room-result-overlay">
				<RoomGameStage {...props} />
			</div>
		</div>
	);
}
export function VotePlayground(args: ResultProps) {
	const sequence = useRef(1);
	const [draw, setDraw] = useState(args.draw ?? createPreviewDraw());
	const [auto, setAuto] = useState(false);
	const available = previewGuests
		.slice(1)
		.some(
			(guest) => !draw.votes?.some((vote) => vote.participantId === guest.id),
		);
	useEffect(() => {
		if (!auto || !available) return;
		const timer = setInterval(
			() =>
				setDraw((current) =>
					appendPreviewVote(
						current,
						(current.votes?.length ?? 0) % 2 ? "down" : "up",
					),
				),
			420,
		);
		return () => clearInterval(timer);
	}, [auto, available]);
	function reset() {
		setAuto(false);
		setDraw(createPreviewDraw({ id: `preview-round-${++sequence.current}` }));
	}
	return (
		<section className="sb-playground" aria-label="투표 반응 놀이터">
			<header className="sb-heading">
				<h1>투표 반응 놀이터</h1>
				<p>표를 추가하거나 아래에서 직접 투표해 보세요.</p>
			</header>
			<fieldset className="sb-toolbar">
				<legend className="sr-only">예제 투표 조작</legend>
				<button
					type="button"
					disabled={!available}
					onClick={() => setDraw((current) => appendPreviewVote(current, "up"))}
				>
					<ThumbsUp size={20} aria-hidden="true" />
					좋아요 +1
				</button>
				<button
					type="button"
					disabled={!available}
					onClick={() =>
						setDraw((current) => appendPreviewVote(current, "down"))
					}
				>
					<ThumbsDown size={20} aria-hidden="true" />
					싫어요 +1
				</button>
				<button
					type="button"
					aria-pressed={auto && available}
					disabled={!available}
					onClick={() => setAuto((value) => !value)}
				>
					<Play size={18} aria-hidden="true" />
					{auto && available ? "연속 투표 멈추기" : "연속 투표"}
				</button>
				<button type="button" onClick={reset}>
					<RotateCcw size={18} aria-hidden="true" />
					초기화
				</button>
			</fieldset>
			<ResultFrame
				{...args}
				draw={draw}
				onNext={reset}
				onRedraw={reset}
				onVote={(drawId, choice) => {
					if (
						drawId !== draw.id ||
						draw.votes?.some((vote) => vote.participantId === previewSelfId)
					)
						return false;
					setDraw((current) =>
						appendPreviewVote(current, choice, previewGuests[0]),
					);
					return true;
				}}
			/>
			<p className="sb-caption">
				예제 데이터로 동작합니다. 실제 방에 접속하거나 투표를 전송하지 않습니다.
			</p>
		</section>
	);
}
export type WheelPreviewArgs = {
	candidateCount: number;
	canDraw: boolean;
	motionOff: boolean;
	initialPhase: "idle" | "fetching" | "spinning" | "done";
};
export function WheelPlayground({
	candidateCount,
	canDraw,
	motionOff,
	initialPhase,
}: WheelPreviewArgs) {
	const id = useId();
	const rotorRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const sequence = useRef(0);
	const [draw, setDraw] = useState<RoomDraw | null>(() => {
		if (initialPhase !== "spinning" && initialPhase !== "done") return null;
		const value = createPreviewDraw({ count: candidateCount });
		const startedAt =
			initialPhase === "done" ? Date.now() - value.durationMs : Date.now();
		return { ...value, startedAt, timestamp: startedAt };
	});
	const [fetching, setFetching] = useState(initialPhase === "fetching");
	const finished = useRoomTimeline(draw, 0, rotorRef, motionOff);
	const candidates =
		draw?.candidates ?? sampleLunchPlaces.slice(0, candidateCount);
	const phase = fetching
		? "fetching"
		: draw
			? finished
				? "done"
				: "spinning"
			: "idle";
	function reset() {
		setFetching(false);
		setDraw(null);
	}
	function start(driven = false) {
		const value = createPreviewDraw({
			id: `preview-spin-${++sequence.current}`,
			count: candidateCount,
		});
		const winnerIndex = sequence.current % value.candidates.length;
		const landingFraction = randomWheelLandingFraction();
		const startedAt = Date.now();
		setDraw({
			...value,
			startedAt,
			timestamp: startedAt,
			winnerIndex,
			durationMs: getRoomDrawDuration(),
			toRotation: getRoomDrawRotation(
				winnerIndex,
				value.candidates.length,
				landingFraction,
			),
			...(driven && { drive: startSpinDrive(startedAt, "wheel") }),
			landingFraction,
		});
		return true;
	}
	function pressDrive(redraw: boolean) {
		if (redraw || !draw) return start(true);
		const next = previewSpinHeld(draw, true);
		if (next === draw) return false;
		setDraw(next);
		return true;
	}
	function releaseDrive() {
		setDraw((current) => current && previewSpinHeld(current, false));
	}
	return (
		<section className="sb-playground" aria-label="룰렛 놀이터">
			<header className="sb-heading">
				<h1>룰렛 놀이터</h1>
				<p>가운데 버튼으로 실제 서비스와 같은 회전과 결과 공개를 확인하세요.</p>
			</header>
			<div className="sb-toolbar">
				<button type="button" onClick={reset}>
					<RotateCcw size={18} aria-hidden="true" />
					처음으로
				</button>
			</div>
			<div className="room-draw-panel sb-wheel-panel">
				<RoomGameStage
					viewMode="wheel"
					activeDraw={draw}
					canDrive={canDraw}
					onDrivePress={pressDrive}
					onDriveRelease={releaseDrive}
					draw={finished ? draw : null}
					showVoting={false}
					isHost={canDraw}
					connected
					pending={false}
					reducedMotion={motionOff}
					onNext={reset}
					onRedraw={() => start()}
					canNext
					onVote={() => false}
					wheel={{
						candidates,
						candidateNumbers: candidates.map((_, index) => index + 1),
						rotation: finished ? (draw?.toRotation ?? 0) : 0,
						phase,
						onComplete: () => {},
						onDraw: () => start(),
						buttonId: `${id}-spin`,
						covered: false,
						buttonRef,
						rotorRef,
						controlled: true,
						canDraw,
					}}
				/>
				<output className="sb-wheel-status" aria-live="polite">
					{finished && draw
						? `추첨 결과: ${draw.candidates[draw.winnerIndex].name}`
						: phase === "spinning"
							? "룰렛이 돌아가고 있어요…"
							: phase === "fetching"
								? "추첨을 준비하고 있어요…"
								: "가운데 버튼을 눌러 돌려보세요."}
				</output>
			</div>
			<p className="sb-caption">
				실제 방에 접속하지 않는 예제입니다. 버튼을 누르고 있으면 빨라지고,
				놓으면 천천히 멈춥니다.
			</p>
		</section>
	);
}
