import { useState } from "react";
import SiteHeader from "@/components/layout/SiteHeader";
import { useSoloLunch } from "@/hooks/useSoloLunch";
import { readLunchHistory } from "@/lib/lunchHistory";
import type { RoomSnapshot } from "@/lib/lunchRoom";
import { readPreviousSoloDraws, readSoloRoom } from "@/lib/soloRoom";
import { RoomTerminalActions } from "./ClosedRoomHistory";
import LunchSessionPage from "./LunchSessionPage";

export default function SoloLunchRoomPage({ roomId }: { roomId: string }) {
	const [saved] = useState(() => readSoloRoom(roomId));
	if (saved)
		return (
			<SoloSession
				initial={saved.snapshot}
				storageFailed={saved.storageFailed}
			/>
		);
	return (
		<div className="random-lab lunch-room">
			<SiteHeader active="lunch" />
			<main id="main-content" className="room-main">
				<section className="room-terminal">
					<h1>이 탭에서 방을 찾을 수 없습니다</h1>
					<p>혼자 만든 방은 처음 만든 탭에서 24시간 동안 이용할 수 있어요.</p>
					<RoomTerminalActions />
				</section>
			</main>
		</div>
	);
}

function SoloSession({
	initial,
	storageFailed: restoreFailed,
}: {
	initial: RoomSnapshot;
	storageFailed: boolean;
}) {
	const { room, storageFailed } = useSoloLunch(initial, restoreFailed);
	const [previous] = useState(readPreviousSoloDraws);
	const [legacyHistory] = useState(() => readLunchHistory());
	return (
		<LunchSessionPage
			room={room}
			roomId={initial.roomId}
			solo
			legacyHistory={legacyHistory}
			previousDraws={previous.draws}
			storageFailed={storageFailed || previous.failed}
		/>
	);
}
