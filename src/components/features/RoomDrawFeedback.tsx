import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	isRoomDrawVoter,
	type RoomDraw,
	type RoomDrawVote,
} from "@/lib/lunchRoom";
import "./room-draw-feedback.css";

type VoteChoice = RoomDrawVote["vote"];
type OptimisticVote = Pick<RoomDrawVote, "participantId" | "name" | "vote">;
type DisplayVote = RoomDrawVote | OptimisticVote;
const choices = [
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

function VoteTally({
	id,
	choice,
	count,
	animate,
	selected,
}: {
	id: string;
	choice: VoteChoice;
	count: number;
	animate: boolean;
	selected: boolean;
}) {
	const previous = useRef({ count, animate });
	const [burst, setBurst] = useState(0);
	useEffect(() => {
		if (!animate || !previous.current.animate) setBurst(0);
		else if (count > previous.current.count) setBurst((value) => value + 1);
		previous.current = { count, animate };
	}, [count, animate]);
	const { label, Icon } = choice === "up" ? choices[0] : choices[1];
	return (
		<h5
			id={id}
			tabIndex={-1}
			className="room-feedback-tally"
			data-burst={(animate && burst) || undefined}
		>
			<span
				className="room-feedback-tally-icon"
				key={`icon:${burst}`}
				aria-hidden="true"
			>
				<Icon size={28} />
				{animate && burst > 0 && <VoteBurst />}
			</span>
			<span className="room-feedback-team-label">{label}</span>
			<span className="room-feedback-tally-number" key={`number:${burst}`}>
				<strong>{count}</strong>
				{animate && burst > 0 && <VoteBurst />}
			</span>
			{selected && (
				<span className="room-feedback-team-selection" aria-hidden="true">
					<Check size={12} />내 선택
				</span>
			)}
		</h5>
	);
}

export default function RoomDrawFeedback({
	draw,
	selfId,
	isHost,
	connected,
	pending,
	optimisticVote,
	readOnly = false,
	mode = "full",
	onVote,
}: {
	draw: RoomDraw;
	selfId?: string;
	isHost: boolean;
	connected: boolean;
	pending: boolean;
	optimisticVote?: OptimisticVote;
	readOnly?: boolean;
	mode?: "full" | "actions" | "results";
	onVote: (drawId: string, vote: VoteChoice) => boolean;
}) {
	const id = useId();
	const [failedSubmission, setFailedSubmission] = useState<{
		drawId: string;
		message: string;
	} | null>(null);
	const votes = useMemo(
		() =>
			[...(draw.votes ?? [])].sort(
				(left, right) =>
					left.reactionMs - right.reactionMs ||
					left.timestamp - right.timestamp,
			),
		[draw.votes],
	);
	const eligible = isRoomDrawVoter(draw, selfId);
	const pendingVote =
		pending &&
		connected &&
		eligible &&
		!readOnly &&
		!isHost &&
		optimisticVote?.participantId === selfId &&
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
		!readOnly && !isHost && connected && eligible && !pending && !ownVote;
	const statusMessage = readOnly
		? "확정된 투표 기록입니다."
		: !connected
			? isHost
				? "다시 연결되면 최신 투표 현황을 표시합니다."
				: "다시 연결되면 투표할 수 있습니다."
			: pendingVote
				? "투표를 보내고 있습니다…"
				: ownChoice
					? `${ownChoice.label}에 투표했습니다.`
					: pending
						? "투표를 보내고 있습니다…"
						: submitError ||
							(isHost
								? "참가자의 투표가 실시간으로 표시됩니다."
								: !selfId
									? "참가 정보를 확인하고 있습니다."
									: !eligible
										? "추첨 시작 후 입장해 이번 결과에는 투표할 수 없습니다. 다음 추첨부터 참여해 주세요."
										: "");
	const showVisibleStatus =
		!readOnly &&
		(!connected ||
			(!pending &&
				!ownVote &&
				(Boolean(submitError) || (!isHost && (!selfId || !eligible)))));

	return (
		<section
			className="room-draw-feedback"
			data-mode={mode}
			data-own-choice={ownVote?.vote}
			aria-labelledby={`${id}-title`}
		>
			<div className="room-feedback-heading">
				<h4 id={`${id}-title`}>
					{mode === "actions"
						? isHost
							? "참가자의 선택을 기다리고 있어요"
							: "이 메뉴, 어때요?"
						: mode === "results"
							? "실시간 투표 현황"
							: "메뉴 투표"}
				</h4>
				{mode !== "actions" && (
					<span>{votes.length + (pendingVote ? 1 : 0)}명 참여</span>
				)}
			</div>
			{mode !== "results" && !readOnly && !isHost && (
				<div className="room-feedback-action-collapse">
					<div className="room-feedback-action-clip">
						<fieldset className="room-feedback-actions">
							<legend className="sr-only">이번 추첨 결과 투표</legend>
							{choices.map(({ vote, label, Icon }) => (
								<button
									key={vote}
									type="button"
									aria-label={`${label} 투표`}
									aria-pressed={ownVote?.vote === vote}
									data-selected={ownVote?.vote === vote || undefined}
									data-choice={vote}
									data-voted={Boolean(ownVote) || undefined}
									disabled={!canVote}
									onClick={() => {
										if (!canVote) return;
										setFailedSubmission(null);
										if (!onVote(draw.id, vote))
											setFailedSubmission({
												drawId: draw.id,
												message:
													"투표를 보내지 못했습니다. 다시 시도해 주세요.",
											});
									}}
								>
									<Icon
										className="room-feedback-choice-icon"
										size={32}
										aria-hidden="true"
									/>
									<span>{label}</span>
									{ownVote?.vote === vote && (
										<span className="room-feedback-selected-label">
											<Check size={13} aria-hidden="true" />내 선택
										</span>
									)}
								</button>
							))}
						</fieldset>
					</div>
				</div>
			)}
			{mode !== "results" && (
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
			)}
			{mode !== "actions" && (
				<div className="room-feedback-lists">
					{choices.map(({ vote, label }) => {
						const voters = vote === "up" ? upVotes : downVotes;
						const voterList = (
							<ul aria-label={`${label} 투표한 참가자`}>
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
							</ul>
						);

						return (
							<section
								key={vote}
								className="room-feedback-list"
								data-choice={vote}
								data-selected={ownVote?.vote === vote || undefined}
								aria-labelledby={`${id}-${vote}`}
							>
								<VoteTally
									key={`${draw.id}:${vote}`}
									id={`${id}-${vote}`}
									choice={vote}
									count={voters.length}
									selected={ownVote?.vote === vote}
									animate={mode === "results" && !readOnly && connected}
								/>
								{voters.length > 0 ? (
									voterList
								) : (
									<p className="room-feedback-empty">아직 없어요</p>
								)}
							</section>
						);
					})}
				</div>
			)}
		</section>
	);
}
