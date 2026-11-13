import { ArrowRight } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import {
	isRoomDrawVoter,
	type RoomDraw,
	type RoomDrawVote,
} from "@/lib/lunchRoom";
import RoomDrawFeedback from "./RoomDrawFeedback";
import "./lunch-room.css";

export default function RoomDrawResult({
	draw,
	selfId,
	isHost,
	connected,
	pending,
	readOnly = false,
	nextPending = false,
	canNext = false,
	onNext,
	onVote,
	titleRef,
	titleId: providedTitleId,
}: {
	draw: RoomDraw;
	selfId?: string;
	isHost: boolean;
	connected: boolean;
	pending: boolean;
	readOnly?: boolean;
	nextPending?: boolean;
	canNext?: boolean;
	onNext: () => void;
	onVote: (drawId: string, vote: RoomDrawVote["vote"]) => boolean;
	titleRef?: RefObject<HTMLHeadingElement | null>;
	titleId?: string;
}) {
	const id = useId();
	const titleId = providedTitleId ?? `${id}-winner`;
	const winner = draw.candidates[draw.winnerIndex];
	const [optimisticVote, setOptimisticVote] = useState<
		| (Pick<RoomDrawVote, "participantId" | "name" | "vote"> & {
				drawId: string;
		  })
		| null
	>(null);
	const submitted = useRef(false);
	const resultLayoutRef = useRef<HTMLDivElement>(null);
	const voteFocusRef = useRef<Element | null>(null);
	const ownVote = draw.votes?.find((vote) => vote.participantId === selfId);
	const eligible = isRoomDrawVoter(draw, selfId);
	const activeOptimisticVote =
		pending &&
		connected &&
		eligible &&
		!readOnly &&
		!isHost &&
		!ownVote &&
		optimisticVote?.drawId === draw.id &&
		optimisticVote.participantId === selfId
			? optimisticVote
			: undefined;
	const ownChoice = ownVote?.vote ?? activeOptimisticVote?.vote;
	useEffect(() => {
		const previousFocus = voteFocusRef.current;
		voteFocusRef.current = null;
		if (
			!previousFocus ||
			!ownChoice ||
			!window.matchMedia?.("(max-width: 900px)").matches ||
			(document.activeElement !== previousFocus &&
				document.activeElement !== document.body)
		)
			return;
		resultLayoutRef.current
			?.querySelector<HTMLElement>(
				`[data-mode="results"] [data-choice="${ownChoice}"] .room-feedback-tally`,
			)
			?.focus({ preventScroll: true });
	}, [ownChoice]);
	useEffect(() => {
		if (
			!pending ||
			!connected ||
			!eligible ||
			readOnly ||
			isHost ||
			ownVote ||
			(optimisticVote &&
				(optimisticVote.drawId !== draw.id ||
					optimisticVote.participantId !== selfId))
		) {
			submitted.current = false;
			setOptimisticVote(null);
		}
	}, [
		pending,
		connected,
		eligible,
		readOnly,
		isHost,
		ownVote,
		optimisticVote,
		draw.id,
		selfId,
	]);
	function submitVote(drawId: string, choice: RoomDrawVote["vote"]) {
		const participant = draw.participants?.find((entry) => entry.id === selfId);
		if (
			drawId !== draw.id ||
			submitted.current ||
			pending ||
			!connected ||
			!eligible ||
			readOnly ||
			isHost ||
			ownVote ||
			!participant
		)
			return false;
		submitted.current = true;
		if (!onVote(drawId, choice)) {
			submitted.current = false;
			return false;
		}
		const activeElement = document.activeElement;
		voteFocusRef.current =
			activeElement?.closest(".room-feedback-actions") &&
			resultLayoutRef.current?.contains(activeElement)
				? activeElement
				: null;
		setOptimisticVote({
			drawId,
			participantId: participant.id,
			name: participant.name,
			vote: choice,
		});
		return true;
	}
	return (
		<div
			className="room-result-layout"
			ref={resultLayoutRef}
			data-own-choice={ownChoice}
		>
			<section className="room-result" aria-labelledby={titleId}>
				<p className="room-eyebrow">이번 방의 추첨 결과</p>
				<h3 id={titleId} ref={titleRef} tabIndex={-1}>
					{winner.name}
				</h3>
				<p>{winner.category}</p>

				{!isHost && (
					<RoomDrawFeedback
						mode="actions"
						draw={draw}
						selfId={selfId}
						isHost={false}
						connected={connected}
						pending={pending}
						onVote={submitVote}
						optimisticVote={activeOptimisticVote}
						readOnly={readOnly}
					/>
				)}
				{isHost && (
					<div className="room-result-actions">
						<button
							type="button"
							className="generate-button"
							disabled={!canNext || nextPending}
							onClick={onNext}
						>
							{nextPending ? "투표 종료 중…" : "투표 종료하고 다음 게임"}
							<ArrowRight size={18} aria-hidden="true" />
						</button>
					</div>
				)}
			</section>
			<RoomDrawFeedback
				mode="results"
				draw={draw}
				selfId={selfId}
				isHost={isHost}
				connected={connected}
				pending={pending}
				onVote={submitVote}
				optimisticVote={activeOptimisticVote}
				readOnly={readOnly}
			/>
		</div>
	);
}
