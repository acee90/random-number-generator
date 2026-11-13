import handler from "@tanstack/react-start/server-entry";
import { handleLunchRoomRequest } from "./server/lunchRoomHttp";

export { LunchRoomServer } from "./rooms/LunchRoomServer";

export default {
	async fetch(request, env) {
		const response = await handleLunchRoomRequest(request, env);
		return response ?? handler.fetch(request);
	},
} satisfies ExportedHandler<Env>;
