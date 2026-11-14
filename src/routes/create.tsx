import { createFileRoute } from "@tanstack/react-router";
import CreateLunchRoomPage from "@/components/features/CreateLunchRoomPage";
import { createSeoHead, privateRobots } from "@/lib/seo";

export const Route = createFileRoute("/create")({
	head: () =>
		createSeoHead({
			title: "방 만들기 · 점메추",
			description:
				"방 이름과 닉네임을 정해 점심 추첨방을 만드세요. 링크로 초대하면 같은 룰렛을 보며 채팅할 수 있습니다.",
		}),
	headers: () => ({
		"X-Robots-Tag": privateRobots,
		"Cache-Control": "private, no-store",
	}),
	component: CreateLunchRoomPage,
});
