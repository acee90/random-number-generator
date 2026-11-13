#!/usr/bin/env node
// Creates one disposable room; never accepts an existing room ID or credentials.
// Run: node scripts/release-room-check.mjs --origin https://jeommechu.dev
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

const defaults = {
	origin: "https://jeommechu.dev",
	timeoutMs: 20_000,
	drawTimeoutMs: 45_000,
	runTimeoutMs: 180_000,
};
const initialCandidates = [
	"seonjeongneung-01",
	"seonjeongneung-02",
	"seonjeongneung-03",
];
const nextCandidates = ["seonjeongneung-03", "seonjeongneung-05"];
const hostName = "릴리즈방장";
const guestName = "QA Mate";
const lateName = "늦은참가자";
const uuid = () => crypto.randomUUID();
const emit = (event, values = {}) =>
	console.log(JSON.stringify({ event, ...values }));
const fault = (code) => Object.assign(new Error(code), { publicCode: code });
function ensure(condition, code) {
	if (!condition) throw fault(code);
}
function safeCode(error) {
	return typeof error?.publicCode === "string"
		? error.publicCode
		: error?.name === "TimeoutError"
			? "NETWORK_TIMEOUT"
			: "CHECK_FAILED";
}
function options(args) {
	const result = { ...defaults };
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: node scripts/release-room-check.mjs [--origin http(s)://host] [--timeout-ms 20000]\nCreates one disposable room, performs at most two draws, then closes every socket. No existing-room or credential options are supported.",
			);
			return null;
		}
		if (arg === "--origin") result.origin = args[++index];
		else if (arg === "--timeout-ms") result.timeoutMs = Number(args[++index]);
		else throw fault("INVALID_CLI_ARGUMENT");
	}
	let url;
	try {
		url = new URL(result.origin);
	} catch {
		throw fault("INVALID_ORIGIN");
	}
	ensure(
		["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash,
		"INVALID_ORIGIN",
	);
	ensure(
		Number.isInteger(result.timeoutMs) &&
			result.timeoutMs >= 1_000 &&
			result.timeoutMs <= 60_000,
		"INVALID_TIMEOUT",
	);
	return { ...result, origin: url.origin };
}
function distribution(samples) {
	const sorted = [...samples].sort((left, right) => left - right);
	if (!sorted.length) return { samples: 0 };
	const middle = Math.floor(sorted.length / 2);
	const round = (value) => Math.round(value * 10) / 10;
	return {
		samples: sorted.length,
		medianMs: round(
			sorted.length % 2
				? sorted[middle]
				: (sorted[middle - 1] + sorted[middle]) / 2,
		),
		p95Ms: round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
		minMs: round(sorted[0]),
		maxMs: round(sorted.at(-1)),
	};
}

async function run(config) {
	const runStart = performance.now();
	const controller = new AbortController();
	const clients = [];
	const privateValues = new Set();
	const checks = [];
	const drawSources = [];
	const timings = { create: [], free: [], taken: [], open: [], join: [] };
	let roomId;
	let startCount = 0;
	let publicSnapshotCount = 0;
	let activeStage = "create";
	let passed = false;
	const deadline = setTimeout(
		() => controller.abort(fault("RUN_TIMEOUT")),
		config.runTimeoutMs,
	);
	const onSignal = () => controller.abort(fault("INTERRUPTED"));
	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	const pingTimer = setInterval(() => {
		for (const client of clients) {
			if (client.ws.readyState === WebSocket.OPEN)
				client.ws.send(
					JSON.stringify({ type: "ping", clientTime: Date.now() }),
				);
		}
	}, 15_000);
	function rememberProof(value) {
		privateValues.add(value);
		privateValues.add(createHash("sha256").update(value).digest("hex"));
		return value;
	}
	function publicSnapshot(snapshot) {
		const visit = (value) => {
			if (!value || typeof value !== "object") return;
			for (const [key, entry] of Object.entries(value)) {
				ensure(
					!/(token|secret|credential|password|api[_-]?key|hash)/i.test(key),
					"PRIVATE_FIELD_IN_PUBLIC_SNAPSHOT",
				);
				visit(entry);
			}
		};
		visit(snapshot);
		const serialized = JSON.stringify(snapshot);
		for (const value of privateValues)
			ensure(!serialized.includes(value), "PRIVATE_VALUE_IN_PUBLIC_SNAPSHOT");
		publicSnapshotCount++;
	}
	function pass(check, details = {}) {
		checks.push(check);
		emit("pass", { check, ...details });
	}
	async function post(path, body) {
		controller.signal.throwIfAborted();
		const started = performance.now();
		let response;
		try {
			response = await fetch(config.origin + path, {
				method: "POST",
				headers: { Origin: config.origin, "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(config.timeoutMs),
				]),
			});
			const value = await response.json();
			return {
				status: response.status,
				value,
				ms: performance.now() - started,
			};
		} catch {
			throw fault("HTTP_REQUEST_FAILED");
		}
	}
	function waitMessage(client, predicate, timeoutMs = config.timeoutMs) {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => finish(fault("MESSAGE_TIMEOUT")),
				timeoutMs,
			);
			function finish(error, message) {
				clearTimeout(timeout);
				client.listeners.delete(onMessage);
				controller.signal.removeEventListener("abort", onAbort);
				if (error) reject(error);
				else resolve(message);
			}
			function onAbort() {
				finish(controller.signal.reason ?? fault("INTERRUPTED"));
			}
			function onMessage(message) {
				if (message.type === "closed") return finish(fault("SOCKET_CLOSED"));
				if (predicate(message)) finish(null, message);
			}
			client.listeners.add(onMessage);
			controller.signal.addEventListener("abort", onAbort, { once: true });
			if (controller.signal.aborted) onAbort();
			else if (client.closed) finish(fault("SOCKET_CLOSED"));
		});
	}
	function waitSnapshot(client, predicate, timeoutMs = config.timeoutMs) {
		if (client.snapshot && predicate(client.snapshot))
			return Promise.resolve(client.snapshot);
		return waitMessage(
			client,
			(message) => message.type === "snapshot" && predicate(message.snapshot),
			timeoutMs,
		).then((message) => message.snapshot);
	}
	async function join(name, proof, expectedError) {
		const started = performance.now();
		const ws = new WebSocket(
			`${config.origin.replace(/^http/, "ws")}/parties/lunch-rooms/${roomId}?_pk=${uuid()}`,
			{ origin: config.origin, handshakeTimeout: config.timeoutMs },
		);
		const client = {
			ws,
			name,
			listeners: new Set(),
			snapshot: null,
			self: null,
			serverTime: 0,
			sequence: 0,
			closed: false,
		};
		clients.push(client);
		let openMs;
		ws.on("message", (raw) => {
			let message;
			try {
				message = JSON.parse(raw.toString());
				if (message.type === "snapshot") publicSnapshot(message.snapshot);
			} catch (error) {
				controller.abort(
					error.publicCode ? error : fault("INVALID_SERVER_MESSAGE"),
				);
				return;
			}
			if (message.type === "snapshot") {
				client.snapshot = message.snapshot;
				client.serverTime = message.serverTime;
				client.sequence++;
				if (message.self) client.self = message.self;
			}
			for (const listener of [...client.listeners]) listener(message);
		});
		const disconnected = () => {
			client.closed = true;
			for (const listener of [...client.listeners])
				listener({ type: "closed" });
		};
		ws.on("error", disconnected);
		ws.on("close", disconnected);
		const acknowledgement = waitMessage(
			client,
			(message) =>
				message.type === "error" ||
				(message.type === "snapshot" && message.self),
		);
		ws.once("open", () => {
			openMs = performance.now() - started;
			ws.send(JSON.stringify({ type: "join", name, ...proof }));
		});
		const message = await acknowledgement;
		if (expectedError) {
			ensure(
				message.type === "error" && message.code === expectedError,
				"AUTH_REJECTION_MISSING",
			);
			await close(client);
			return null;
		}
		ensure(message.type === "snapshot", "JOIN_REJECTED");
		timings.open.push(openMs);
		timings.join.push(performance.now() - started);
		return client;
	}
	async function close(client) {
		if (client.ws.readyState === WebSocket.CLOSED) return;
		await new Promise((resolve) => {
			const timeout = setTimeout(() => {
				client.ws.terminate();
				resolve();
			}, 1_500);
			client.ws.once("close", () => {
				clearTimeout(timeout);
				resolve();
			});
			if (client.ws.readyState === WebSocket.OPEN)
				client.ws.close(1000, "Release check complete");
			else client.ws.terminate();
		});
	}
	async function request(client, body, success) {
		ensure(client.ws.readyState === WebSocket.OPEN, "CLIENT_DISCONNECTED");
		const reply = waitMessage(
			client,
			(message) =>
				(message.type === "error" &&
					(!body.id || message.requestId === body.id)) ||
				(message.type === "snapshot" && success(message.snapshot)),
		);
		client.ws.send(JSON.stringify(body));
		return reply;
	}
	async function sync(client) {
		const sequence = client.sequence;
		return request(
			client,
			{ type: "join", name: client.name },
			() => client.sequence > sequence,
		);
	}
	async function availability(name, proof, expected, bucket) {
		const response = await post(
			`/api/lunch/rooms/${roomId}/nickname-availability`,
			{ name, ...proof },
		);
		ensure(response.status === 200, "AVAILABILITY_HTTP_STATUS");
		ensure(
			response.value.name === name.normalize("NFKC").trim() &&
				response.value.available === expected,
			"AVAILABILITY_RESULT_MISMATCH",
		);
		if (bucket) timings[bucket].push(response.ms);
	}
	async function changeCandidates(host, guest, ids) {
		const oldVersion = host.snapshot.listVersion;
		const matches = (snapshot) =>
			snapshot.listVersion === oldVersion + 1 &&
			JSON.stringify(snapshot.candidates.map((place) => place.id)) ===
				JSON.stringify(ids);
		const [reply] = await Promise.all([
			request(host, { type: "candidates", ids }, matches),
			waitSnapshot(guest, matches),
		]);
		ensure(reply.type === "snapshot", "HOST_CANDIDATES_REJECTED");
		return reply.snapshot.listVersion;
	}
	async function start(host, observer) {
		ensure(++startCount <= 2, "DRAW_LIMIT_EXCEEDED");
		const id = uuid();
		const [reply, observed] = await Promise.all([
			request(
				host,
				{ type: "start", id },
				(snapshot) =>
					snapshot.status === "fetching" || snapshot.draw?.id === id,
			),
			waitSnapshot(
				observer,
				(snapshot) =>
					snapshot.status === "fetching" || snapshot.draw?.id === id,
			),
		]);
		ensure(reply.type === "snapshot", "HOST_START_REJECTED");
		return { id, snapshot: reply.snapshot, observed };
	}
	const drawFor = (client, id) =>
		waitSnapshot(
			client,
			(snapshot) => snapshot.draw?.id === id,
			config.drawTimeoutMs,
		);
	const complete = (client, id) =>
		waitSnapshot(
			client,
			(snapshot) => snapshot.status === "waiting" && snapshot.draw?.id === id,
			config.drawTimeoutMs,
		);
	async function vote(client, drawId, choice) {
		return request(
			client,
			{ type: "vote", id: uuid(), drawId, vote: choice },
			(snapshot) =>
				snapshot.draw?.id === drawId &&
				snapshot.draw.votes?.some(
					(entry) =>
						entry.participantId === client.self.id && entry.vote === choice,
				),
		);
	}
	try {
		const created = await post("/api/lunch/rooms", {
			title: "릴리즈 #8 연결 검증",
			hostName,
			candidateIds: initialCandidates,
		});
		timings.create.push(created.ms);
		ensure(created.status === 201, "CREATE_HTTP_STATUS");
		ensure(
			/^[0-9a-f-]{36}$/i.test(created.value.roomId) &&
				/^[a-f0-9]{64}$/i.test(created.value.hostToken),
			"INVALID_CREATE_RESPONSE",
		);
		roomId = created.value.roomId;
		const hostProof = { hostToken: rememberProof(created.value.hostToken) };
		const guestProof = { guestToken: rememberProof(uuid()) };
		const lateProof = { guestToken: rememberProof(uuid()) };
		const outsiderProof = { guestToken: rememberProof(uuid()) };
		emit("room-created", {
			url: `${config.origin}/lunch-room/${roomId}`,
			status: created.status,
		});
		pass("room-create-201");

		activeStage = "auth-and-availability";
		let host = await join(hostName, hostProof);
		ensure(host.self.isHost === true, "HOST_AUTHORITY_MISSING");
		const hostIdentity = host.self.id;
		const baselineMessages = host.snapshot.messages.length;
		for (const name of [" ＱＡ　Ｍａｔｅ ", "qa mate", "QA Mate"])
			await availability(name, guestProof, true, "free");
		await sync(host);
		ensure(
			host.snapshot.participants.length === 1 &&
				host.snapshot.messages.length === baselineMessages,
			"AVAILABILITY_JOINED_OR_MUTATED_ROOM",
		);
		pass("availability-normalizes-free-without-joining", { observations: 3 });
		let guest = await join(guestName, guestProof);
		ensure(guest.self.isHost === false, "GUEST_RECEIVED_HOST_AUTHORITY");
		const guestIdentity = guest.self.id;
		for (const name of [" ＱＡ　Ｍａｔｅ ", "qa mate", "QA MATE"])
			await availability(name, outsiderProof, false, "taken");
		await availability(guestName, guestProof, true);
		await sync(host);
		ensure(host.snapshot.participants.length === 2, "TAKEN_CHECK_JOINED_ROOM");
		pass("availability-normalizes-taken-and-preserves-own-identity", {
			observations: 3,
		});
		const invalidHostProof = { hostToken: rememberProof(uuid()) };
		const invalidAuth = await post(
			`/api/lunch/rooms/${roomId}/nickname-availability`,
			{ name: "인증점검", ...invalidHostProof },
		);
		ensure(invalidAuth.status === 403, "INVALID_HOST_HTTP_AUTH_ACCEPTED");
		await join("인증점검", invalidHostProof, "HOST_AUTH_FAILED");
		pass("host-and-guest-authentication");

		activeStage = "chat-and-candidates";
		for (const [sender, receiver, text] of [
			[host, guest, "방장 연결 점검"],
			[guest, host, "참가자 연결 점검"],
		]) {
			const id = uuid();
			const matches = (snapshot) =>
				snapshot.messages.some(
					(entry) =>
						entry.id === id &&
						entry.text === text &&
						entry.participantId === sender.self.id,
				);
			const [reply] = await Promise.all([
				request(sender, { type: "chat", id, text }, matches),
				waitSnapshot(receiver, matches),
			]);
			ensure(reply.type === "snapshot", "CHAT_REJECTED");
		}
		pass("bidirectional-chat");
		const guestCandidates = await request(
			guest,
			{ type: "candidates", ids: nextCandidates },
			() => false,
		);
		ensure(
			guestCandidates.code === "HOST_REQUIRED",
			"GUEST_CHANGED_CANDIDATES",
		);
		const guestStart = await request(
			guest,
			{ type: "start", id: uuid() },
			() => false,
		);
		ensure(guestStart.code === "HOST_REQUIRED", "GUEST_STARTED_DRAW");
		const drawCandidates = [...initialCandidates, "seonjeongneung-05"];
		const firstVersion = await changeCandidates(host, guest, drawCandidates);
		pass("candidate-host-authority-and-version", { listVersion: firstVersion });

		activeStage = "draw-sync-and-late-join";
		const first = await start(host, guest);
		const [hostDrawing, guestDrawing] = await Promise.all([
			drawFor(host, first.id),
			drawFor(guest, first.id),
		]);
		const firstDraw = hostDrawing.draw;
		drawSources.push(firstDraw.source);
		ensure(
			JSON.stringify(firstDraw) === JSON.stringify(guestDrawing.draw),
			"DRAW_CLIENTS_DIVERGED",
		);
		ensure(
			firstDraw.durationMs === 7200 &&
				Number.isSafeInteger(firstDraw.startedAt) &&
				Number.isSafeInteger(firstDraw.timestamp) &&
				Number.isSafeInteger(firstDraw.requestedAt) &&
				firstDraw.requestedAt <= firstDraw.timestamp &&
				firstDraw.startedAt >= firstDraw.timestamp &&
				firstDraw.fromRotation === 0 &&
				Number.isFinite(firstDraw.toRotation) &&
				firstDraw.winnerIndex >= 0 &&
				firstDraw.winnerIndex < drawCandidates.length &&
				firstDraw.listVersion === firstVersion,
			"INVALID_DRAW_METADATA",
		);
		ensure(
			firstDraw.probabilities?.length === drawCandidates.length &&
				firstDraw.probabilities.every(
					(value) => Math.abs(value - 1 / drawCandidates.length) < 1e-12,
				) &&
				firstDraw.participants?.length === 2 &&
				firstDraw.participants.some((entry) => entry.id === hostIdentity) &&
				firstDraw.participants.some((entry) => entry.id === guestIdentity),
			"INVALID_DRAW_PROBABILITIES_OR_PARTICIPANTS",
		);
		pass("draw-same-winner-and-7200ms-timeline", { source: firstDraw.source });
		const late = await join(lateName, lateProof);
		ensure(
			late.snapshot.status === "drawing" &&
				late.serverTime < firstDraw.startedAt + firstDraw.durationMs &&
				JSON.stringify(late.snapshot.draw) === JSON.stringify(firstDraw),
			"LATE_JOIN_DID_NOT_RECEIVE_ACTIVE_TIMELINE",
		);
		pass("late-join-receives-same-active-draw");

		activeStage = "guest-reconnect";
		const beforeLeft = host.snapshot.messages.filter(
			(entry) => entry.event === "left",
		).length;
		await close(guest);
		await waitSnapshot(
			host,
			(snapshot) =>
				!snapshot.participants.some((entry) => entry.id === guestIdentity) &&
				snapshot.messages.filter((entry) => entry.event === "left").length >
					beforeLeft,
		);
		const beforeJoined = host.snapshot.messages.filter(
			(entry) => entry.event === "joined",
		).length;
		guest = await join(guestName, guestProof);
		ensure(
			guest.self.id === guestIdentity,
			"GUEST_IDENTITY_CHANGED_ON_RECONNECT",
		);
		await waitSnapshot(
			host,
			(snapshot) =>
				snapshot.participants.some((entry) => entry.id === guestIdentity) &&
				snapshot.messages.filter((entry) => entry.event === "joined").length >
					beforeJoined,
		);
		pass("guest-reconnect-identity-and-system-events");

		activeStage = "host-reconnect";
		await close(host);
		await waitSnapshot(
			guest,
			(snapshot) =>
				!snapshot.participants.some((entry) => entry.id === hostIdentity),
		);
		host = await join(hostName, hostProof);
		ensure(
			host.self.id === hostIdentity && host.self.isHost === true,
			"HOST_AUTHORITY_LOST_ON_RECONNECT",
		);
		pass("host-reconnect-restores-identity-and-authority");

		activeStage = "irreversible-voting";
		await Promise.all([complete(host, first.id), complete(guest, first.id)]);
		const hostVote = await vote(host, first.id, "up");
		ensure(hostVote.code === "HOST_CANNOT_VOTE", "HOST_VOTE_ACCEPTED");
		const firstVote = await vote(guest, first.id, "up");
		ensure(firstVote.type === "snapshot", "GUEST_VOTE_REJECTED");
		const savedVote = firstVote.snapshot.draw.votes.find(
			(entry) => entry.participantId === guestIdentity,
		);
		ensure(
			savedVote.vote === "up" &&
				Number.isSafeInteger(savedVote.reactionMs) &&
				savedVote.reactionMs >= 0,
			"INVALID_SAVED_VOTE",
		);
		const replay = await vote(guest, first.id, "down");
		ensure(replay.code === "VOTE_ALREADY_CAST", "VOTE_REPLAY_ACCEPTED");
		const lateVote = await vote(late, first.id, "down");
		ensure(lateVote.type === "snapshot", "LATE_PARTICIPANT_VOTE_REJECTED");
		const voted = await waitSnapshot(
			host,
			(snapshot) =>
				snapshot.draw?.id === first.id && snapshot.draw.votes?.length === 2,
		);
		ensure(
			voted.draw.votes.find((entry) => entry.participantId === guestIdentity)
				?.vote === "up",
			"FIRST_VOTE_CHANGED",
		);
		pass("host-denied-guest-one-irreversible-vote", {
			reactionMs: savedVote.reactionMs,
		});

		activeStage = "freeze-and-history";
		const frozen = JSON.stringify(voted.draw);
		await changeCandidates(host, guest, nextCandidates);
		ensure(
			JSON.stringify(host.snapshot.draw) === frozen,
			"CURRENT_DRAW_METADATA_MUTATED",
		);
		const second = await start(host, guest);
		const archived = second.snapshot.history.find(
			(entry) => entry.id === first.id,
		);
		ensure(
			second.snapshot.status === "fetching" &&
				second.snapshot.draw === null &&
				JSON.stringify(archived) === frozen,
			"NEXT_START_DID_NOT_FREEZE_COMPLETE_DRAW",
		);
		const historyVote = await vote(guest, first.id, "down");
		ensure(historyVote.code === "VOTE_CLOSED", "HISTORY_VOTE_ACCEPTED");
		await sync(host);
		ensure(
			JSON.stringify(
				host.snapshot.history.find((entry) => entry.id === first.id),
			) === frozen,
			"ARCHIVED_DRAW_MUTATED",
		);
		pass("next-start-freezes-votes-probabilities-participants-and-metadata");
		pass("history-vote-closed-and-record-immutable");
		const [secondCompleted] = await Promise.all([
			complete(host, second.id),
			complete(guest, second.id),
		]);
		drawSources.push(secondCompleted.draw.source);
		ensure(
			JSON.stringify(
				host.snapshot.history.find((entry) => entry.id === first.id),
			) === frozen,
			"ARCHIVED_DRAW_CHANGED_AFTER_NEXT_COMPLETION",
		);
		pass("public-snapshots-contain-no-proofs-or-hashes", {
			observations: publicSnapshotCount,
		});
		passed = true;
	} catch (error) {
		emit("failure", { stage: activeStage, code: safeCode(error) });
	} finally {
		clearTimeout(deadline);
		clearInterval(pingTimer);
		controller.abort(fault("CHECK_FINISHED"));
		await Promise.all(clients.map(close));
		process.removeListener("SIGINT", onSignal);
		process.removeListener("SIGTERM", onSignal);
		emit("summary", {
			passed,
			checksPassed: checks.length,
			roomsCreated: roomId ? 1 : 0,
			drawsRequested: startCount,
			drawSources,
			socketsClosed: clients.every(
				(client) => client.ws.readyState === WebSocket.CLOSED,
			),
			elapsedMs: Math.round(performance.now() - runStart),
			timings: {
				note: "Observed samples from one disposable room and this client only; p95 uses nearest rank. Join samples include initial and reconnect sessions.",
				createHttp: distribution(timings.create),
				availabilityFreeHttp: distribution(timings.free),
				availabilityTakenHttp: distribution(timings.taken),
				webSocketOpen: distribution(timings.open),
				joinAcknowledgement: distribution(timings.join),
			},
		});
	}
	if (!passed) process.exitCode = 1;
}

try {
	const config = options(process.argv.slice(2));
	if (config) await run(config);
} catch (error) {
	emit("failure", { stage: "setup", code: safeCode(error) });
	process.exitCode = 1;
}
