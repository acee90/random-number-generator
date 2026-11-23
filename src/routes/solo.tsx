import { createFileRoute } from "@tanstack/react-router";
import CreateLunchRoomPage from "@/components/features/CreateLunchRoomPage";
import { createSeoHead, lunchPageSeo } from "@/lib/seo";

export const Route = createFileRoute("/solo")({
	head: () => createSeoHead(lunchPageSeo.solo),
	component: () => <CreateLunchRoomPage solo />,
});
