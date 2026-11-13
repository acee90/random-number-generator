import { getServerByName, routePartykitRequest } from "partyserver";
import {
	isLunchRoomId,
	lunchRoomLimits,
	validateCreateRoomInput,
} from "@/lib/lunchRoom";

const json = (value: unknown, status: number, headers?: HeadersInit) =>
	Response.json(value, {
		status,
		headers: { "Cache-Control": "no-store", ...headers },
	});

async function boundedJson(request: Request): Promise<unknown> {
	if (
		Number(request.headers.get("Content-Length")) >
		lunchRoomLimits.maxMessageBytes
	)
		throw new RangeError("Request too large");
	const reader = request.body?.getReader();
	if (!reader) throw new SyntaxError("Empty body");
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > lunchRoomLimits.maxMessageBytes) {
				await reader.cancel();
				throw new RangeError("Request too large");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function handleLunchRoomRequest(
	request: Request,
	env: Env,
): Promise<Response | null> {
	const url = new URL(request.url);
	const availabilityPath = url.pathname.match(
		/^\/api\/lunch\/rooms\/([^/]+)\/nickname-availability$/,
	);
	if (availabilityPath) {
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
			body = await boundedJson(request);
		} catch (error) {
			return json(
				{ code: "INVALID_REQUEST", error: "입력 내용을 확인해 주세요." },
				error instanceof RangeError ? 413 : 400,
			);
		}
		try {
			const room = await getServerByName(env.LunchRooms, roomId);
			const result = await room.checkNicknameAvailability(body);
			return result.status === 200
				? json(
						{ name: result.body.name, available: result.body.available },
						200,
					)
				: json(
						{ code: result.body.code, error: result.body.error },
						result.status,
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
			body = await boundedJson(request);
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
			const room = await getServerByName(env.LunchRooms, roomId);
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
			(await routePartykitRequest(request, env, { cors: false })) ??
			new Response("Not Found", { status: 404 })
		);
	}
	return null;
}
