import { createFileRoute } from "@tanstack/react-router";
import SoloLunchRoomPage from "@/components/features/SoloLunchRoomPage";
import { createSeoHead, privateRobots } from "@/lib/seo";

export const Route = createFileRoute("/solo_/$roomId")({
	ssr: false,
	head: () =>
		createSeoHead({
			title: "혼자 추첨하기 · 점메추",
			description: "이 브라우저에서 만든 혼자 추첨입니다.",
		}),
	headers: () => ({
		"X-Robots-Tag": privateRobots,
		"Cache-Control": "private, no-store",
	}),
	component: SoloRoom,
});

function SoloRoom() {
	const { roomId } = Route.useParams();
	return <SoloLunchRoomPage key={roomId} roomId={roomId} />;
}
