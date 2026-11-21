import handler from "@tanstack/react-start/server-entry";
import { handleLunchRoomRequest } from "./server/lunchRoomHttp";
import { handlePublicMapConfigRequest } from "./server/publicMapConfig";
import {
	type DiagnosticEnvironment,
	roomPlacementDiagnostics,
} from "./server/roomPlacementDiagnostics";

export { LunchRoomServer } from "./rooms/LunchRoomServer";

export default {
	async fetch(request, env: Env & DiagnosticEnvironment) {
		const publicConfigResponse = handlePublicMapConfigRequest(request, env);
		if (publicConfigResponse) return publicConfigResponse;

		const response = await handleLunchRoomRequest(request, env);
		return response
			? roomPlacementDiagnostics(request, response, env)
			: handler.fetch(request);
	},
} satisfies ExportedHandler<Env>;
