import { createRoot } from "react-dom/client";
import LunchSessionPage from "@/components/features/LunchSessionPage";
import { homeRoomExample as example } from "@/data/homeRoomExample";
import { getWheelRotation } from "@/lib/lunch";
import type { RoomCandidate, RoomSnapshot } from "@/lib/lunchRoom";
import {
	createPreviewDraw,
	previewSelfId,
	previewVote,
} from "../../stories/core/fixtures";
import {
	previewRoomId,
	RoomPageFixtureProvider,
	useLunchRoom,
} from "../../stories/core/room-page-fixture";
import "@/styles.css";

const scene = new URLSearchParams(location.search).get("view");
const isHost = scene === "host";
const host = { id: "preview-host", name: example.host, isHost: true };
const guest = { id: previewSelfId, name: example.guest, isHost: false };
const participants = [host, guest];
const candidates: RoomCandidate[] = [
	...example.activities,
	example.recommendation,
].map((name, index) => ({
	id: `activity-${index + 1}`,
	name,
	category: "모임 활동",
	...(name === example.recommendation
		? { ownerId: guest.id, ownerName: guest.name }
		: {}),
}));
const winnerIndex = candidates.length - 1;
const startedAt = Date.now() - 12000;
const draw = {
	...createPreviewDraw({ count: candidates.length }),
	candidates,
	winnerIndex,
	startedAt,
	timestamp: startedAt,
	participants,
	toRotation: getWheelRotation(0, winnerIndex, candidates.length),
};
const snapshot: RoomSnapshot = {
	roomId: previewRoomId,
	title: example.title,
	listVersion: 1,
	createdAt: startedAt - 60000,
	expiresAt: startedAt + 86400000,
	candidates: scene === "guest" ? candidates.slice(0, -1) : candidates,
	participants,
	members: participants.map((person) => ({
		...person,
		status: "online",
		lastActiveAt: startedAt,
		lastSeenAt: startedAt,
	})),
	status:
		scene === "guest"
			? "collecting"
			: scene === "result"
				? "result"
				: "waiting",
	messages: [
		{
			id: "1",
			participantId: host.id,
			name: host.name,
			text: "다음 모임에는 뭐 할까?",
			timestamp: startedAt - 24000,
		},
		{
			id: "2",
			participantId: guest.id,
			name: guest.name,
			text: `${example.recommendation}도 해 보고 싶어!`,
			timestamp: startedAt - 14000,
		},
	],
	history: [],
	draw:
		scene === "result"
			? { ...draw, votes: [previewVote(guest, "up", 820, draw)] }
			: null,
};

function ExampleRoom() {
	const room = useLunchRoom(previewRoomId);
	const person = isHost ? host : guest;
	return (
		<LunchSessionPage
			roomId={previewRoomId}
			room={{ ...room, snapshot, nickname: person.name, self: person }}
		/>
	);
}

const root = document.getElementById("room-capture");
if (root) {
	root.dataset.recommendation = example.recommendation;
	createRoot(root).render(
		<RoomPageFixtureProvider
			initialPhase="idle"
			isHost={isHost}
			candidateCount={snapshot.candidates.length}
		>
			<ExampleRoom />
		</RoomPageFixtureProvider>,
	);
}
