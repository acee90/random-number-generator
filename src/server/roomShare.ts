import { isLunchRoomId } from "@/lib/lunchRoom";
import { parseRoomEntryInfo } from "@/lib/roomEntryInfo";
import { type RoomShareInfo, siteOrigin } from "@/lib/seo";
import {
	handleLunchRoomRequest,
	type LunchRoomEnvironment,
} from "./lunchRoomHttp";

/** Reuse the title-only read; never join a room or expose its snapshot. */
export async function readRoomShareInfo(
	roomId: string,
	env: LunchRoomEnvironment,
): Promise<RoomShareInfo> {
	if (!isLunchRoomId(roomId)) return { status: "missing" };
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			(async (): Promise<RoomShareInfo> => {
				const response = await handleLunchRoomRequest(
					new Request(`${siteOrigin}/api/lunch/rooms/${roomId}/entry-info`),
					env,
				);
				if (!response) return { status: "unavailable" };
				const body: unknown = await response.json();
				if (response.status === 200) {
					const info = parseRoomEntryInfo(body);
					return info
						? { status: "open", title: info.title }
						: { status: "unavailable" };
				}
				if (response.status === 404) return { status: "missing" };
				if (response.status === 410)
					return {
						status:
							typeof body === "object" &&
							body !== null &&
							"code" in body &&
							body.code === "ROOM_CLOSED"
								? "closed"
								: "expired",
					};
				return { status: "unavailable" };
			})(),
			new Promise<RoomShareInfo>((resolve) => {
				timer = setTimeout(() => resolve({ status: "unavailable" }), 2000);
			}),
		]);
	} catch {
		return { status: "unavailable" };
	} finally {
		clearTimeout(timer);
	}
}
