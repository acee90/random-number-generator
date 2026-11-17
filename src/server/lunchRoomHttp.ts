import { getServerByName, routePartykitRequest } from "partyserver";
import {
	isLunchRoomId,
	lunchRoomLimits,
	validateCreateRoomInput,
} from "@/lib/lunchRoom";
import {
	nicknameCheckPath,
	readBoundedRoomJson,
	roomEntryInfoPath,
} from "@/lib/lunchRoomRequest.server";
import { parseRoomEntryInfo } from "@/lib/roomEntryInfo";

const json = (value: unknown, status: number, headers?: HeadersInit) =>
	Response.json(value, {
		status,
		headers: { "Cache-Control": "no-store", ...headers },
	});

type LunchRoomEnvironment = Env & { LUNCH_ROOM_LOCATION_HINT?: string };

function roomLocationOptions(
	env: LunchRoomEnvironment,
): { locationHint: "apac-ne" } | undefined {
	// Hints only affect the first get for a new object; existing rooms stay put.
	return env.LUNCH_ROOM_LOCATION_HINT === "apac-ne"
		? { locationHint: "apac-ne" }
		: undefined;
}

export async function handleLunchRoomRequest(
	request: Request,
	env: LunchRoomEnvironment,
): Promise<Response | null> {
	const url = new URL(request.url);
	const entryInfoPath = url.pathname.match(
		/^\/api\/lunch\/rooms\/([^/]+)\/entry-info$/,
	);
	if (entryInfoPath) {
		const roomId = entryInfoPath[1];
		if (!isLunchRoomId(roomId))
			return json(
				{ code: "ROOM_NOT_FOUND", error: "방을 찾을 수 없습니다." },
				404,
			);
		if (request.method !== "GET")
			return json({ error: "GET 요청이 필요합니다." }, 405, { Allow: "GET" });
		// Same-origin GET fetches may omit Origin. Never grant cross-origin reads.
		const origin = request.headers.get("Origin");
		if (
			(origin !== null && origin !== url.origin) ||
			request.headers.get("Sec-Fetch-Site") === "cross-site"
		)
			return json({ error: "같은 사이트에서 방 정보를 확인해 주세요." }, 403);
		try {
			const room = env.LunchRooms.get(
				env.LunchRooms.idFromName(roomId),
				roomLocationOptions(env),
			);
			const response = await room.fetch(
				new Request(`https://lunch-room.internal${roomEntryInfoPath}`, {
					method: "GET",
					headers: { "x-partykit-room": roomId },
				}),
			);
			const body: unknown = await response.json();
			if (response.status === 200) {
				const info = parseRoomEntryInfo(body);
				if (!info) throw new Error("Invalid room entry info");
				return json(info, 200);
			}
			if (response.status === 404 || response.status === 410) {
				const expired = response.status === 410;
				const closed =
					expired &&
					typeof body === "object" &&
					body !== null &&
					"code" in body &&
					body.code === "ROOM_CLOSED";
				return json(
					{
						code: closed
							? "ROOM_CLOSED"
							: expired
								? "ROOM_EXPIRED"
								: "ROOM_NOT_FOUND",
						error: closed
							? "방장이 방을 종료했습니다."
							: expired
								? "방이 만료됐습니다."
								: "방을 찾을 수 없습니다.",
					},
					response.status,
				);
			}
			throw new Error("Room entry info unavailable");
		} catch {
			return json(
				{
					code: "ENTRY_INFO_UNAVAILABLE",
					error: "방 정보를 불러오지 못했습니다.",
				},
				503,
			);
		}
	}
	const availabilityPath = url.pathname.match(
		/^\/api\/lunch\/rooms\/([^/]+)\/nickname-availability$/,
	);
	if (availabilityPath) {
		const startedAt = performance.now();
		const roomId = availabilityPath[1];
		if (!isLunchRoomId(roomId))
			return json(
				{ code: "ROOM_NOT_FOUND", error: "방을 찾을 수 없습니다." },
				404,
			);
		if (request.method !== "POST")
			return json({ error: "POST 요청이 필요합니다." }, 405, { Allow: "POST" });
		if (request.headers.get("Origin") !== url.origin)
			return json({ error: "같은 사이트에서 닉네임을 확인해 주세요." }, 403);
		if (
			request.headers.get("Content-Type")?.split(";")[0].trim() !==
			"application/json"
		)
			return json({ error: "JSON 형식이 필요합니다." }, 415);
		let body: unknown;
		try {
			body = await readBoundedRoomJson(request);
		} catch (error) {
			return json(
				{ code: "INVALID_REQUEST", error: "입력 내용을 확인해 주세요." },
				error instanceof RangeError ? 413 : 400,
			);
		}
		try {
			const room = env.LunchRooms.get(
				env.LunchRooms.idFromName(roomId),
				roomLocationOptions(env),
			);
			const roomStartedAt = performance.now();
			// PartyServer.fetch initializes onStart before onRequest. Unlike
			// getServerByName + RPC this needs only one Worker-to-room round trip.
			const response = await room.fetch(
				new Request(`https://lunch-room.internal${nicknameCheckPath}`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-partykit-room": roomId,
					},
					body: JSON.stringify(body),
				}),
			);
			const result = (await response.json()) as {
				name?: string;
				available?: boolean;
				code?: string;
				error?: string;
			};
			const timings = [
				`room;dur=${(performance.now() - roomStartedAt).toFixed(1)}`,
				`worker;dur=${(performance.now() - startedAt).toFixed(1)}`,
			];
			const nicknameTiming = response.headers.get("Server-Timing");
			if (nicknameTiming && /^nickname;dur=\d+(?:\.\d+)?$/.test(nicknameTiming))
				timings.unshift(nicknameTiming);
			const headers = { "Server-Timing": timings.join(", ") };
			return response.status === 200
				? json({ name: result.name, available: result.available }, 200, headers)
				: json(
						{ code: result.code, error: result.error },
						response.status,
						headers,
					);
		} catch {
			return json(
				{
					code: "AVAILABILITY_UNAVAILABLE",
					error: "닉네임을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
				},
				503,
			);
		}
	}
	if (url.pathname === "/api/lunch/rooms") {
		if (request.method !== "POST")
			return json({ error: "POST 요청이 필요합니다." }, 405, { Allow: "POST" });
		if (request.headers.get("Origin") !== url.origin)
			return json({ error: "같은 사이트에서 방을 만들어 주세요." }, 403);
		if (
			request.headers.get("Content-Type")?.split(";")[0].trim() !==
			"application/json"
		)
			return json({ error: "JSON 형식이 필요합니다." }, 415);
		let body: unknown;
		try {
			body = await readBoundedRoomJson(request);
		} catch (error) {
			return json(
				{ error: "방 설정을 확인해 주세요." },
				error instanceof RangeError ? 413 : 400,
			);
		}
		const input = validateCreateRoomInput(body);
		if (!input)
			return json(
				{ error: "방 이름, 참가자 이름과 추첨 후보를 확인해 주세요." },
				400,
			);
		try {
			const roomId = crypto.randomUUID();
			const hostToken = Array.from(
				crypto.getRandomValues(new Uint8Array(32)),
				(byte) => byte.toString(16).padStart(2, "0"),
			).join("");
			const hash = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(hostToken),
			);
			const hostTokenHash = Array.from(new Uint8Array(hash), (byte) =>
				byte.toString(16).padStart(2, "0"),
			).join("");
			const createdAt = Date.now();
			const room = await getServerByName(
				env.LunchRooms,
				roomId,
				roomLocationOptions(env),
			);
			await room.initialize({
				roomId,
				title: input.title,
				hostTokenHash,
				candidateIds: input.candidateIds,
				createdAt,
			});
			return json(
				{
					roomId,
					title: input.title,
					expiresAt: createdAt + lunchRoomLimits.ttlMs,
					hostToken,
					joinPath: `/lunch-room/${roomId}`,
				},
				201,
			);
		} catch {
			return json(
				{ error: "지금은 방을 만들 수 없습니다. 잠시 후 다시 시도해 주세요." },
				503,
			);
		}
	}
	if (url.pathname.startsWith("/parties/")) {
		const prefix = "/parties/lunch-rooms/";
		if (
			!url.pathname.startsWith(prefix) ||
			!isLunchRoomId(url.pathname.slice(prefix.length))
		)
			return new Response("Not Found", { status: 404 });
		if (
			request.method !== "GET" ||
			request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
		)
			return new Response("WebSocket required", { status: 426 });
		if (request.headers.get("Origin") !== url.origin)
			return new Response("Forbidden", { status: 403 });
		return (
			(await routePartykitRequest(request, env, {
				cors: false,
				...roomLocationOptions(env),
			})) ?? new Response("Not Found", { status: 404 })
		);
	}
	return null;
}
