import { createServerFn } from "@tanstack/react-start";

export const getRoomShareInfo = createServerFn({ method: "GET" })
	.validator((roomId: string) => roomId)
	.handler(async ({ data }) => {
		const { env } = await import("cloudflare:workers");
		const { readRoomShareInfo } = await import("@/server/roomShare");
		return readRoomShareInfo(data, env);
	});
