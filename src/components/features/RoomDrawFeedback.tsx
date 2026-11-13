import { Check, LoaderCircle, ThumbsDown, ThumbsUp } from "lucide-react";
import { useId, useState } from "react";
import type { RoomDraw, RoomDrawVote } from "@/lib/lunchRoom";
import "./room-draw-feedback.css";

type VoteChoice = RoomDrawVote["vote"];
const choices = [
	{ vote: "up", label: "좋아요", Icon: ThumbsUp },
	{ vote: "down", label: "아쉬워요", Icon: ThumbsDown },
] as const;
const reactionMedals = [
	{ symbol: "🥇", label: "첫 번째 투표" },
	{ symbol: "🥈", label: "두 번째 투표" },
	{ symbol: "🥉", label: "세 번째 투표" },
] as const;

function reactionDelayLabel(value: number): string {
	const milliseconds = Math.max(0, Math.round(value));
	if (milliseconds < 1000) return `+${milliseconds}ms`;
	if (milliseconds < 60000)
		return `+${Number((milliseconds / 1000).toFixed(1))}초`;
	const seconds = Math.floor(milliseconds / 1000);
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60)
		return `+${minutes}분${seconds % 60 ? `${seconds % 60}초` : ""}`;
	return `+${Math.floor(minutes / 60)}시간${minutes % 60 ? `${minutes % 60}분` : ""}`;
}

export default function RoomDrawFeedback({
	draw,
	selfId,
	isHost,
	connected,
	pending,
	readOnly = false,
	onVote,
}: {
	draw: RoomDraw;
	selfId?: string;
	isHost: boolean;
	connected: boolean;
	pending: boolean;
	readOnly?: boolean;
	onVote: (drawId: string, vote: VoteChoice) => boolean;
}) {
	const id = useId();
	const [failedSubmission, setFailedSubmission] = useState<{
		drawId: string;
		message: string;
	} | null>(null);
	const votes = draw.votes ?? [];
	const upVotes = votes.filter((vote) => vote.vote === "up");
	const downVotes = votes.filter((vote) => vote.vote === "down");
	const medalsByParticipant = new Map(
		votes
			.slice(0, 3)
			.map((vote, index) => [vote.participantId, reactionMedals[index]]),
	);
	const ownVote = votes.find((vote) => vote.participantId === selfId);
	const ownChoice = choices.find((choice) => choice.vote === ownVote?.vote);
	const submitError =
		!readOnly &&
		!isHost &&
		!pending &&
		!ownVote &&
		failedSubmission?.drawId === draw.id
			? failedSubmission.message
			: "";
	const canVote =
		!readOnly &&
		!isHost &&
		connected &&
		Boolean(selfId) &&
		!pending &&
		!ownVote;
	const statusMessage = readOnly
		? "확정된 투표 기록입니다."
		: ownChoice
			? `${ownChoice.label}에 투표했습니다.`
			: !connected
				? isHost
					? "다시 연결되면 최신 투표 현황을 표시합니다."
					: "다시 연결되면 투표할 수 있습니다."
				: pending
					? "투표를 보내고 있습니다…"
					: submitError ||
						(isHost
							? "참가자의 투표가 실시간으로 표시됩니다."
							: !selfId
								? "참가 정보를 확인하고 있습니다."
								: "");
	const showPending = !readOnly && !ownVote && connected && pending;

	return (
		<section className="room-draw-feedback" aria-labelledby={`${id}-title`}>
			<div className="room-feedback-heading">
				<h4 id={`${id}-title`}>메뉴 투표</h4>
				<span>{votes.length}명 참여</span>
			</div>
			{!readOnly && !isHost && (
				<>
					<fieldset
						className="room-feedback-actions"
						aria-describedby={`${id}-note`}
					>
						<legend className="sr-only">이번 추첨 결과 투표</legend>
						{choices.map(({ vote, label, Icon }) => (
							<button
								key={vote}
								type="button"
								aria-label={`${label} 투표`}
								aria-pressed={ownVote?.vote === vote}
								data-selected={ownVote?.vote === vote || undefined}
								disabled={!canVote}
								onClick={() => {
									if (!canVote) return;
									setFailedSubmission(null);
									if (!onVote(draw.id, vote))
										setFailedSubmission({
											drawId: draw.id,
											message: "투표를 보내지 못했습니다. 다시 시도해 주세요.",
										});
								}}
							>
								<Icon size={17} aria-hidden="true" />
								<span>{label}</span>
								{ownVote?.vote === vote && (
									<Check size={15} aria-hidden="true" />
								)}
							</button>
						))}
					</fieldset>
					<p id={`${id}-note`} className="room-feedback-note">
						다음 추첨 전까지 한 번만 투표할 수 있습니다. 투표 후 변경할 수
						없습니다.
					</p>
				</>
			)}
			<output
				className={statusMessage ? "room-feedback-status" : "sr-only"}
				aria-live="polite"
				aria-atomic="true"
				data-error={Boolean(submitError) || undefined}
			>
				<span className="sr-only">
					좋아요 {upVotes.length}명, 아쉬워요 {downVotes.length}명.{" "}
				</span>
				{showPending && (
					<LoaderCircle
						className="room-feedback-spinner"
						size={15}
						aria-hidden="true"
					/>
				)}
				{statusMessage}
			</output>
			<div className="room-feedback-lists">
				{choices.map(({ vote, label, Icon }) => {
					const voters = vote === "up" ? upVotes : downVotes;
					return (
						<section
							key={vote}
							className="room-feedback-list"
							aria-labelledby={`${id}-${vote}`}
						>
							<h5 id={`${id}-${vote}`}>
								<Icon size={15} aria-hidden="true" />
								<span>{label}</span>
								<strong>{voters.length}</strong>
							</h5>
							{voters.length > 0 ? (
								<ul aria-label={`${label} 투표한 참가자`}>
									{voters.map((entry) => (
										<li key={entry.participantId}>
											<span className="room-feedback-voter">
												{medalsByParticipant.has(entry.participantId) && (
													<span
														className="room-feedback-medal"
														role="img"
														aria-label={
															medalsByParticipant.get(entry.participantId)
																?.label
														}
													>
														{
															medalsByParticipant.get(entry.participantId)
																?.symbol
														}
													</span>
												)}
												{entry.name}
												{entry.participantId === selfId && <small>나</small>}
											</span>
											<span className="room-feedback-delay">
												<span className="sr-only">결과 공개 후 </span>
												{reactionDelayLabel(entry.reactionMs)}
											</span>
										</li>
									))}
								</ul>
							) : (
								<p>아직 투표가 없습니다.</p>
							)}
						</section>
					);
				})}
			</div>
			{votes.length > 0 && (
				<p className="room-feedback-timing-note">
					+ 시간은 결과 공개 후 투표까지의 간격입니다.
				</p>
			)}
		</section>
	);
}
