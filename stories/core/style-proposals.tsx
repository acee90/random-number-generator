import { RotateCcw, Shuffle, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { LunchWheel } from "@/components/features/LunchWheel";
import RoomDrawResult from "@/components/features/RoomDrawResult";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import { getWheelRotation, sampleLunchPlaces } from "@/lib/lunch";
import type { RoomDraw, RoomDrawVote } from "@/lib/lunchRoom";
import {
	appendPreviewVote,
	createPreviewDraw,
	previewGuests,
	previewSelfId,
	previewVotes,
} from "./fixtures";
import "./style-proposals.css";

type StyleName = "lime" | "line";
export type CoreStylePreviewArgs = {
	view: "compare" | StyleName;
	candidateCount: number;
	isHost: boolean;
	motionOff: boolean;
};

function StyleBoard({
	style,
	draw,
	fetching,
	candidateCount,
	isHost,
	motionOff,
	onStart,
	onNext,
	onVote,
}: {
	style: StyleName;
	draw: RoomDraw | null;
	fetching: boolean;
	candidateCount: number;
	isHost: boolean;
	motionOff: boolean;
	onStart: () => void;
	onNext: () => void;
	onVote: (drawId: string, vote: RoomDrawVote["vote"]) => boolean;
}) {
	const id = useId();
	const rotorRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const finished = useRoomTimeline(draw, 0, rotorRef, motionOff);
	const phase = fetching
		? "fetching"
		: draw
			? finished
				? "done"
				: "spinning"
			: "idle";
	const showResult = Boolean(finished && draw);
	const candidates =
		draw?.candidates ?? sampleLunchPlaces.slice(0, candidateCount);
	return (
		<section className="sb-style-proposal" aria-labelledby={`${id}-style`}>
			<h2 id={`${id}-style`}>
				{style === "lime" ? "A · 라임 보드" : "B · 라인 보드"}
			</h2>
			<div
				className="sb-style-surface"
				data-style={style}
				data-motion-off={motionOff || undefined}
			>
				<section className="room-draw-panel" aria-labelledby={`${id}-wheel`}>
					<div className="room-panel-heading">
						<h2 id={`${id}-wheel`}>룰렛</h2>
						<span>{candidates.length}곳 · 같은 확률</span>
					</div>
					<div className="room-wheel-stage" data-phase={phase}>
						<div
							className={`room-wheel-area${showResult ? " is-covered" : ""}`}
							aria-hidden={showResult || undefined}
						>
							<LunchWheel
								candidates={candidates}
								candidateNumbers={candidates.map((_, index) => index + 1)}
								rotation={finished ? (draw?.toRotation ?? 0) : 0}
								phase={phase}
								onComplete={() => {}}
								onDraw={onStart}
								buttonId={`${id}-spin`}
								covered={showResult}
								buttonRef={buttonRef}
								rotorRef={rotorRef}
								controlled
								canDraw={isHost}
							/>
						</div>
						{showResult && draw && (
							<div className="room-result-overlay">
								<RoomDrawResult
									key={draw.id}
									draw={draw}
									selfId={isHost ? "preview-host" : previewSelfId}
									isHost={isHost}
									connected
									pending={false}
									canNext
									onNext={onNext}
									onVote={onVote}
								/>
							</div>
						)}
					</div>
					<output
						className={showResult ? "sr-only" : "room-draw-status"}
						aria-live="polite"
					>
						{showResult && draw
							? `추첨 결과: ${draw.candidates[draw.winnerIndex].name}`
							: fetching
								? "추첨을 준비하고 있어요…"
								: phase === "spinning"
									? "룰렛이 돌아가고 있어요…"
									: isHost
										? "가운데 버튼으로 추첨을 시작하세요."
										: "방장의 추첨을 기다리고 있어요."}
					</output>
				</section>
			</div>
		</section>
	);
}

/** Two skins share one round; the service components keep their normal props. */
export function CoreStylePreview({
	view,
	candidateCount,
	isHost,
	motionOff: initialMotionOff,
}: CoreStylePreviewArgs) {
	const sequence = useRef(1);
	const [draw, setDraw] = useState<RoomDraw | null>(() =>
		createPreviewDraw({ count: candidateCount, votes: previewVotes(7) }),
	);
	const [fetching, setFetching] = useState(false);
	const [motionOff, setMotionOff] = useState(initialMotionOff);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const drawEndsAt = draw ? draw.startedAt + draw.durationMs : undefined;
	const settled = drawEndsAt !== undefined && Date.now() >= drawEndsAt;
	const [ready, setReady] = useState(settled);
	useEffect(() => {
		if (drawEndsAt === undefined) {
			setReady(false);
			return;
		}
		const remaining = drawEndsAt - Date.now();
		if (remaining <= 0) {
			setReady(true);
			return;
		}
		setReady(false);
		const complete = setTimeout(() => setReady(true), remaining);
		return () => clearTimeout(complete);
	}, [drawEndsAt]);
	const available = Boolean(
		ready &&
			draw &&
			previewGuests
				.slice(1)
				.some(
					(guest) =>
						!draw.votes?.some((vote) => vote.participantId === guest.id),
				),
	);
	function reset() {
		clearTimeout(timer.current);
		setFetching(false);
		setDraw(
			createPreviewDraw({
				id: `style-round-${++sequence.current}`,
				count: candidateCount,
				votes: previewVotes(7),
			}),
		);
	}
	function start() {
		if (fetching || (draw && !ready)) return;
		setDraw(null);
		setReady(false);
		setFetching(true);
		timer.current = setTimeout(() => {
			const next = createPreviewDraw({
				id: `style-round-${++sequence.current}`,
				count: candidateCount,
			});
			const winnerIndex = sequence.current % next.candidates.length;
			const startedAt = Date.now();
			setDraw({
				...next,
				startedAt,
				timestamp: startedAt,
				winnerIndex,
				toRotation: getWheelRotation(0, winnerIndex, next.candidates.length),
			});
			setFetching(false);
		}, 350);
	}
	function nextRound() {
		clearTimeout(timer.current);
		setFetching(false);
		setDraw(null);
	}
	function addVote(choice: RoomDrawVote["vote"]) {
		if (!available) return;
		setDraw((current) =>
			current ? appendPreviewVote(current, choice) : current,
		);
	}
	function vote(drawId: string, choice: RoomDrawVote["vote"]) {
		if (
			!draw ||
			!ready ||
			isHost ||
			draw.id !== drawId ||
			draw.votes?.some((entry) => entry.participantId === previewSelfId)
		)
			return false;
		setDraw((current) =>
			current ? appendPreviewVote(current, choice, previewGuests[0]) : current,
		);
		return true;
	}
	const styles: StyleName[] = view === "compare" ? ["lime", "line"] : [view];
	return (
		<div className="sb-style-preview" data-view={view}>
			<header className="sb-heading">
				<h1>점메추 CORE 스타일 비교</h1>
				<p>같은 배치 · 같은 추첨 · 같은 투표</p>
			</header>
			<fieldset className="sb-toolbar sb-style-controls">
				<legend className="sr-only">공통 미리보기 조작</legend>
				<button
					type="button"
					onClick={start}
					disabled={fetching || Boolean(draw && !ready)}
				>
					<Shuffle size={18} aria-hidden="true" />
					다시 추첨
				</button>
				<button
					type="button"
					onClick={() => addVote("up")}
					disabled={!available}
				>
					<ThumbsUp size={18} aria-hidden="true" />
					좋아요 +1
				</button>
				<button
					type="button"
					onClick={() => addVote("down")}
					disabled={!available}
				>
					<ThumbsDown size={18} aria-hidden="true" />
					싫어요 +1
				</button>
				<button type="button" onClick={reset}>
					<RotateCcw size={18} aria-hidden="true" />
					초기화
				</button>
				<label>
					<input
						type="checkbox"
						checked={motionOff}
						onChange={(event) => setMotionOff(event.currentTarget.checked)}
					/>
					동작 줄이기
				</label>
			</fieldset>
			<div className="sb-style-comparison">
				{styles.map((style) => (
					<StyleBoard
						key={style}
						style={style}
						draw={draw}
						fetching={fetching}
						candidateCount={candidateCount}
						isHost={isHost}
						motionOff={motionOff}
						onStart={start}
						onNext={nextRound}
						onVote={vote}
					/>
				))}
			</div>
		</div>
	);
}
