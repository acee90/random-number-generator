import { type RefObject, useEffect, useId, useRef, useState } from "react";
import {
	isRoomDrawVoter,
	type RoomDraw,
	type RoomDrawVote,
} from "@/lib/lunchRoom";
import RoomDrawFeedback from "./RoomDrawFeedback";
import RoomNextGameButton from "./RoomNextGameButton";
import "./lunch-room.css";

export default function RoomDrawResult({
	draw,
	solo = false,
	selfId,
	isHost,
	connected,
	pending,
	readOnly = false,
	nextPending = false,
	canNext = false,
	showNextAction = true,
	onNext,
	onVote,
	titleRef,
	titleId: providedTitleId,
}: {
	draw: RoomDraw;
	solo?: boolean;
	selfId?: string;
	isHost: boolean;
	connected: boolean;
	pending: boolean;
	readOnly?: boolean;
	nextPending?: boolean;
	canNext?: boolean;
	showNextAction?: boolean;
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
	const ownVote = draw.votes?.find((vote) => vote.participantId === selfId);
	const eligible = isRoomDrawVoter(draw, selfId);
	const activeOptimisticVote =
		pending &&
		connected &&
		eligible &&
		!readOnly &&
		!ownVote &&
		optimisticVote?.drawId === draw.id &&
		optimisticVote.participantId === selfId
			? optimisticVote
			: undefined;
	const ownChoice = ownVote?.vote ?? activeOptimisticVote?.vote;
	useEffect(() => {
		if (
			!pending ||
			!connected ||
			!eligible ||
			readOnly ||
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
			ownVote ||
			!participant
		)
			return false;
		submitted.current = true;
		if (!onVote(drawId, choice)) {
			submitted.current = false;
			return false;
		}
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
			data-solo={solo || undefined}
			data-own-choice={ownChoice}
		>
			<section className="room-result" aria-labelledby={titleId}>
				<div className="room-result-summary">
					<p className="room-result-eyebrow">당첨 메뉴</p>
					<h3 id={titleId} ref={titleRef} tabIndex={-1}>
						{winner.name}
					</h3>
					<p className="room-result-category">{winner.category}</p>
				</div>
			</section>
			{!solo && (
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
			)}
			{showNextAction && isHost && !readOnly && (
				<div className="room-result-actions">
					<RoomNextGameButton
						disabled={!canNext || nextPending || pending}
						pending={nextPending}
						onClick={onNext}
					/>
				</div>
			)}
		</div>
	);
}
