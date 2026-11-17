import { useEffect, useState } from "react";
import { useSoloLunch } from "@/hooks/useSoloLunch";
import type { LunchPlace } from "@/lib/lunch";
import { type LunchHistoryRecord, readLunchHistory } from "@/lib/lunchHistory";
import LunchSessionPage from "./LunchSessionPage";

export default function LunchPicker({
	places,
}: {
	places?: readonly LunchPlace[];
} = {}) {
	const { room, storageFailed } = useSoloLunch(places);
	const [legacyHistory, setLegacyHistory] = useState<LunchHistoryRecord[]>([]);
	useEffect(() => setLegacyHistory(readLunchHistory()), []);
	return (
		<LunchSessionPage
			room={room}
			roomId="solo"
			solo
			legacyHistory={legacyHistory}
			storageFailed={storageFailed}
		/>
	);
}
