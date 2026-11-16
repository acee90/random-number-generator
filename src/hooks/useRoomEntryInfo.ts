import { useEffect, useState } from "react";
import { isLunchRoomId } from "@/lib/lunchRoom";
import { parseRoomEntryInfo } from "@/lib/roomEntryInfo";

type EntryInfoState = {
	roomId: string;
	title: string | null;
	status: "loading" | "ready" | "error";
};

/** Read the invite's title without opening a socket or using identity proofs. */
export function useRoomEntryInfo({
	roomId,
	enabled = true,
}: {
	roomId: string;
	enabled?: boolean;
}): Pick<EntryInfoState, "title" | "status"> {
	const [result, setResult] = useState<EntryInfoState | null>(null);
	useEffect(() => {
		if (!enabled || !isLunchRoomId(roomId)) return;
		let active = true;
		const controller = new AbortController();
		setResult({ roomId, title: null, status: "loading" });
		const timeout = setTimeout(() => {
			if (!active) return;
			controller.abort();
			setResult({ roomId, title: null, status: "error" });
		}, 8000);
		async function load() {
			try {
				const response = await fetch(`/api/lunch/rooms/${roomId}/entry-info`, {
					method: "GET",
					credentials: "same-origin",
					cache: "no-store",
					signal: controller.signal,
				});
				if (!response.ok) throw new Error("Room info unavailable");
				const info = parseRoomEntryInfo(await response.json());
				if (!info) throw new Error("Invalid room info");
				if (active && !controller.signal.aborted)
					setResult({ roomId, title: info.title, status: "ready" });
			} catch {
				if (active && !controller.signal.aborted)
					setResult({ roomId, title: null, status: "error" });
			} finally {
				clearTimeout(timeout);
			}
		}
		void load();
		return () => {
			active = false;
			controller.abort();
			clearTimeout(timeout);
		};
	}, [roomId, enabled]);
	if (!isLunchRoomId(roomId)) return { title: null, status: "error" };
	return result?.roomId === roomId
		? { title: result.title, status: result.status }
		: { title: null, status: "loading" };
}
