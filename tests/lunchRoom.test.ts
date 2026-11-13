import { describe, expect, it } from "vitest";
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	type ChatMessage,
	clampLunchRoomNickname,
	isLunchRoomId,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	parseClientMessage,
	parseRoomSnapshot,
	parseServerMessage,
	type RoomDraw,
	type RoomDrawVote,
	type RoomMember,
	type RoomSnapshot,
	resolveCandidateIds,
	validateCreateRoomInput,
} from "../src/lib/lunchRoom";

const now = 1_800_000_000_000;
const roomId = "fc76a783-253a-47c7-95cd-5a7c9851d675";
const ids = sampleLunchPlaces.slice(0, 3).map((place) => place.id);

function makeDraw(overrides: Partial<RoomDraw> = {}): RoomDraw {
	return {
		id: "draw-1",
		candidates: sampleLunchPlaces.slice(0, 3).map((place) => ({ ...place })),
		winnerIndex: 0,
		source: "quantum",
		timestamp: now + 500,
		startedAt: now + 1000,
		durationMs: 7200,
		fromRotation: 0,
		toRotation: 1740,
		listVersion: 1,
		...overrides,
	};
}

function makeChat(overrides: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id: "chat-1",
		participantId: "guest-1",
		name: "참가자",
		text: "같이 점심 골라요!",
		timestamp: now + 100,
		...overrides,
	};
}

function makeRoom(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
	return {
		roomId,
		title: "오늘 점심",
		createdAt: now,
		expiresAt: now + lunchRoomLimits.ttlMs,
		listVersion: 1,
		candidates: sampleLunchPlaces.slice(0, 3).map((place) => ({ ...place })),
		participants: [
			{ id: "host-1", name: "방장", isHost: true },
			{ id: "guest-1", name: "참가자", isHost: false },
		],
		messages: [makeChat()],
		draw: null,
		history: [],
		status: "waiting",
		...overrides,
	};
}

const client = (value: unknown) => parseClientMessage(JSON.stringify(value));
const server = (value: unknown) => parseServerMessage(JSON.stringify(value));

describe("room draw vote protocol", () => {
	const endedAt = now + 8200;
	const vote: RoomDrawVote = {
		participantId: "voter-1",
		name: "참가자",
		vote: "up",
		timestamp: endedAt + 1450,
		reactionMs: 1450,
	};

	it("requires both a request ID and the exact draw ID to close voting", () => {
		expect(
			client({ type: "next", id: "next-1", drawId: "draw-1", winnerIndex: 3 }),
		).toEqual({ type: "next", id: "next-1", drawId: "draw-1" });
		for (const invalid of [
			{ type: "next", id: "next-1" },
			{ type: "next", drawId: "draw-1" },
			{ type: "next", id: "next-1", drawId: "../draw" },
		])
			expect(client(invalid)).toBeNull();
	});

	it("accepts only an identified up/down request and discards client-supplied voter metadata", () => {
		for (const choice of ["up", "down"])
			expect(
				client({
					type: "vote",
					id: "vote-request",
					drawId: "draw-1",
					vote: choice,
					participantId: "forged-host",
					name: "위조이름",
					timestamp: 1,
					reactionMs: 0,
				}),
			).toEqual({
				type: "vote",
				id: "vote-request",
				drawId: "draw-1",
				vote: choice,
			});
		for (const invalid of [
			{ type: "vote", drawId: "draw-1", vote: "up" },
			{ type: "vote", id: "vote-request", vote: "up" },
			{ type: "vote", id: "vote-request", drawId: "draw-1", vote: "clear" },
			{ type: "vote", id: "vote-request", drawId: "draw-1", vote: 1 },
			{ type: "vote", id: "vote-request", drawId: "../draw", vote: "down" },
		])
			expect(client(invalid)).toBeNull();
	});

	it("keeps legacy vote absence intact and copies valid public ballots without private fields", () => {
		const old = makeRoom({ draw: makeDraw() });
		expect(parseRoomSnapshot(old)).toEqual(old);
		expect(parseRoomSnapshot(old)?.draw).not.toHaveProperty("votes");
		const original = makeDraw({
			votes: [
				{
					...vote,
					hostToken: "private-proof",
					guestTokenHash: "private-hash",
				} as RoomDrawVote,
			],
		});
		const parsed = parseRoomSnapshot(makeRoom({ draw: original }));
		expect(parsed?.draw?.votes).toEqual([vote]);
		expect(JSON.stringify(parsed)).not.toContain("private");
		if (original.votes) original.votes[0].name = "바뀐이름";
		expect(parsed?.draw?.votes?.[0].name).toBe("참가자");
		expect(
			parseRoomSnapshot(
				makeRoom({
					draw: makeDraw({
						votes: [{ ...vote, timestamp: endedAt, reactionMs: 0 }],
					}),
				}),
			),
		).not.toBeNull();
	});

	it("rejects duplicate voters, excessive lists and malformed vote timestamps or reaction durations", () => {
		const invalidLists: unknown[] = [
			null,
			{},
			[vote, { ...vote, vote: "down" }],
			Array.from({ length: lunchRoomLimits.maxMembers + 1 }, (_, index) => ({
				...vote,
				participantId: `voter-${index}`,
			})),
			...[
				{ participantId: "../voter" },
				{ participantId: "" },
				{ name: " " },
				{ name: "가".repeat(13) },
				{ name: "\u0000" },
				{ vote: "cancel" },
				{ timestamp: endedAt - 1, reactionMs: -1 },
				{ timestamp: endedAt + 0.5, reactionMs: 0.5 },
				{
					timestamp: Number.MAX_SAFE_INTEGER,
					reactionMs: Number.MAX_SAFE_INTEGER - endedAt,
				},
				{ reactionMs: -1 },
				{ reactionMs: 1 },
				{ reactionMs: undefined },
			].map((overrides) => [{ ...vote, ...overrides }]),
		];
		for (const votes of invalidLists)
			expect(
				parseRoomSnapshot(
					makeRoom({ draw: makeDraw({ votes: votes as RoomDrawVote[] }) }),
				),
			).toBeNull();
		const full = Array.from(
			{ length: lunchRoomLimits.maxMembers },
			(_, index) => ({ ...vote, participantId: `voter-${index}` }),
		);
		expect(
			parseRoomSnapshot(makeRoom({ draw: makeDraw({ votes: full }) }))?.draw
				?.votes,
		).toHaveLength(60);
	});
});

describe("explicit room nickname input", () => {
	it("normalizes width, whitespace and composed Unicode before enforcing the display limit", () => {
		expect(normalizeLunchRoomNickname(" Ａlice ")).toBe("Alice");
		expect(normalizeLunchRoomNickname("\u1100\u1161".repeat(12))).toBe(
			"가".repeat(12),
		);
		for (const value of [
			undefined,
			null,
			3,
			"",
			" ",
			"\u200b",
			"안\n녕",
			"가".repeat(13),
		])
			expect(normalizeLunchRoomNickname(value)).toBeNull();
	});

	it("accepts an explicit entry rename intent without granting a role or accepting an invalid intent type", () => {
		expect(
			client({
				type: "join",
				name: " Ａlice ",
				updateName: true,
				isHost: true,
			}),
		).toEqual({
			type: "join",
			name: "Alice",
			updateName: true,
		});
		expect(client({ type: "join", name: "Alice", updateName: false })).toEqual({
			type: "join",
			name: "Alice",
			updateName: false,
		});
		for (const updateName of [1, "true", {}, null])
			expect(client({ type: "join", name: "Alice", updateName })).toBeNull();
	});
});

describe("lunch room creation and seed candidate selection", () => {
	it("accepts all107 source restaurants for room creation, selection and a complete draw snapshot", () => {
		const candidateIds = sampleLunchPlaces.map((place) => place.id);
		expect(candidateIds).toHaveLength(107);
		expect(lunchRoomLimits.maxCandidates).toBe(candidateIds.length);
		const createInput = validateCreateRoomInput({
			title: "전체 식당",
			hostName: "방장",
			candidateIds,
		});
		expect(createInput?.candidateIds).toEqual(candidateIds);
		expect(resolveCandidateIds(candidateIds)).toEqual(sampleLunchPlaces);
		expect(client({ type: "candidates", ids: candidateIds })).toEqual({
			type: "candidates",
			ids: candidateIds,
		});
		const candidates = sampleLunchPlaces.map((place) => ({ ...place }));
		const winnerIndex = candidates.length - 1;
		const draw = makeDraw({
			candidates,
			winnerIndex,
			toRotation: 1800 - ((winnerIndex + 0.5) * 360) / candidates.length,
			probabilities: candidates.map(() => 1 / candidates.length),
		});
		const snapshot = makeRoom({ candidates, draw, history: [draw] });
		expect(parseRoomSnapshot(snapshot)).toEqual(snapshot);
		expect(server({ type: "snapshot", snapshot, serverTime: now })).toEqual({
			type: "snapshot",
			snapshot,
			serverTime: now,
		});
	});

	it("rejects unknown IDs and arrays larger than the current catalog on every candidate input boundary", () => {
		const all = sampleLunchPlaces.map((place) => place.id);
		for (const candidateIds of [
			[...all.slice(1), "unknown-restaurant"],
			[...all, all[0]],
		]) {
			expect(resolveCandidateIds(candidateIds)).toBeNull();
			expect(
				validateCreateRoomInput({
					title: "점심",
					hostName: "방장",
					candidateIds,
				}),
			).toBeNull();
			expect(client({ type: "candidates", ids: candidateIds })).toBeNull();
		}
		const candidates = sampleLunchPlaces.map((place) => ({ ...place }));
		expect(
			parseRoomSnapshot(
				makeRoom({ candidates: [...candidates, candidates[0]] }),
			),
		).toBeNull();
		expect(
			parseRoomSnapshot(
				makeRoom({
					candidates: [
						{ ...candidates[0], id: "unknown-restaurant" },
						...candidates.slice(1),
					],
				}),
			),
		).toBeNull();
	});
	it("defaults to all source restaurants and trims bounded room and host names", () => {
		expect(
			validateCreateRoomInput({ title: "  점심 방  ", hostName: " 방장 " }),
		).toEqual({
			title: "점심 방",
			hostName: "방장",
			candidateIds: sampleLunchPlaces.map((place) => place.id),
		});
	});

	it("preserves explicit candidate order and returns fresh source snapshots", () => {
		const reversed = [...ids].reverse();
		const places = resolveCandidateIds(reversed);
		expect(places?.map((place) => place.id)).toEqual(reversed);
		expect(places?.[0]).toEqual(sampleLunchPlaces[2]);
		expect(places?.[0]).not.toBe(sampleLunchPlaces[2]);
		if (places) places[0].name = "변경";
		expect(sampleLunchPlaces[2].name).not.toBe("변경");
		expect(reversed).toEqual([...ids].reverse());
	});

	it.each([
		undefined,
		null,
		{},
		[],
		[ids[0]],
		[ids[0], ids[0]],
		[ids[0], "https://example.com/menu"],
		[ids[0], { id: ids[1], name: "주입한 식당" }],
		[ids[0], null],
		Array.from(
			{ length: sampleLunchPlaces.length + 1 },
			(_, index) => ids[index % ids.length],
		),
		Object.assign(new Array(2), { 1: ids[0] }),
	])("rejects invalid or injected candidate selection %j", (value) => {
		expect(resolveCandidateIds(value)).toBeNull();
		expect(
			validateCreateRoomInput({
				title: "점심",
				hostName: "방장",
				candidateIds: value,
			}),
		).toEqual(
			value === undefined
				? {
						title: "점심",
						hostName: "방장",
						candidateIds: sampleLunchPlaces.map((place) => place.id),
					}
				: null,
		);
	});

	it.each([
		null,
		[],
		{ title: "", hostName: "방장" },
		{ title: " ", hostName: "방장" },
		{ title: "a".repeat(61), hostName: "방장" },
		{ title: "점심", hostName: "a".repeat(21) },
		{ title: "점심", hostName: 1 },
	])("rejects malformed create input %j", (value) => {
		expect(validateCreateRoomInput(value)).toBeNull();
	});

	it("accepts exact name/title limits and strips credentials and unknown fields", () => {
		expect(
			validateCreateRoomInput({
				title: "가".repeat(60),
				hostName: "나".repeat(lunchRoomLimits.maxNicknameLength),
				candidateIds: ids,
				hostToken: "secret",
				url: "https://example.com",
			}),
		).toEqual({
			title: "가".repeat(60),
			hostName: "나".repeat(lunchRoomLimits.maxNicknameLength),
			candidateIds: ids,
		});
	});

	it("accepts opaque UUID room IDs rather than URLs or path fragments", () => {
		expect(isLunchRoomId(roomId)).toBe(true);
		expect(isLunchRoomId(roomId.toUpperCase())).toBe(true);
		for (const invalid of [
			null,
			1,
			"../room",
			"https://example.com",
			`${roomId}/`,
		])
			expect(isLunchRoomId(invalid)).toBe(false);
	});
});

describe("lunch room client command parsing", () => {
	it("accepts a500-character Korean chat within4096 UTF-8 bytes and rejects oversized frames", () => {
		const message = { type: "chat", id: "chat-korean", text: "한".repeat(500) };
		const raw = JSON.stringify(message);
		expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(
			lunchRoomLimits.maxMessageBytes,
		);
		expect(parseClientMessage(raw)).toEqual(message);
		const base = { ...message, padding: "" };
		const paddingLength =
			lunchRoomLimits.maxMessageBytes -
			new TextEncoder().encode(JSON.stringify(base)).byteLength;
		const exact = JSON.stringify({
			...base,
			padding: "x".repeat(paddingLength),
		});
		expect(new TextEncoder().encode(exact).byteLength).toBe(4096);
		expect(parseClientMessage(exact)).toEqual(message);
		expect(parseClientMessage(`${exact} `)).toBeNull();
	});
	it("uses the shared12-unit limit for new inputs while preserving20-unit legacy snapshot names", () => {
		expect(lunchRoomLimits.maxNicknameLength).toBe(12);
		for (const name of ["가".repeat(12), "😀".repeat(6)]) {
			expect(client({ type: "join", name })).toEqual({ type: "join", name });
			expect(
				validateCreateRoomInput({ title: "점심", hostName: name })?.hostName,
			).toBe(name);
		}
		for (const name of ["가".repeat(13), "😀".repeat(7)]) {
			expect(client({ type: "join", name })).toBeNull();
			expect(
				validateCreateRoomInput({ title: "점심", hostName: name }),
			).toBeNull();
		}
		const name = "가".repeat(20);
		const participant = { id: "legacy-host", name, isHost: true };
		const draw = makeDraw({ participants: [participant] });
		const snapshot = makeRoom({
			participants: [participant],
			members: [
				{
					...participant,
					status: "offline",
					lastActiveAt: now,
					lastSeenAt: now,
				},
			],
			messages: [makeChat({ name })],
			draw,
			history: [draw],
		});
		expect(parseRoomSnapshot(snapshot)).toEqual(snapshot);
	});

	it("clamps only current legacy names and never cuts an emoji surrogate pair in half", () => {
		expect(clampLunchRoomNickname(`  ${"가".repeat(20)}  `)).toBe(
			"가".repeat(12),
		);
		expect(clampLunchRoomNickname(`${"가".repeat(11)}😀끝`)).toBe(
			"가".repeat(11),
		);
		expect(clampLunchRoomNickname(`${"가".repeat(10)}😀끝`)).toBe(
			`${"가".repeat(10)}😀`,
		);
		expect(clampLunchRoomNickname("   ")).toBe("");
	});
	it("accepts bounded guest reconnect proofs and strips client-supplied activity clocks and roles", () => {
		expect(
			client({
				type: "join",
				name: "손님",
				guestToken: "g".repeat(64),
				isHost: true,
			}),
		).toEqual({ type: "join", name: "손님", guestToken: "g".repeat(64) });
		expect(
			client({
				type: "activity",
				lastActiveAt: now + 999999,
				status: "online",
			}),
		).toEqual({ type: "activity" });
		for (const guestToken of [
			null,
			1,
			"short",
			"g".repeat(257),
			"../".repeat(20),
		]) {
			expect(client({ type: "join", name: "손님", guestToken })).toBeNull();
		}
	});
	it("accepts only defined command fields and trims names and plain chat text", () => {
		expect(
			client({ type: "join", name: " 방장 ", hostToken: "a".repeat(32) }),
		).toEqual({ type: "join", name: "방장", hostToken: "a".repeat(32) });
		expect(client({ type: "join", name: " 손님 ", isHost: true })).toEqual({
			type: "join",
			name: "손님",
		});
		expect(
			client({ type: "chat", id: "chat-1", text: " <b>점심</b> " }),
		).toEqual({ type: "chat", id: "chat-1", text: "<b>점심</b>" });
		expect(client({ type: "start", id: "draw-1", winnerIndex: 2 })).toEqual({
			type: "start",
			id: "draw-1",
		});
		expect(client({ type: "candidates", ids })).toEqual({
			type: "candidates",
			ids,
		});
		expect(client({ type: "ping", clientTime: now })).toEqual({
			type: "ping",
			clientTime: now,
		});
	});

	it.each([
		null,
		[],
		{},
		{ type: "winner", winnerIndex: 1 },
		{ type: "join", name: " " },
		{ type: "join", name: "a".repeat(21) },
		{ type: "join", name: "방장", hostToken: "short" },
		{ type: "join", name: "방장", hostToken: "a".repeat(257) },
		{ type: "join", name: "방장", hostToken: "../".repeat(10) },
		{ type: "join", name: "방장", hostToken: null },
		{ type: "chat", id: "../chat", text: "점심" },
		{ type: "chat", id: "x".repeat(81), text: "점심" },
		{ type: "chat", id: "chat-1", text: " " },
		{ type: "chat", id: "chat-1", text: "한".repeat(501) },
		{ type: "start", id: null },
		{ type: "candidates", ids: [ids[0], ids[0]] },
		{ type: "ping", clientTime: -1 },
		{ type: "ping", clientTime: 1.5 },
		{ type: "ping", clientTime: Number.MAX_SAFE_INTEGER },
	])("rejects malformed commands %j", (value) => {
		expect(client(value)).toBeNull();
	});

	it("bounds frames in UTF-8 bytes, accepts exactly4096 and rejects excess", () => {
		const base = { type: "ping", clientTime: 0, padding: "" };
		const raw = JSON.stringify({
			...base,
			padding: "x".repeat(4096 - JSON.stringify(base).length),
		});
		expect(new TextEncoder().encode(raw).byteLength).toBe(4096);
		expect(parseClientMessage(raw)).toEqual({ type: "ping", clientTime: 0 });
		expect(parseClientMessage(`${raw} `)).toBeNull();
		const unicode = JSON.stringify({ ...base, padding: "한".repeat(1400) });
		expect(unicode.length).toBeLessThan(4096);
		expect(parseClientMessage(unicode)).toBeNull();
	});

	it.each([
		"{",
		"null",
		"[]",
		new ArrayBuffer(8),
		undefined,
	])("handles non-text and malformed JSON without throwing: %j", (raw) => {
		expect(parseClientMessage(raw)).toBeNull();
	});
});

describe("validated room snapshots and immutable round geometry", () => {
	it("parses optional bounded presence rosters and strips private resume tokens", () => {
		const members: RoomMember[] = [
			{
				id: "host-1",
				name: "방장",
				isHost: true,
				status: "away",
				lastActiveAt: now,
				lastSeenAt: now + 1000,
			},
			{
				id: "guest-1",
				name: "손님",
				isHost: false,
				status: "online",
				lastActiveAt: now + 1000,
				lastSeenAt: now + 1000,
			},
			{
				id: "old-guest",
				name: "이전 참가자",
				isHost: false,
				status: "offline",
				lastActiveAt: now,
				lastSeenAt: now + 500,
			},
		];
		const original = makeRoom({ members });
		const parsed = parseRoomSnapshot({
			...original,
			members: members.map((member) => ({
				...member,
				guestToken: "private",
				hostTokenHash: "private",
			})),
		});
		expect(parsed).toEqual(original);
		members[0].name = "수정";
		expect(parsed?.members?.[0].name).toBe("방장");
		expect(JSON.stringify(parsed)).not.toContain("private");
		expect(parseRoomSnapshot(makeRoom())?.members).toBeUndefined();
	});

	it("rejects malformed, duplicate, excessive or multiply hosted presence rosters", () => {
		const member: RoomMember = {
			id: "host-1",
			name: "방장",
			isHost: true,
			status: "online",
			lastActiveAt: now,
			lastSeenAt: now,
		};
		for (const members of [
			null,
			{},
			[member, member],
			[{ ...member, status: "busy" }],
			[{ ...member, lastActiveAt: -1 }],
			[{ ...member, lastSeenAt: 1.5 }],
			[{ ...member, lastSeenAt: "now" }],
			[member, { ...member, id: "host-2" }],
			Array.from({ length: 61 }, (_, i) => ({
				...member,
				id: `guest-${i}`,
				isHost: false,
			})),
		]) {
			expect(
				parseRoomSnapshot(makeRoom({ members: members as RoomMember[] })),
			).toBeNull();
		}
	});
	it("copies all public fields and strips secret or injected extra properties", () => {
		const original = makeRoom({
			draw: makeDraw(),
			history: [makeDraw()],
			status: "drawing",
		});
		const parsed = parseRoomSnapshot({
			...original,
			hostToken: "private",
			participants: original.participants.map((participant) => ({
				...participant,
				hostToken: "private",
			})),
		});
		expect(parsed).toEqual(original);
		expect(JSON.stringify(parsed)).not.toContain("private");
		if (!parsed?.draw || !original.draw)
			throw new Error("Expected parsed draw");
		original.candidates[0].name = "현재 목록 수정";
		original.draw.candidates[0].name = "원본 결과 수정";
		original.messages[0].text = "원본 채팅 수정";
		expect(parsed.candidates[0].name).toBe(sampleLunchPlaces[0].name);
		expect(parsed.draw.candidates[0].name).toBe(sampleLunchPlaces[0].name);
		expect(parsed.messages[0].text).toBe("같이 점심 골라요!");
	});

	it("keeps an old full round snapshot after the current candidate list changes", () => {
		const previous = makeDraw();
		previous.candidates[0].name = "그날 표시한 식당 이름";
		const current = makeRoom({
			listVersion: 2,
			candidates: sampleLunchPlaces.slice(3, 5).map((place) => ({ ...place })),
			draw: previous,
			history: [previous],
		});
		const parsed = parseRoomSnapshot(current);
		expect(parsed?.draw?.listVersion).toBe(1);
		expect(parsed?.draw?.candidates[0].name).toBe("그날 표시한 식당 이름");
		expect(parsed?.draw?.candidates[0].id).not.toBe(parsed?.candidates[0].id);
		expect(parsed?.history[0]).toEqual(previous);
	});

	it("accepts every winner with the same canonical pointer alignment through the full catalog size", () => {
		for (let count = 2; count <= sampleLunchPlaces.length; count += 1) {
			for (let index = 0; index < count; index += 1) {
				const toRotation = 1440 + 360 - ((index + 0.5) * 360) / count;
				const draw = makeDraw({
					candidates: sampleLunchPlaces.slice(0, count),
					winnerIndex: index,
					toRotation,
				});
				const parsed = parseRoomSnapshot(makeRoom({ draw, status: "drawing" }));
				expect(parsed?.draw?.winnerIndex).toBe(index);
				const angleAtPointer = (360 - (toRotation % 360)) % 360;
				expect(Math.floor(angleAtPointer / (360 / count))).toBe(index);
			}
		}
	});

	it.each([
		"quantum",
		"atmospheric",
		"csprng",
		"mixed",
	] as const)("accepts the actual entropy source %s", (source) => {
		expect(
			parseRoomSnapshot(makeRoom({ draw: makeDraw({ source }) }))?.draw?.source,
		).toBe(source);
	});

	it("allows past chats after a participant leaves and a disconnected host", () => {
		const snapshot = makeRoom({ participants: [], messages: [makeChat()] });
		expect(parseRoomSnapshot(snapshot)).toEqual(snapshot);
	});

	it.each([
		["roomId", "../invalid"],
		["title", "a".repeat(61)],
		["createdAt", -1],
		["createdAt", 1.25],
		["expiresAt", now],
		["expiresAt", now + lunchRoomLimits.ttlMs + 1],
		["listVersion", 0],
		["listVersion", Number.POSITIVE_INFINITY],
		["candidates", []],
		["candidates", [sampleLunchPlaces[0], sampleLunchPlaces[0]]],
		[
			"candidates",
			[{ ...sampleLunchPlaces[0], id: "unknown" }, sampleLunchPlaces[1]],
		],
		[
			"candidates",
			[{ ...sampleLunchPlaces[0], category: "unknown" }, sampleLunchPlaces[1]],
		],
		[
			"candidates",
			[{ ...sampleLunchPlaces[0], menu: 1 }, sampleLunchPlaces[1]],
		],
		[
			"candidates",
			[{ ...sampleLunchPlaces[0], distanceMeters: -1 }, sampleLunchPlaces[1]],
		],
		["participants", [{ id: "host-1", name: "방장", isHost: "true" }]],
		["participants", [{ id: "host-1", name: " ", isHost: true }]],
		[
			"participants",
			[
				{ id: "x", name: "A", isHost: true },
				{ id: "y", name: "B", isHost: true },
			],
		],
		["messages", [{ ...makeChat(), text: "a".repeat(501) }]],
		["messages", [{ ...makeChat(), timestamp: Number.NaN }]],
		["messages", [makeChat(), makeChat()]],
		["draw", undefined],
		["status", "drawing"],
		["status", "ready"],
		["history", [makeDraw(), makeDraw()]],
	])("rejects malformed snapshot field %s", (key, value) => {
		expect(
			parseRoomSnapshot({ ...makeRoom(), [key as string]: value }),
		).toBeNull();
	});

	it.each([
		{ winnerIndex: -1 },
		{ winnerIndex: 3 },
		{ winnerIndex: 0.5 },
		{ source: "math-random" },
		{ fromRotation: 360 },
		{ toRotation: 2100 },
		{ toRotation: Number.NaN },
		{ durationMs: 7000 },
		{ startedAt: now + 499 },
		{ listVersion: 2 },
		{ candidates: [sampleLunchPlaces[0]] },
	])("rejects inconsistent or untrusted draw %j", (override) => {
		expect(
			parseRoomSnapshot({
				...makeRoom(),
				draw: { ...makeDraw(), ...override },
			}),
		).toBeNull();
	});

	it("enforces collection caps without silently dropping participants or results", () => {
		const participants = Array.from({ length: 30 }, (_, index) => ({
			id: `guest-${index}`,
			name: "참가자",
			isHost: false,
		}));
		const messages = Array.from({ length: 100 }, (_, index) =>
			makeChat({ id: `chat-${index}` }),
		);
		const history = Array.from({ length: 20 }, (_, index) =>
			makeDraw({ id: `draw-${index}` }),
		);
		expect(
			parseRoomSnapshot(makeRoom({ participants, messages, history })),
		).not.toBeNull();
		for (const [key, list, extra] of [
			["participants", participants, { ...participants[0], id: "extra" }],
			["messages", messages, makeChat({ id: "extra" })],
			["history", history, makeDraw({ id: "extra" })],
		] as const) {
			expect(
				parseRoomSnapshot({ ...makeRoom(), [key]: [...list, extra] }),
			).toBeNull();
		}
	});
});

describe("draw-time history metadata", () => {
	it("round-trips original request time, participants and ordered probabilities in current and past draws", () => {
		const participants = [
			{ id: "host-then", name: "그때 방장", isHost: true },
			{ id: "guest-then", name: "그때 참가자", isHost: false },
		];
		const probabilities = [1 / 3, 1 / 3, 1 / 3];
		const draw = makeDraw({ participants, probabilities, requestedAt: now });
		const snapshot = makeRoom({
			participants: [{ id: "new-guest", name: "나중 참가자", isHost: false }],
			draw,
			history: [draw],
		});
		const parsed = parseRoomSnapshot(snapshot);
		expect(parsed?.draw).toEqual(draw);
		expect(parsed?.history[0]).toEqual(draw);
		expect(parsed?.draw?.participants).not.toBe(participants);
		expect(parsed?.history[0].participants?.[0]).not.toBe(participants[0]);
		expect(parsed?.draw?.probabilities).not.toBe(probabilities);
		participants[0].name = "이름 변경";
		probabilities[0] = 1;
		snapshot.participants[0].name = "현재 이름 변경";
		expect(parsed?.draw?.participants?.[0].name).toBe("그때 방장");
		expect(parsed?.history[0].participants?.[0].name).toBe("그때 방장");
		expect(parsed?.draw?.probabilities).toEqual([1 / 3, 1 / 3, 1 / 3]);
		expect(parsed?.draw?.requestedAt).toBe(now);
	});

	it("keeps legacy metadata absent instead of filling in current participants or times", () => {
		const draw = makeDraw();
		const snapshot = makeRoom({ draw, history: [draw] });
		const parsed = parseRoomSnapshot(snapshot);
		expect(parsed?.draw).toEqual(draw);
		expect(parsed?.participants).toHaveLength(2);
		for (const entry of [parsed?.draw, parsed?.history[0]]) {
			expect(entry).not.toHaveProperty("participants");
			expect(entry).not.toHaveProperty("requestedAt");
			expect(entry).not.toHaveProperty("probabilities");
		}
	});

	it.each([
		{ participants: [] },
		{ requestedAt: now + 500 },
		{ probabilities: [1 / 3, 1 / 3, 1 / 3] },
	])("accepts metadata fields independently: %j", (metadata) => {
		const draw = makeDraw(metadata);
		expect(parseRoomSnapshot(makeRoom({ draw }))?.draw).toEqual(draw);
	});

	it("accepts all current uniform vectors despite floating-point sum rounding", () => {
		for (let count = 2; count <= sampleLunchPlaces.length; count += 1) {
			const probabilities = Array.from({ length: count }, () => 1 / count);
			const draw = makeDraw({
				candidates: sampleLunchPlaces.slice(0, count),
				toRotation: 1800 - 180 / count,
				probabilities,
			});
			expect(
				parseRoomSnapshot(makeRoom({ draw }))?.draw?.probabilities,
			).toEqual(probabilities);
		}
	});

	it.each([
		{ requestedAt: null },
		{ requestedAt: "1800000000000" },
		{ requestedAt: -1 },
		{ requestedAt: now + 0.5 },
		{ requestedAt: now + 501 },
		{ participants: null },
		{ participants: [null] },
		{ participants: [{ id: "guest", name: " ", isHost: false }] },
		{ participants: [{ id: "guest", name: "가".repeat(21), isHost: false }] },
		{ participants: [{ id: "guest", name: "참가자", isHost: "false" }] },
		{ participants: [{ id: "../guest", name: "참가자", isHost: false }] },
		{
			participants: [
				{ id: "guest", name: "A", isHost: false },
				{ id: "guest", name: "B", isHost: false },
			],
		},
		{
			participants: [
				{ id: "host-a", name: "A", isHost: true },
				{ id: "host-b", name: "B", isHost: true },
			],
		},
		{
			participants: Array.from({ length: 31 }, (_, index) => ({
				id: `guest-${index}`,
				name: "참가자",
				isHost: false,
			})),
		},
		{ probabilities: null },
		{ probabilities: [] },
		{ probabilities: [0.5, 0.5] },
		{ probabilities: [0.25, 0.25, 0.25, 0.25] },
		{ probabilities: [0.5, 0.25, 0.25] },
		{ probabilities: [0, 0, 0] },
		{ probabilities: [-1, 1, 1] },
		{ probabilities: [1.1, -0.1, 0] },
		{ probabilities: [Number.NaN, 1 / 3, 1 / 3] },
		{ probabilities: [Number.POSITIVE_INFINITY, 1 / 3, 1 / 3] },
		{ probabilities: ["0.3333333333333333", 1 / 3, 1 / 3] },
		{ probabilities: new Array(3) },
	])("rejects malformed metadata in either current or saved history: %j", (metadata) => {
		const draw = { ...makeDraw(), ...metadata };
		expect(parseRoomSnapshot({ ...makeRoom(), draw })).toBeNull();
		expect(parseRoomSnapshot({ ...makeRoom(), history: [draw] })).toBeNull();
	});
});

describe("server-generated system chat events", () => {
	it.each([
		"joined",
		"left",
		"renamed",
		"draw-started",
		"draw-finished",
		"draw-failed",
	] as const)("preserves the %s event through the public snapshot wire", (event) => {
		const message = makeChat({
			id: "901f562e-ebcf-4504-bf32-ac628207e5cd",
			participantId: "system",
			name: "시스템",
			text: "참가자가 입장했습니다.",
			event,
		});
		const parsed = server({
			type: "snapshot",
			snapshot: makeRoom({ messages: [message] }),
			serverTime: now,
		});
		expect(parsed?.type).toBe("snapshot");
		if (parsed?.type !== "snapshot") throw new Error("Expected snapshot");
		expect(parsed.snapshot.messages).toEqual([message]);
	});

	it("keeps ordinary legacy user messages unchanged and strips forged client system fields", () => {
		const message = makeChat();
		expect(
			parseRoomSnapshot(makeRoom({ messages: [message] }))?.messages,
		).toEqual([message]);
		expect(
			client({
				type: "chat",
				id: "forged-message",
				text: "시스템인 척하는 메시지",
				event: "draw-finished",
				name: "시스템",
				participantId: "system",
				timestamp: now,
			}),
		).toEqual({
			type: "chat",
			id: "forged-message",
			text: "시스템인 척하는 메시지",
		});
	});

	it.each([
		{ event: "unknown" },
		{ event: null },
		{ event: 1 },
		{ participantId: "guest-1" },
		{ name: "참가자" },
		{ id: "not-a-uuid" },
		{ text: "가".repeat(501) },
	])("rejects malformed system events: %j", (override) => {
		const message = {
			...makeChat(),
			id: "901f562e-ebcf-4504-bf32-ac628207e5cd",
			participantId: "system",
			name: "시스템",
			event: "joined",
			...override,
		};
		expect(
			parseRoomSnapshot({ ...makeRoom(), messages: [message] }),
		).toBeNull();
	});
});

describe("lunch room server wire parsing", () => {
	it("reads snapshots with optional private self identity and no shared host credentials", () => {
		const snapshot = makeRoom();
		expect(server({ type: "snapshot", snapshot, serverTime: now })).toEqual({
			type: "snapshot",
			snapshot,
			serverTime: now,
		});
		expect(
			server({
				type: "snapshot",
				snapshot,
				serverTime: now,
				self: { id: "host-1", isHost: true, hostToken: "private" },
			}),
		).toEqual({
			type: "snapshot",
			snapshot,
			serverTime: now,
			self: { id: "host-1", isHost: true },
		});
	});

	it("accepts bounded errors and clock replies", () => {
		expect(
			server({
				type: "error",
				code: "FORBIDDEN",
				message: "방장만 시작할 수 있어요.",
				requestId: "draw-1",
			}),
		).toEqual({
			type: "error",
			code: "FORBIDDEN",
			message: "방장만 시작할 수 있어요.",
			requestId: "draw-1",
		});
		expect(server({ type: "pong", clientTime: 0, serverTime: now })).toEqual({
			type: "pong",
			clientTime: 0,
			serverTime: now,
		});
	});

	it.each([
		{ type: "snapshot", snapshot: makeRoom(), serverTime: "now" },
		{ type: "snapshot", snapshot: makeRoom(), serverTime: now, self: null },
		{
			type: "snapshot",
			snapshot: makeRoom(),
			serverTime: now,
			self: { id: "../guest", isHost: false },
		},
		{
			type: "snapshot",
			snapshot: makeRoom(),
			serverTime: now,
			self: { id: "guest", isHost: 1 },
		},
		{ type: "error", code: "", message: "오류" },
		{ type: "error", code: "ERROR", message: "x".repeat(301) },
		{ type: "error", code: "ERROR", message: "오류", requestId: 1 },
		{ type: "pong", clientTime: -1, serverTime: now },
		{ type: "pong", clientTime: now, serverTime: Number.MAX_SAFE_INTEGER },
		{ type: "winner", winnerIndex: 1 },
	])("rejects malformed server message %j", (value) => {
		expect(server(value)).toBeNull();
	});

	it("fits full-catalog history with30 participants and probabilities plus100 long Korean chats", () => {
		const candidates = sampleLunchPlaces.map((place) => ({ ...place }));
		const participants = Array.from({ length: 30 }, (_, index) => ({
			id: `guest-${index}-${"x".repeat(60)}`,
			name: "가".repeat(20),
			isHost: index === 0,
		}));
		const draw = makeDraw({
			candidates,
			toRotation: 1800 - 180 / candidates.length,
			participants,
			requestedAt: now,
			probabilities: candidates.map(() => 1 / candidates.length),
			votes: Array.from({ length: lunchRoomLimits.maxMembers }, (_, index) => ({
				participantId: `voter-${index}-${"x".repeat(60)}`,
				name: "가".repeat(12),
				vote: "up",
				timestamp: now + 8200,
				reactionMs: 0,
			})),
		});
		const snapshot = makeRoom({
			candidates,
			participants,
			members: Array.from(
				{ length: lunchRoomLimits.maxMembers },
				(_, index) => ({
					...(participants[index] ?? {
						id: `offline-${index}-${"x".repeat(60)}`,
						name: "가".repeat(20),
						isHost: false,
					}),
					status:
						index < participants.length
							? ("online" as const)
							: ("offline" as const),
					lastActiveAt: now,
					lastSeenAt: now,
				}),
			),
			draw,
			history: Array.from({ length: 20 }, (_, index) => ({
				...draw,
				id: `draw-${index}`,
			})),
			messages: Array.from({ length: 100 }, (_, index) =>
				makeChat({ id: `chat-${index}`, text: "한".repeat(500) }),
			),
		});
		const raw = JSON.stringify({ type: "snapshot", snapshot, serverTime: now });
		expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(
			lunchRoomLimits.maxServerMessageBytes,
		);
		expect(parseServerMessage(raw)).not.toBeNull();
	});

	it.each([
		"{",
		"null",
		"[]",
		undefined,
		new ArrayBuffer(8),
	])("handles bad server frames without throwing: %j", (raw) => {
		expect(parseServerMessage(raw)).toBeNull();
	});

	it("accepts a full valid server history even when user text requires six-byte JSON escapes", () => {
		const participants = Array.from(
			{ length: lunchRoomLimits.maxParticipants },
			(_, index) => ({
				id: `guest-${index}-${"x".repeat(60)}`,
				name: "\u0000".repeat(20),
				isHost: index === 0,
			}),
		);
		const candidates = sampleLunchPlaces.map((place) => ({ ...place }));
		const draw = makeDraw({
			candidates,
			toRotation: 1800 - 180 / candidates.length,
			participants,
			requestedAt: now,
			probabilities: candidates.map(() => 1 / candidates.length),
			votes: Array.from({ length: lunchRoomLimits.maxMembers }, (_, index) => ({
				participantId: `voter-${index}-${"x".repeat(60)}`,
				name: "\uDC00".repeat(12),
				vote: "down",
				timestamp: now + 8200,
				reactionMs: 0,
			})),
		});
		const snapshot = makeRoom({
			candidates,
			participants,
			members: Array.from(
				{ length: lunchRoomLimits.maxMembers },
				(_, index) => ({
					...(participants[index] ?? {
						id: `offline-${index}-${"x".repeat(60)}`,
						name: "\u0000".repeat(20),
						isHost: false,
					}),
					status:
						index < participants.length
							? ("online" as const)
							: ("offline" as const),
					lastActiveAt: now,
					lastSeenAt: now,
				}),
			),
			draw,
			history: Array.from(
				{ length: lunchRoomLimits.maxHistory },
				(_, index) => ({ ...draw, id: `draw-${index}` }),
			),
			messages: Array.from(
				{ length: lunchRoomLimits.maxMessages },
				(_, index) => ({
					...makeChat({ id: `chat-${index}`, text: "\u0000".repeat(500) }),
					name: "\u0000".repeat(20),
				}),
			),
		});
		const raw = JSON.stringify({ type: "snapshot", snapshot, serverTime: now });
		expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(
			512 * 1024,
		);
		expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(
			lunchRoomLimits.maxServerMessageBytes,
		);
		expect(parseServerMessage(raw)).not.toBeNull();
	});

	it("rejects oversized server frames before parsing", () => {
		const raw = JSON.stringify({
			type: "pong",
			clientTime: 0,
			serverTime: now,
			padding: "x".repeat(lunchRoomLimits.maxServerMessageBytes),
		});
		expect(parseServerMessage(raw)).toBeNull();
	});
});
