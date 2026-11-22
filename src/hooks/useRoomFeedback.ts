import { useEffect, useMemo, useRef, useState } from "react";
import {
	isRoomDrawVoter,
	type RoomDraw,
	type RoomDrawVote,
} from "@/lib/lunchRoom";

export type VoteChoice = RoomDrawVote["vote"];
type OptimisticVote = Pick<RoomDrawVote, "participantId" | "name" | "vote">;
type DisplayVote = RoomDrawVote | OptimisticVote;
export type FeedbackOptions = {
	draw: RoomDraw | null;
	selfId?: string;
	connected: boolean;
	pending: boolean;
	readOnly?: boolean;
	optimisticVote?: OptimisticVote;
	onVote: (drawId: string, choice: VoteChoice) => boolean;
};
export function useRoomFeedback({
	draw,
	selfId,
	connected,
	pending,
	readOnly = false,
	optimisticVote: suppliedVote,
	onVote,
}: FeedbackOptions) {
	const [localVote, setLocalVote] = useState<
		(OptimisticVote & { drawId: string }) | null
	>(null);
	const submitting = useRef(false);
	const optimisticVote =
		suppliedVote ?? (localVote?.drawId === draw?.id ? localVote : undefined);

	const [failedSubmission, setFailedSubmission] = useState<{
		drawId: string;
		message: string;
	} | null>(null);
	const votes = useMemo(
		() =>
			[...(draw?.votes ?? [])].sort(
				(left, right) =>
					left.reactionMs - right.reactionMs ||
					left.timestamp - right.timestamp,
			),
		[draw?.votes],
	);
	const eligible = Boolean(draw && isRoomDrawVoter(draw, selfId));
	const pendingVote =
		pending &&
		connected &&
		eligible &&
		!readOnly &&
		optimisticVote &&
		optimisticVote.participantId === selfId &&
		!votes.some((vote) => vote.participantId === optimisticVote?.participantId)
			? optimisticVote
			: undefined;
	const upVotes: DisplayVote[] = votes.filter((vote) => vote.vote === "up");
	const downVotes: DisplayVote[] = votes.filter((vote) => vote.vote === "down");
	if (pendingVote) {
		(pendingVote.vote === "up" ? upVotes : downVotes).push(pendingVote);
	}
	const ranksByParticipant = new Map(
		votes.map((vote, index) => [vote.participantId, index + 1]),
	);
	const ownVote =
		votes.find((vote) => vote.participantId === selfId) ?? pendingVote;
	const ownLabel = ownVote?.vote === "up" ? "좋아요" : "싫어요";
	const submitError =
		!readOnly &&
		!pending &&
		!ownVote &&
		failedSubmission &&
		failedSubmission.drawId === draw?.id
			? failedSubmission.message
			: "";
	const canVote = !readOnly && connected && eligible && !pending && !ownVote;
	const statusMessage = readOnly
		? "확정된 투표 기록입니다."
		: !connected
			? "다시 연결되면 투표할 수 있습니다."
			: pendingVote
				? "투표를 보내고 있습니다…"
				: ownVote
					? `${ownLabel}에 투표했습니다.`
					: pending
						? "투표를 보내고 있습니다…"
						: submitError ||
							(!selfId
								? "참가 정보를 확인하고 있습니다."
								: !eligible
									? "추첨 시작 후 입장해 이번 결과에는 투표할 수 없습니다. 다음 추첨부터 참여해 주세요."
									: "");
	const showVisibleStatus =
		!readOnly &&
		(!connected ||
			(!pending && !ownVote && (Boolean(submitError) || !selfId || !eligible)));

	useEffect(() => {
		if (
			!pending ||
			!connected ||
			!eligible ||
			readOnly ||
			localVote?.drawId !== draw?.id ||
			localVote?.participantId !== selfId ||
			votes.some((v) => v.participantId === selfId)
		) {
			submitting.current = false;
			setLocalVote(null);
		}
	}, [
		pending,
		connected,
		eligible,
		readOnly,
		draw?.id,
		selfId,
		votes,
		localVote,
	]);
	function submit(choice: VoteChoice) {
		if (!draw || !canVote || submitting.current) return;
		const participant = draw.participants?.find((p) => p.id === selfId);
		if (!participant) return;
		submitting.current = true;
		setFailedSubmission(null);
		if (onVote(draw.id, choice)) {
			setLocalVote({
				drawId: draw.id,
				participantId: participant.id,
				name: participant.name,
				vote: choice,
			});
		} else {
			submitting.current = false;
			setFailedSubmission({
				drawId: draw.id,
				message: "투표를 보내지 못했습니다. 다시 시도해 주세요.",
			});
		}
	}
	return {
		upVotes,
		downVotes,
		ranksByParticipant,
		ownChoice: ownVote?.vote,
		canVote,
		statusMessage,
		showVisibleStatus,
		submitError,
		submit,
	};
}
export type RoomFeedback = ReturnType<typeof useRoomFeedback>;
