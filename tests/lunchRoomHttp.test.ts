import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLunchPlaces } from "../src/lib/lunch";
import { lunchRoomLimits } from "../src/lib/lunchRoom";
import { handleLunchRoomRequest } from "../src/server/lunchRoomHttp";

const party = vi.hoisted(() => ({
	initialize: vi.fn(),
	checkNicknameAvailability: vi.fn(),
	getServerByName: vi.fn(),
	routePartykitRequest: vi.fn(),
}));

vi.mock("partyserver", () => ({
	getServerByName: party.getServerByName,
	routePartykitRequest: party.routePartykitRequest,
}));

const origin = "https://randomlab.example";
const endpoint = `${origin}/api/lunch/rooms`;
const roomId = "28a5cbd4-051b-48f8-9e93-c052e4746b39";
const now = 1_800_000_000_000;
const binding = { testBinding: true };
const env = { LunchRooms: binding } as unknown as Env;
const ids = sampleLunchPlaces.slice(0, 3).map((place) => place.id);
const input = { title: "오늘 점심", hostName: "방장", candidateIds: ids };

function createRequest(body: unknown = input, init: RequestInit = {}) {
	return new Request(endpoint, {
		method: "POST",
		headers: { Origin: origin, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		...init,
	});
}

function websocketRequest(
	path = `/parties/lunch-rooms/${roomId}`,
	init: RequestInit = {},
) {
	return new Request(`${origin}${path}`, {
		method: "GET",
		headers: { Origin: origin, Upgrade: "websocket" },
		...init,
	});
}

async function responseFor(request: Request) {
	const response = await handleLunchRoomRequest(request, env);
	if (!response) throw new Error("Expected handled response");
	return response;
}

beforeEach(() => {
	vi.clearAllMocks();
	party.initialize.mockResolvedValue(undefined);
	party.checkNicknameAvailability.mockResolvedValue({
		status: 200,
		body: { name: "새이름", available: true },
	});
	party.getServerByName.mockResolvedValue({
		initialize: party.initialize,
		checkNicknameAvailability: party.checkNicknameAvailability,
	});
	party.routePartykitRequest.mockResolvedValue(
		new Response("routed", { status: 200 }),
	);
	vi.spyOn(Date, "now").mockReturnValue(now);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("lunch room HTTP creation", () => {
	it("returns a private host token while initializing the server with its SHA-256 hash only", async () => {
		const response = await responseFor(createRequest());
		const created = (await response.json()) as {
			roomId: string;
			title: string;
			expiresAt: number;
			hostToken: string;
			joinPath: string;
		};
		expect(response.status).toBe(201);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(response.headers.get("Content-Type")).toContain("application/json");
		expect(created.roomId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		expect(created.hostToken).toMatch(/^[0-9a-f]{64}$/);
		expect(created).toEqual({
			roomId: created.roomId,
			title: input.title,
			expiresAt: now + lunchRoomLimits.ttlMs,
			hostToken: created.hostToken,
			joinPath: `/lunch-room/${created.roomId}`,
		});
		expect(created.joinPath).not.toContain(created.hostToken);
		expect(created.joinPath).not.toContain("?");
		expect(party.getServerByName).toHaveBeenCalledExactlyOnceWith(
			binding,
			created.roomId,
		);
		const expectedHash = createHash("sha256")
			.update(created.hostToken)
			.digest("hex");
		expect(party.initialize).toHaveBeenCalledExactlyOnceWith({
			roomId: created.roomId,
			title: input.title,
			hostTokenHash: expectedHash,
			candidateIds: ids,
			createdAt: now,
		});
		expect(JSON.stringify(party.initialize.mock.calls)).not.toContain(
			created.hostToken,
		);
		expect(created).not.toHaveProperty("hostTokenHash");
		expect(party.routePartykitRequest).not.toHaveBeenCalled();
	});

	it("normalizes room names and preserves an explicitly ordered source candidate list", async () => {
		const candidateIds = [...ids].reverse();
		const response = await responseFor(
			createRequest({
				title: "  팀 점심  ",
				hostName: "  방장  ",
				candidateIds,
				hostToken: "client-cannot-choose-a-token",
				roomId: "client-cannot-choose-a-room",
			}),
		);
		expect(response.status).toBe(201);
		expect(await response.json()).toMatchObject({ title: "팀 점심" });
		expect(party.initialize.mock.calls[0][0]).toMatchObject({
			title: "팀 점심",
			candidateIds,
		});
		expect(party.initialize.mock.calls[0][0]).not.toHaveProperty("hostToken");
	});

	it("defaults omitted candidates to the complete supplied restaurant list", async () => {
		const response = await responseFor(
			createRequest({ title: "점심", hostName: "방장" }),
		);
		expect(response.status).toBe(201);
		expect(party.initialize.mock.calls[0][0].candidateIds).toHaveLength(107);
		expect(party.initialize.mock.calls[0][0].candidateIds).toEqual(
			sampleLunchPlaces.map((place) => place.id),
		);
	});

	it("creates a room with an explicit107-candidate selection inside the4096-byte UTF-8 boundary", async () => {
		const candidateIds = sampleLunchPlaces.map((place) => place.id);
		expect(candidateIds).toHaveLength(107);
		const base = {
			title: "한".repeat(60),
			hostName: "김".repeat(12),
			candidateIds,
			padding: "",
		};
		const remaining =
			lunchRoomLimits.maxMessageBytes -
			new TextEncoder().encode(JSON.stringify(base)).byteLength;
		expect(remaining).toBeGreaterThanOrEqual(0);
		const body = JSON.stringify({ ...base, padding: "x".repeat(remaining) });
		expect(new TextEncoder().encode(body).byteLength).toBe(4096);
		expect((await responseFor(createRequest(input, { body }))).status).toBe(
			201,
		);
		expect(party.initialize.mock.calls[0][0].candidateIds).toEqual(
			candidateIds,
		);
		expect(
			(await responseFor(createRequest(input, { body: `${body} ` }))).status,
		).toBe(413);
		expect(party.initialize).toHaveBeenCalledTimes(1);
	});

	it.each([
		null,
		[],
		{ ...input, title: " " },
		{ ...input, hostName: "x".repeat(21) },
		{ ...input, candidateIds: [] },
		{ ...input, candidateIds: [ids[0]] },
		{ ...input, candidateIds: [ids[0], ids[0]] },
		{ ...input, candidateIds: [ids[0], "https://example.com/menu"] },
		{ ...input, candidateIds: [ids[0], { id: ids[1], name: "주입한 식당" }] },
		{
			...input,
			candidateIds: [...sampleLunchPlaces.map((place) => place.id), ids[0]],
		},
	])("rejects invalid settings before accessing the room binding: %j", async (body) => {
		const response = await responseFor(createRequest(body));
		expect(response.status).toBe(400);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(party.getServerByName).not.toHaveBeenCalled();
		expect(party.initialize).not.toHaveBeenCalled();
	});

	it.each([
		"GET",
		"PUT",
		"PATCH",
		"DELETE",
		"OPTIONS",
	])("requires POST rather than %s", async (method) => {
		const response = await responseFor(new Request(endpoint, { method }));
		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("POST");
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"null",
		"https://foreign.example",
		`${origin}.foreign.example`,
	])("requires the exact same-origin creation header: %s", async (requestOrigin) => {
		const headers = new Headers({ "Content-Type": "application/json" });
		if (requestOrigin !== undefined) headers.set("Origin", requestOrigin);
		const response = await responseFor(createRequest(input, { headers }));
		expect(response.status).toBe(403);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"text/plain",
		"application/x-www-form-urlencoded",
	])("requires JSON content type: %s", async (contentType) => {
		const headers = new Headers({ Origin: origin });
		if (contentType !== undefined) headers.set("Content-Type", contentType);
		const response = await responseFor(createRequest(input, { headers }));
		expect(response.status).toBe(415);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it("accepts the JSON media type with a charset parameter", async () => {
		const response = await responseFor(
			createRequest(input, {
				headers: {
					Origin: origin,
					"Content-Type": "application/json; charset=utf-8",
				},
			}),
		);
		expect(response.status).toBe(201);
	});

	it.each([
		"{",
		"",
		new Uint8Array([0xff, 0xfe]),
	])("rejects malformed JSON or invalid UTF-8 bytes: %j", async (body) => {
		const response = await responseFor(createRequest(input, { body }));
		expect(response.status).toBe(400);
		expect(party.initialize).not.toHaveBeenCalled();
	});

	it("rejects an absent request body", async () => {
		const response = await responseFor(
			createRequest(input, { body: undefined }),
		);
		expect(response.status).toBe(400);
	});

	it("rejects an advertised oversized body before initializing a room", async () => {
		const response = await responseFor(
			createRequest(input, {
				headers: {
					Origin: origin,
					"Content-Type": "application/json",
					"Content-Length": `${lunchRoomLimits.maxMessageBytes + 1}`,
				},
			}),
		);
		expect(response.status).toBe(413);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it("bounds actual UTF-8 bytes even without Content-Length", async () => {
		const body = JSON.stringify({ ...input, padding: "한".repeat(1400) });
		expect(body.length).toBeLessThan(lunchRoomLimits.maxMessageBytes);
		const response = await responseFor(createRequest(input, { body }));
		expect(response.status).toBe(413);
		expect(party.initialize).not.toHaveBeenCalled();
	});

	it("accepts exactly the maximum byte length", async () => {
		const base = { ...input, padding: "" };
		const remaining =
			lunchRoomLimits.maxMessageBytes -
			new TextEncoder().encode(JSON.stringify(base)).byteLength;
		const body = JSON.stringify({ ...base, padding: "x".repeat(remaining) });
		expect(new TextEncoder().encode(body).byteLength).toBe(
			lunchRoomLimits.maxMessageBytes,
		);
		expect((await responseFor(createRequest(input, { body }))).status).toBe(
			201,
		);
	});

	it("cancels a streamed oversized body despite a misleading Content-Length", async () => {
		const cancel = vi.fn();
		let position = 0;
		const chunks = [
			new Uint8Array(4000),
			new Uint8Array(100),
			new Uint8Array(100),
		];
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				const chunk = chunks[position++];
				if (chunk) controller.enqueue(chunk);
				else controller.close();
			},
			cancel,
		});
		const request = createRequest(input, {
			headers: {
				Origin: origin,
				"Content-Type": "application/json",
				"Content-Length": "1",
			},
			body: stream,
			duplex: "half",
		} as RequestInit);
		const response = await responseFor(request);
		expect(response.status).toBe(413);
		expect(cancel).toHaveBeenCalledOnce();
		expect(party.initialize).not.toHaveBeenCalled();
	});

	it.each([
		"lookup",
		"initialize",
	])("returns503 on room %s failure without leaking credentials", async (failure) => {
		if (failure === "lookup")
			party.getServerByName.mockRejectedValueOnce(
				new Error("private binding details"),
			);
		else
			party.initialize.mockRejectedValueOnce(
				new Error("private token details"),
			);
		const response = await responseFor(createRequest());
		expect(response.status).toBe(503);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const body = (await response.json()) as Record<string, unknown>;
		expect(Object.keys(body)).toEqual(["error"]);
		expect(JSON.stringify(body)).not.toContain("private");
		expect(body).not.toHaveProperty("hostToken");
	});
});

describe("lunch room nickname availability HTTP", () => {
	const path = `/api/lunch/rooms/${roomId}/nickname-availability`;
	const requestForName = (
		body: unknown = { name: "새이름" },
		init: RequestInit = {},
	) =>
		new Request(`${origin}${path}`, {
			method: "POST",
			headers: { Origin: origin, "Content-Type": "application/json" },
			body: JSON.stringify(body),
			...init,
		});

	it("checks the exact room RPC without joining or exposing any extra response fields", async () => {
		const body = {
			name: "새이름",
			hostToken: "h".repeat(64),
			guestToken: "g".repeat(64),
		};
		party.checkNicknameAvailability.mockResolvedValueOnce({
			status: 200,
			body: {
				name: "새이름",
				available: false,
				participants: ["private-name"],
				hostToken: "private-token",
			},
		});
		const response = await responseFor(requestForName(body));
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({ name: "새이름", available: false });
		expect(party.getServerByName).toHaveBeenCalledExactlyOnceWith(
			binding,
			roomId,
		);
		expect(party.checkNicknameAvailability).toHaveBeenCalledExactlyOnceWith(
			body,
		);
		expect(party.initialize).not.toHaveBeenCalled();
		expect(party.routePartykitRequest).not.toHaveBeenCalled();
	});

	it.each([
		400, 403, 404, 410,
	])("preserves server error status %s without leaking a roster or proofs", async (status) => {
		party.checkNicknameAvailability.mockResolvedValueOnce({
			status,
			body: {
				code: "EXPECTED_CODE",
				error: "안내",
				participants: ["private-name"],
				hostToken: "private-token",
			},
		});
		const response = await responseFor(requestForName());
		expect(response.status).toBe(status);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({
			code: "EXPECTED_CODE",
			error: "안내",
		});
	});

	it("requires POST on the availability route", async () => {
		const response = await responseFor(
			new Request(`${origin}${path}`, { headers: { Origin: origin } }),
		);
		expect(response.status).toBe(405);
		expect(response.headers.get("Allow")).toBe("POST");
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"null",
		"https://foreign.example",
		`${origin}.foreign.example`,
	])("rejects a missing or foreign availability origin: %s", async (requestOrigin) => {
		const headers = new Headers({ "Content-Type": "application/json" });
		if (requestOrigin !== undefined) headers.set("Origin", requestOrigin);
		const response = await responseFor(requestForName(undefined, { headers }));
		expect(response.status).toBe(403);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"text/plain",
		"application/x-www-form-urlencoded",
	])("requires JSON for availability input: %s", async (contentType) => {
		const headers = new Headers({ Origin: origin });
		if (contentType !== undefined) headers.set("Content-Type", contentType);
		const response = await responseFor(requestForName(undefined, { headers }));
		expect(response.status).toBe(415);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it.each([
		"{",
		"",
		new Uint8Array([0xff]),
	])("rejects malformed availability JSON or UTF-8: %j", async (body) => {
		const response = await responseFor(requestForName(undefined, { body }));
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST" });
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it("bounds availability payload bytes before accessing a Durable Object", async () => {
		const response = await responseFor(
			requestForName({ name: "이름", extra: "한".repeat(1400) }),
		);
		expect(response.status).toBe(413);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it("rejects a malformed room ID and does not route suffixes or different endpoint names", async () => {
		const invalid = await responseFor(
			new Request(`${origin}/api/lunch/rooms/not-a-uuid/nickname-availability`),
		);
		expect(invalid.status).toBe(404);
		for (const invalidPath of [
			`${path}/`,
			`${path}/extra`,
			`/api/lunch/rooms/${roomId}/nickname`,
		])
			expect(
				await handleLunchRoomRequest(
					new Request(`${origin}${invalidPath}`),
					env,
				),
			).toBeNull();
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it.each([
		"lookup",
		"check",
	])("returns a generic503 on %s failure without revealing private error details", async (failure) => {
		if (failure === "lookup")
			party.getServerByName.mockRejectedValueOnce(
				new Error("private binding and proof"),
			);
		else
			party.checkNicknameAvailability.mockRejectedValueOnce(
				new Error("private binding and proof"),
			);
		const response = await responseFor(requestForName());
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			code: "AVAILABILITY_UNAVAILABLE",
			error: "닉네임을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		});
	});
});

describe("lunch room WebSocket routing", () => {
	it("routes only an exact UUID party path with GET, upgrade and matching origin", async () => {
		const request = websocketRequest(
			`/parties/lunch-rooms/${roomId}?_pk=connection-id`,
		);
		const response = await responseFor(request);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("routed");
		expect(party.routePartykitRequest).toHaveBeenCalledExactlyOnceWith(
			request,
			env,
			{ cors: false },
		);
		expect(party.getServerByName).not.toHaveBeenCalled();
	});

	it("accepts a case-insensitive WebSocket Upgrade header", async () => {
		expect(
			(
				await responseFor(
					websocketRequest(undefined, {
						headers: { Origin: origin, Upgrade: "WebSocket" },
					}),
				)
			).status,
		).toBe(200);
	});

	it.each([
		"/parties/",
		`/parties/other/${roomId}`,
		"/parties/lunch-rooms/not-a-uuid",
		`/parties/lunch-rooms/${roomId}/`,
		`/parties/lunch-rooms/${roomId}/extra`,
		"/parties/lunch-rooms/https%3A%2F%2Fforeign.example",
	])("rejects an unknown party or inexact path: %s", async (path) => {
		const response = await responseFor(websocketRequest(path));
		expect(response.status).toBe(404);
		expect(party.routePartykitRequest).not.toHaveBeenCalled();
	});

	it.each([
		{ method: "POST" },
		{ method: "PUT" },
		{ headers: { Origin: origin } },
		{ headers: { Origin: origin, Upgrade: "h2c" } },
	] as RequestInit[])("requires a GET WebSocket upgrade: %j", async (init) => {
		const response = await responseFor(websocketRequest(undefined, init));
		expect(response.status).toBe(426);
		expect(party.routePartykitRequest).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		"null",
		"https://foreign.example",
		`${origin}.foreign.example`,
	])("rejects missing or foreign WebSocket origin: %s", async (requestOrigin) => {
		const headers = new Headers({ Upgrade: "websocket" });
		if (requestOrigin !== undefined) headers.set("Origin", requestOrigin);
		const response = await responseFor(
			websocketRequest(undefined, { headers }),
		);
		expect(response.status).toBe(403);
		expect(party.routePartykitRequest).not.toHaveBeenCalled();
	});

	it("returns404 when PartyServer does not recognize an otherwise valid room route", async () => {
		party.routePartykitRequest.mockResolvedValueOnce(null);
		expect((await responseFor(websocketRequest())).status).toBe(404);
	});
});

describe("unrelated request fallback", () => {
	it.each([
		"/",
		"/lunch-room/test",
		"/api/lunch/rooms/",
		"/api/other",
		"/parties-other/test",
	])("leaves an unknown route for the application handler: %s", async (path) => {
		expect(
			await handleLunchRoomRequest(new Request(`${origin}${path}`), env),
		).toBeNull();
		expect(party.routePartykitRequest).not.toHaveBeenCalled();
		expect(party.getServerByName).not.toHaveBeenCalled();
	});
});
