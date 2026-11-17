import { useLunchRoom } from "@/hooks/useLunchRoom";
import LunchSessionPage from "./LunchSessionPage";

export default function LunchRoomPage({
	roomId,
	asGuest = false,
}: {
	roomId: string;
	asGuest?: boolean;
}) {
	const room = useLunchRoom(roomId, asGuest, { requireEntry: true });
	return <LunchSessionPage room={room} roomId={roomId} />;
}
