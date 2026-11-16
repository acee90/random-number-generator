import { describe, expect, it } from "vitest";
import { sampleLunchPlaces } from "../src/lib/lunch";
import {
	type ChatMessage,
	clampLunchRoomNickname,
	getEligibleRoomCandidates,
	getRoomPhase,
	isLunchRoomId,
	isRoomDrawVoter,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	parseClientMessage,
	parseRoomSnapshot,
	parseServerMessage,
	type RoomCandidate,
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

describe("current draw voter eligibility", () => {
	it("allows the host and guests captured at draw start, but not absent or unknown identities", () => {
		const draw = makeDraw({
			participants: [
				{ id: "host-1", name: "방장", isHost: true },
				{ id: "guest-1", name: "참가자", isHost: false },
			],
		});
		expect(isRoomDrawVoter(draw, "host-1")).toBe(true);
		expect(isRoomDrawVoter(draw, "guest-1")).toBe(true);
		expect(isRoomDrawVoter(draw, "late-guest")).toBe(false);
		expect(isRoomDrawVoter(draw)).toBe(false);
		expect(
			isRoomDrawVoter({ ...draw, participants: undefined }, "host-1"),
		).toBe(false);
	});
});

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
		revision: overrides.listVersion ?? 1,
		intakeId: null,
		excludeDrawn: false,
		excludedIds: [],
		candidates: sampleLunchPlaces.slice(0, 3).map((place) => ({ ...place })),
		participants: [
			{ id: "host-1", name: "방장", isHost: true },
			{ id: "guest-1", name: "참가자", isHost: false },
		],
		messages: [makeChat()],
		draw: null,
		history: [],
		status: overrides.draw ? "result" : "waiting",
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
		expect(lunchRoomLimits.maxCandidates).toBeGreaterThanOrEqual(
			candidateIds.length,
		);
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

	it("keeps catalog selection strict while allowing stable custom IDs in room snapshots", () => {
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
		const custom = makeRoom({
			candidates: [
				{ ...candidates[0], id: "custom-restaurant" },
				...candidates.slice(1),
			],
		});
		expect(parseRoomSnapshot(custom)?.candidates).toEqual(custom.candidates);
	});
	it("starts empty and trims bounded room and host names", () => {
		expect(
			validateCreateRoomInput({ title: "  점심 방  ", hostName: " 방장 " }),
		).toEqual({
			title: "점심 방",
			hostName: "방장",
			candidateIds: [],
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
			value === undefined || (Array.isArray(value) && value.length <= 1)
				? {
						title: "점심",
						hostName: "방장",
						candidateIds: value ?? [],
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
		["candidates", [sampleLunchPlaces[0], sampleLunchPlaces[0]]],
		[
			"candidates",
			[{ ...sampleLunchPlaces[0], id: "../unsafe" }, sampleLunchPlaces[1]],
		],
		[
			"candidates",
			[
				{ ...sampleLunchPlaces[0], category: "a".repeat(25) },
				sampleLunchPlaces[1],
			],
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

describe("room lifecycle and candidate protocol", () => {
	const custom: RoomCandidate = {
		id: "custom-noodles",
		name: "우동",
		category: "확인 불가",
		included: true,
		ownerId: "guest-1",
		ownerName: "참가자",
	};

	it("parses identified intake, recommendation, edit, option and reset commands without client role fields", () => {
		for (const command of [
			{
				type: "intake",
				id: "edit-stage-1",
				action: "edit",
				expectedRevision: 1,
			},
			{ type: "intake", id: "open-1", action: "open", expectedRevision: 1 },
			{ type: "intake", id: "close-1", action: "close", expectedRevision: 2 },
			{
				type: "intake",
				id: "finalize-1",
				action: "finalize",
				expectedRevision: 3,
			},
			{
				type: "recommend",
				id: "recommend-1",
				name: "우동",
				intakeId: "intake-1",
			},
			{
				type: "remove-candidate",
				id: "remove-1",
				candidateId: "custom-noodles",
				intakeId: "intake-1",
			},
			{
				type: "room-edit",
				id: "edit-title-1",
				baseListVersion: 1,
				title: "다음 점심",
			},
			{
				type: "room-edit",
				id: "edit-candidates-1",
				baseListVersion: 1,
				candidates: [],
			},
			{
				type: "options",
				id: "option-1",
				expectedRevision: 3,
				excludeDrawn: true,
			},
			{ type: "reset-exclusions", id: "reset-1", expectedRevision: 4 },
			{ type: "start", id: "start-1", expectedRevision: 5, confirmReset: true },
		]) {
			expect(
				client({
					...command,
					isHost: true,
					participantId: "forged",
					winnerIndex: 1,
				}),
			).toEqual(command);
		}
		expect(
			client({
				type: "recommend",
				id: "recommend-trim",
				name: " 우동 ",
				intakeId: "intake-1",
			}),
		).toEqual({
			type: "recommend",
			id: "recommend-trim",
			name: "우동",
			intakeId: "intake-1",
		});
	});

	it.each([
		{ type: "intake", id: "open-1", action: "reopen", expectedRevision: 1 },
		{ type: "intake", id: "open-1", action: "open" },
		{ type: "intake", id: "open-1", action: "open", expectedRevision: 0 },
		{ type: "recommend", id: "recommend-1", name: "우동" },
		{ type: "recommend", id: "recommend-1", name: " ", intakeId: "intake-1" },
		{
			type: "recommend",
			id: "recommend-1",
			name: "한".repeat(81),
			intakeId: "intake-1",
		},
		{
			type: "recommend",
			id: "recommend-1",
			name: "우동",
			intakeId: "../intake",
		},
		{
			type: "remove-candidate",
			id: "remove-1",
			candidateId: "../candidate",
			intakeId: "intake-1",
		},
		{ type: "room-edit", id: "edit-1", baseListVersion: 1 },
		{ type: "room-edit", id: "edit-1", baseListVersion: 0, title: "제목" },
		{
			type: "room-edit",
			id: "edit-1",
			baseListVersion: 1,
			candidates: [custom, custom],
		},
		{
			type: "options",
			id: "option-1",
			expectedRevision: 1,
			excludeDrawn: "true",
		},
		{ type: "reset-exclusions", id: "reset-1" },
		{ type: "start", id: "start-1", expectedRevision: -1 },
		{ type: "start", id: "start-1", confirmReset: "yes" },
	])("rejects malformed or unversioned lifecycle commands %j", (command) => {
		expect(client(command)).toBeNull();
	});

	it("accepts full candidate edits beyond the ordinary frame limit without relaxing chat limits", () => {
		const candidates = Array.from(
			{ length: lunchRoomLimits.maxCandidates },
			(_, index) => ({
				id: `custom-${index}`,
				name: "한".repeat(80),
				category: "확인 불가",
				included: true,
			}),
		);
		const edit = {
			type: "room-edit",
			id: "edit-full",
			baseListVersion: 1,
			candidates,
		};
		const raw = JSON.stringify(edit);
		expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(
			lunchRoomLimits.maxMessageBytes,
		);
		expect(parseClientMessage(raw)).toEqual(edit);
		expect(
			client({
				type: "chat",
				id: "oversized-chat",
				text: "점심",
				padding: "x".repeat(lunchRoomLimits.maxMessageBytes),
			}),
		).toBeNull();
		expect(
			parseClientMessage(
				JSON.stringify({ ...edit, padding: "x".repeat(512 * 1024) }),
			),
		).toBeNull();
	});

	it("keeps candidate identity, ownership and manual inclusion across parsing and filters automatic exclusions separately", () => {
		const snapshot = makeRoom({
			status: "collecting",
			revision: 8,
			intakeId: "intake-2",
			excludeDrawn: true,
			excludedIds: ["custom-noodles"],
			candidates: [
				custom,
				{ ...sampleLunchPlaces[0], included: false },
				sampleLunchPlaces[1],
			],
		});
		const parsed = parseRoomSnapshot(snapshot);
		expect(parsed).toEqual(snapshot);
		expect(parsed?.candidates[0]).not.toBe(custom);
		expect(
			getEligibleRoomCandidates(snapshot).map((candidate) => candidate.id),
		).toEqual([sampleLunchPlaces[1].id]);
		expect(
			getEligibleRoomCandidates({ ...snapshot, excludeDrawn: false }).map(
				(candidate) => candidate.id,
			),
		).toEqual([custom.id, sampleLunchPlaces[1].id]);
	});

	it("accepts zero candidates while preparing and a canonical single-candidate draw", () => {
		expect(parseRoomSnapshot(makeRoom({ candidates: [] }))?.candidates).toEqual(
			[],
		);
		const single = makeDraw({
			candidates: [custom],
			winnerIndex: 0,
			toRotation: 1620,
			probabilities: [1],
		});
		expect(
			parseRoomSnapshot(
				makeRoom({ candidates: [custom], status: "drawing", draw: single }),
			)?.draw,
		).toEqual(single);
		for (const phase of [
			"waiting",
			"editing",
			"collecting",
			"reviewing",
			"fetching",
			"result",
			"closed",
		] as const) {
			const snapshot = makeRoom({
				status: phase,
				...(["collecting", "reviewing"].includes(phase)
					? { intakeId: "intake-1" }
					: {}),
				...(phase === "result" ? { draw: single } : {}),
			});
			expect(parseRoomSnapshot(snapshot)).not.toBeNull();
		}
	});

	it("parses editing as a shared stage with no intake session or draw", () => {
		const editing = makeRoom({ status: "editing", intakeId: null });
		expect(parseRoomSnapshot(editing)?.status).toBe("editing");
		expect(parseRoomSnapshot(editing)?.intakeId).toBeNull();
		expect(getRoomPhase(editing)).toBe("editing");
		expect(parseRoomSnapshot({ ...editing, draw: makeDraw() })).toBeNull();
		expect(parseRoomSnapshot({ ...editing, status: "collecting" })).toBeNull();
	});

	it("recognizes an old waiting snapshot with a current result without assigning new historical metadata", () => {
		const old = makeRoom({ status: "waiting", draw: makeDraw() });
		delete old.revision;
		delete old.intakeId;
		delete old.excludeDrawn;
		delete old.excludedIds;
		expect(getRoomPhase(old)).toBe("result");
		expect(getRoomPhase(makeRoom())).toBe("waiting");
		expect(parseRoomSnapshot(old)?.draw).toEqual(old.draw);
		expect(parseRoomSnapshot(old)?.draw).not.toHaveProperty("excludeDrawn");
	});

	it.each([
		{ revision: 0 },
		{ excludeDrawn: "true" },
		{ excludedIds: [custom.id, custom.id] },
		{ excludedIds: ["../unsafe"] },
		{ intakeId: "../intake" },
		{ candidates: [{ ...custom, ownerId: "../owner" }] },
		{ candidates: [{ ...custom, included: "true" }] },
		{ candidates: [{ ...custom, name: "\uD800" }] },
		{ candidates: [{ ...custom, name: "우동\u0000" }] },
		{ candidates: [{ ...custom, menu: "메뉴\u0000" }] },
		{ candidates: [{ ...custom, menu: "\uD800" }] },
	])("rejects malformed lifecycle state %j", (override) => {
		expect(parseRoomSnapshot({ ...makeRoom(), ...override })).toBeNull();
	});

	it("parses success acknowledgements using an opaque request ID", () => {
		expect(server({ type: "ack", requestId: "edit-1", role: "host" })).toEqual({
			type: "ack",
			requestId: "edit-1",
		});
		for (const requestId of [undefined, "../request", "", 1]) {
			expect(server({ type: "ack", requestId })).toBeNull();
		}
	});
});

describe("candidate setup and independent game filters", () => {
	it("accepts empty creation and one explicitly selected source without silently seeding", () => {
		for (const candidateIds of [undefined, [], [ids[0]]]) {
			expect(
				validateCreateRoomInput({
					title: "빈 방",
					hostName: "방장",
					candidateIds,
				}),
			).toEqual({
				title: "빈 방",
				hostName: "방장",
				candidateIds: candidateIds ?? [],
			});
		}
		expect(resolveCandidateIds([], 0)).toEqual([]);
		expect(resolveCandidateIds([ids[0]], 0)).toEqual([sampleLunchPlaces[0]]);
		expect(
			parseRoomSnapshot(makeRoom({ status: "editing", candidates: [] }))
				?.candidates,
		).toEqual([]);
	});

	it("normalizes optional custom classifications in edits, recommendations and round snapshots", () => {
		for (const [value, expected] of [
			["  우리 팀 메뉴  ", "우리 팀 메뉴"],
			["", "미분류"],
			[undefined, "미분류"],
		] as const) {
			const item = {
				id: "custom-1",
				name: "커스텀",
				...(value === undefined ? {} : { category: value }),
			};
			expect(
				client({
					type: "room-edit",
					id: "edit-custom",
					baseListVersion: 1,
					candidates: [item],
				}),
			).toMatchObject({ candidates: [{ category: expected }] });
			expect(
				client({
					type: "recommend",
					id: "recommend-custom",
					intakeId: "intake-1",
					name: "커스텀",
					...(value === undefined ? {} : { category: value }),
				}),
			).toMatchObject(
				value === undefined ? { name: "커스텀" } : { category: expected },
			);
			const draw = makeDraw({
				candidates: [{ ...sampleLunchPlaces[0], category: expected }],
				winnerIndex: 0,
				toRotation: 1620,
			});
			expect(
				parseRoomSnapshot(
					makeRoom({ draw, history: [{ ...draw, id: "old-draw" }] }),
				)?.history[0].candidates[0].category,
			).toBe(expected);
		}
		for (const category of [
			null,
			1,
			"a".repeat(25),
			"제어\u0000",
			"숨김\u200b",
			"\ud800",
		]) {
			expect(
				client({
					type: "room-edit",
					id: "bad-category",
					baseListVersion: 1,
					candidates: [{ id: "custom-1", name: "커스텀", category }],
				}),
			).toBeNull();
			expect(
				client({
					type: "recommend",
					id: "bad-category",
					intakeId: "intake-1",
					name: "커스텀",
					category,
				}),
			).toBeNull();
		}
	});

	it("validates identified filters and handles the full legal classification payload", () => {
		const filter = {
			categories: [" 우리 팀 메뉴 ", ""],
			excludedIds: [ids[0]],
		};
		expect(
			client({
				type: "game-filter",
				id: "filter-1",
				expectedRevision: 1,
				filter,
			}),
		).toEqual({
			type: "game-filter",
			id: "filter-1",
			expectedRevision: 1,
			filter: { categories: ["우리 팀 메뉴", "미분류"], excludedIds: [ids[0]] },
		});
		for (const invalid of [
			null,
			{ categories: null },
			{ categories: ["한식", " 한식 "], excludedIds: [] },
			{ categories: ["x".repeat(25)], excludedIds: [] },
			{ categories: null, excludedIds: ["../unsafe"] },
			{ categories: null, excludedIds: [ids[0], ids[0]] },
		])
			expect(
				client({
					type: "game-filter",
					id: "filter-bad",
					expectedRevision: 1,
					filter: invalid,
				}),
			).toBeNull();
		const many = {
			type: "game-filter",
			id: "filter-many",
			expectedRevision: 1,
			filter: {
				categories: Array.from(
					{ length: 200 },
					(_, index) => `${index}-${"한".repeat(20)}`,
				),
				excludedIds: [],
			},
		};
		expect(
			new TextEncoder().encode(JSON.stringify(many)).byteLength,
		).toBeGreaterThan(lunchRoomLimits.maxMessageBytes);
		expect(client(many)).not.toBeNull();
	});

	it("combines group, individual, legacy and drawn exclusions without mutating the list", () => {
		const candidates: RoomCandidate[] = [
			{ id: "a", name: "A", category: "한식" },
			{ id: "b", name: "B", category: "한식" },
			{ id: "c", name: "C", category: "한식", included: false },
			{ id: "d", name: "D", category: "양식" },
		];
		const snapshot = makeRoom({
			candidates,
			gameFilter: { categories: ["한식"], excludedIds: ["b"] },
			excludeDrawn: true,
			excludedIds: ["a"],
		});
		const before = structuredClone(snapshot);
		expect(getEligibleRoomCandidates(snapshot)).toEqual([]);
		expect(
			getEligibleRoomCandidates({ ...snapshot, excludeDrawn: false }).map(
				(item) => item.id,
			),
		).toEqual(["a"]);
		expect(
			getEligibleRoomCandidates({
				...snapshot,
				gameFilter: { categories: null, excludedIds: [] },
				excludeDrawn: false,
			}).map((item) => item.id),
		).toEqual(["a", "b", "d"]);
		expect(snapshot).toEqual(before);
		expect(parseRoomSnapshot(snapshot)?.gameFilter).toEqual(
			snapshot.gameFilter,
		);
		expect(
			parseRoomSnapshot({
				...snapshot,
				gameFilter: { categories: null, excludedIds: ["missing"] },
			}),
		).toBeNull();
	});
});

describe("custom candidate snapshot capacity", () => {
	it("fits the supported full custom list and twenty complete immutable rounds within the server frame limit", () => {
		const candidates: RoomCandidate[] = Array.from(
			{ length: lunchRoomLimits.maxCandidates },
			(_, index) => ({
				id: `candidate-${index}-${"x".repeat(60)}`,
				name: "한".repeat(80),
				category: "확인 불가",
				menu: "식".repeat(200),
				included: true,
				ownerId: `owner-${index}-${"x".repeat(60)}`,
				ownerName: "참".repeat(12),
			}),
		);
		const participants = Array.from(
			{ length: lunchRoomLimits.maxParticipants },
			(_, index) => ({
				id: `guest-${index}`,
				name: "참가자",
				isHost: index === 0,
			}),
		);
		const draw = makeDraw({
			candidates,
			participants,
			probabilities: candidates.map(() => 1 / candidates.length),
			toRotation: 1800 - 180 / candidates.length,
		});
		const snapshot = makeRoom({
			candidates,
			participants,
			draw,
			history: Array.from(
				{ length: lunchRoomLimits.maxHistory },
				(_, index) => ({ ...draw, id: `history-${index}` }),
			),
			messages: Array.from(
				{ length: lunchRoomLimits.maxMessages },
				(_, index) =>
					makeChat({ id: `chat-${index}`, text: "\u0000".repeat(500) }),
			),
		});
		const raw = JSON.stringify({ type: "snapshot", snapshot, serverTime: now });
		expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(
			lunchRoomLimits.maxServerMessageBytes,
		);
		expect(parseServerMessage(raw)).not.toBeNull();
	});
});
