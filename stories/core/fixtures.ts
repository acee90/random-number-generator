import { getWheelRotation, sampleLunchPlaces } from "@/lib/lunch";
import type { RoomDraw, RoomDrawVote, RoomParticipant } from "@/lib/lunchRoom";

export const previewSelfId = "preview-self";
const names = [
	"지민",
	"민지",
	"준호",
	"서연",
	"현우",
	"지우",
	"도윤",
	"수빈",
	"아주긴닉네임테스트",
];
export const previewGuests: RoomParticipant[] = Array.from(
	{ length: 29 },
	(_, index) => ({
		id: index === 0 ? previewSelfId : `preview-guest-${index}`,
		name: names[index] ?? `동료${index}`,
		isHost: false,
	}),
);
const previewStart = Date.parse("2026-11-13T03:00:00Z");
export function previewVote(
	participant: RoomParticipant,
	vote: RoomDrawVote["vote"],
	reactionMs: number,
	draw?: RoomDraw,
): RoomDrawVote {
	return {
		participantId: participant.id,
		name: participant.name,
		vote,
		reactionMs,
		timestamp:
			(draw ? draw.startedAt + draw.durationMs : previewStart + 7200) +
			reactionMs,
	};
}
export function previewVotes(
	count: number,
	includeSelf = false,
): RoomDrawVote[] {
	return previewGuests
		.slice(includeSelf ? 0 : 1)
		.slice(0, count)
		.map((participant, index) =>
			previewVote(
				participant,
				index % 2 === 0 ? "up" : "down",
				220 + index * 170,
			),
		);
}
export function createPreviewDraw({
	id = "preview-round",
	count = 12,
	votes = [],
}: {
	id?: string;
	count?: number;
	votes?: RoomDrawVote[];
} = {}): RoomDraw {
	const candidates = sampleLunchPlaces.slice(
		0,
		Math.max(2, Math.min(count, sampleLunchPlaces.length)),
	);
	const winnerIndex = Math.min(2, candidates.length - 1);
	return {
		id,
		candidates,
		winnerIndex,
		source: "csprng",
		timestamp: previewStart - 1500,
		startedAt: previewStart,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: getWheelRotation(0, winnerIndex, candidates.length),
		listVersion: 1,
		participants: [
			{ id: "preview-host", name: "방장", isHost: true },
			...previewGuests,
		],
		probabilities: candidates.map(() => 1 / candidates.length),
		votes,
	};
}
export function appendPreviewVote(
	draw: RoomDraw,
	choice: RoomDrawVote["vote"],
	participant?: RoomParticipant,
): RoomDraw {
	const votes = draw.votes ?? [];
	const next =
		participant ??
		previewGuests.find(
			(guest) =>
				guest.id !== previewSelfId &&
				!votes.some((vote) => vote.participantId === guest.id),
		);
	if (!next || votes.some((vote) => vote.participantId === next.id))
		return draw;
	const delay = Math.max(50, ...votes.map((vote) => vote.reactionMs)) + 170;
	return { ...draw, votes: [...votes, previewVote(next, choice, delay, draw)] };
}
