import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	type FeedbackOptions,
	type RoomFeedback,
	useRoomFeedback,
	type VoteChoice,
} from "@/hooks/useRoomFeedback";
import type { RoomDraw } from "@/lib/lunchRoom";
import "./room-draw-feedback.css";

export const choices = [
	{ vote: "up", label: "좋아요", Icon: ThumbsUp },
	{ vote: "down", label: "싫어요", Icon: ThumbsDown },
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

function VoteBurst() {
	return (
		<span className="room-feedback-burst" aria-hidden="true">
			{[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
				<i
					key={angle}
					style={
						{
							"--burst-angle": `${angle}deg`,
							"--burst-distance": angle % 90 ? "32px" : "42px",
						} as CSSProperties
					}
				/>
			))}
		</span>
	);
}

export function VoteTally({
	id,
	choice,
	count,
	animate,
	selected,
	readOnly,
	canVote,
	onVote,
	onBoard = false,
}: {
	id: string;
	choice: VoteChoice;
	count: number;
	animate: boolean;
	selected: boolean;
	readOnly: boolean;
	canVote: boolean;
	onVote: () => void;
	onBoard?: boolean;
}) {
	const previous = useRef({ count, animate });
	const [burst, setBurst] = useState(0);
	useEffect(() => {
		if (!animate || !previous.current.animate) setBurst(0);
		else if (count > previous.current.count) setBurst((value) => value + 1);
		previous.current = { count, animate };
	}, [count, animate]);
	const { label, Icon } = choice === "up" ? choices[0] : choices[1];
	const Heading = onBoard ? "h4" : "h5";
	const content = (
		<>
			<span
				className="room-feedback-tally-icon"
				key={`icon:${burst}`}
				aria-hidden="true"
			>
				{onBoard && selected ? <Check size={20} /> : <Icon size={28} />}
				{animate && burst > 0 && <VoteBurst />}
			</span>
			<span className="room-feedback-team-label">{label}</span>
			<span className="room-feedback-tally-number" key={`number:${burst}`}>
				<strong>{count}</strong>
				{animate && burst > 0 && <VoteBurst />}
			</span>
			{selected && !onBoard && (
				<span className="room-feedback-team-selection" aria-hidden="true">
					<Check size={12} />내 선택
				</span>
			)}
		</>
	);
	return (
		<Heading
			aria-label={`${label} ${count}`}
			data-hit={onBoard ? choice : undefined}
			data-selected={(onBoard && selected) || undefined}
			id={id}
			className="room-feedback-tally-heading"
			data-burst={(animate && burst) || undefined}
		>
			{readOnly ? (
				<span className="room-feedback-tally">{content}</span>
			) : (
				<Button
					variant="outline"
					size="auto"
					className="room-feedback-tally"
					data-burst={(animate && burst) || undefined}
					aria-label={`${label} 투표`}
					aria-pressed={selected}
					aria-disabled={!canVote}
					onClick={onVote}
				>
					{content}
				</Button>
			)}
		</Heading>
	);
}

type FeedbackProps = Omit<FeedbackOptions, "draw"> & {
	draw: RoomDraw;
	isHost: boolean;
	mode?: "full" | "results";
};
export default function RoomDrawFeedback(props: FeedbackProps) {
	const feedback = useRoomFeedback(props);
	return <RoomFeedbackDetails {...props} feedback={feedback} />;
}

export function RoomFeedbackDetails({
	draw,
	selfId,
	isHost,
	connected,
	readOnly = false,
	mode = "full",
	feedback,
	onBoard = false,
	reducedMotion = false,
}: Pick<
	FeedbackProps,
	"draw" | "selfId" | "isHost" | "connected" | "readOnly" | "mode"
> & { feedback: RoomFeedback; onBoard?: boolean; reducedMotion?: boolean }) {
	const id = useId();
	const {
		upVotes,
		downVotes,
		ranksByParticipant,
		ownChoice,
		showVisibleStatus,
		statusMessage,
		submitError,
		canVote,
		submit,
	} = feedback;

	return (
		<section
			className="room-draw-feedback"
			data-mode={onBoard ? "board" : mode}
			data-own-choice={ownChoice}
			aria-label={onBoard ? "실시간 투표 현황" : undefined}
			aria-labelledby={onBoard ? undefined : `${id}-title`}
		>
			{!onBoard && (
				<div className="room-feedback-heading">
					<h4 id={`${id}-title`}>
						{mode === "results" ? "실시간 투표 현황" : "메뉴 투표"}
					</h4>
					<span>{upVotes.length + downVotes.length}명 참여</span>
				</div>
			)}

			<output
				className={showVisibleStatus ? "room-feedback-status" : "sr-only"}
				aria-live="polite"
				aria-atomic="true"
				data-error={Boolean(submitError) || undefined}
			>
				<span className="sr-only">
					좋아요 {upVotes.length}명, 싫어요 {downVotes.length}명.{" "}
				</span>
				{statusMessage}
			</output>
			<fieldset className="room-feedback-lists">
				<legend className="sr-only">이번 추첨 결과 투표</legend>
				{choices.map(({ vote, label }) => {
					const voters = vote === "up" ? upVotes : downVotes;
					const voterList = (
						<ul
							aria-label={`${label} 투표한 참가자`}
							tabIndex={mode === "results" && voters.length > 0 ? 0 : undefined}
						>
							{voters.map((entry) => {
								const confirmed = "reactionMs" in entry;
								const rank = confirmed
									? ranksByParticipant.get(entry.participantId)
									: undefined;
								return (
									<li
										key={entry.participantId}
										data-self={entry.participantId === selfId || undefined}
										data-pending={!confirmed || undefined}
									>
										<span
											className="room-feedback-rank"
											title={rank ? `전체 반응 속도 ${rank}위` : undefined}
											aria-hidden={!confirmed || undefined}
										>
											{rank ? (
												rank <= 3 ? (
													<span
														className="room-feedback-medal"
														role="img"
														aria-label={reactionMedals[rank - 1].label}
													>
														{reactionMedals[rank - 1].symbol}
													</span>
												) : (
													`${rank}위`
												)
											) : null}
										</span>
										<span className="room-feedback-voter" title={entry.name}>
											{entry.name}
											{entry.participantId === selfId && <small>나</small>}
										</span>
										{confirmed ? (
											<span className="room-feedback-delay">
												<span className="sr-only">결과 공개 후 </span>
												{reactionDelayLabel(entry.reactionMs)}
											</span>
										) : (
											<span
												className="room-feedback-delay"
												role="note"
												aria-label="투표 확인 중"
											>
												…
											</span>
										)}
									</li>
								);
							})}
							{onBoard &&
								[1, 2, 3]
									.slice(voters.length)
									.map((slot) => <li key={slot} aria-hidden="true" />)}
						</ul>
					);

					return (
						<section
							key={vote}
							className="room-feedback-list"
							data-choice={vote}
							data-selected={ownChoice === vote || undefined}
							aria-labelledby={`${id}-${vote}`}
						>
							<VoteTally
								onBoard={onBoard}
								key={`${draw.id}:${vote}`}
								id={`${id}-${vote}`}
								choice={vote}
								count={voters.length}
								selected={ownChoice === vote}
								animate={
									mode === "results" && !readOnly && connected && !reducedMotion
								}
								readOnly={readOnly}
								canVote={canVote}
								onVote={() => submit(vote)}
							/>
							{onBoard || voters.length > 0 ? (
								voterList
							) : (
								<p className="room-feedback-empty">아직 없어요</p>
							)}
						</section>
					);
				})}
			</fieldset>
			{!onBoard && mode === "results" && isHost && !readOnly && (
				<p className="room-feedback-timing-note">
					후보 편집이나 다음 게임으로 이동하면 투표가 마감돼요.
				</p>
			)}
		</section>
	);
}
