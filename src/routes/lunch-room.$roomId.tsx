import { createFileRoute } from "@tanstack/react-router";
import LunchRoomPage from "@/components/features/LunchRoomPage";
import { createRoomSeoHead, privateRobots } from "@/lib/seo";
import { getRoomShareInfo } from "@/services/roomShare";

export const Route = createFileRoute("/lunch-room/$roomId")({
	validateSearch: (search: Record<string, unknown>): { guest?: 1 } => ({
		guest: search.guest === "1" || search.guest === 1 ? 1 : undefined,
	}),
	loader: ({ params }) => getRoomShareInfo({ data: params.roomId }),
	head: ({ params, loaderData }) =>
		createRoomSeoHead(params.roomId, loaderData),
	headers: () => ({
		"X-Robots-Tag": privateRobots,
		"Cache-Control": "private, no-store",
	}),
	component: Room,
});

function Room() {
	const { roomId } = Route.useParams();
	const { guest } = Route.useSearch();
	return <LunchRoomPage roomId={roomId} asGuest={guest === 1} />;
}
