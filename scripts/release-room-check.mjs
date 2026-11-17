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
function checkDrawGeometry(draw) {
	ensure(
		draw.durationMs === 4000 &&
			draw.fromRotation === 0 &&
			Number.isFinite(draw.toRotation) &&
			draw.toRotation >= 1440 &&
			draw.toRotation < 1800 &&
			Number.isSafeInteger(draw.winnerIndex) &&
			draw.winnerIndex >= 0 &&
			draw.winnerIndex < draw.candidates.length &&
			Number.isFinite(draw.landingFraction) &&
			draw.landingFraction >= 0.1 &&
			draw.landingFraction <= 0.9,
		"INVALID_DRAW_GEOMETRY",
	);
	const angleAtPointer = ((-draw.toRotation % 360) + 360) % 360;
	const slicePosition = angleAtPointer / (360 / draw.candidates.length);
	ensure(
		Math.abs(slicePosition - draw.winnerIndex - draw.landingFraction) < 1e-7,
		"POINTER_OUTSIDE_RECORDED_WINNING_POSITION",
	);
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
	function serverClosure(client) {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(
				() => reject(fault("SERVER_CLOSE_TIMEOUT")),
				config.timeoutMs,
			);
			client.ws.once("close", (code) => {
				clearTimeout(timeout);
				if (code === 4008) resolve();
				else reject(fault("WRONG_ROOM_CLOSE_CODE"));
			});
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
	async function command(client, body) {
		ensure(client.ws.readyState === WebSocket.OPEN, "CLIENT_DISCONNECTED");
		const message = { id: uuid(), ...body };
		const reply = waitMessage(
			client,
			(value) =>
				(value.type === "ack" || value.type === "error") &&
				value.requestId === message.id,
		);
		client.ws.send(JSON.stringify(message));
		return reply;
	}
	async function intake(host, observer, action) {
		const status =
			action === "edit"
				? "editing"
				: action === "open"
					? "collecting"
					: action === "close"
						? "reviewing"
						: "waiting";
		const [reply] = await Promise.all([
			command(host, {
				type: "intake",
				action,
				expectedRevision: host.snapshot.revision,
			}),
			waitSnapshot(observer, (snapshot) => snapshot.status === status),
		]);
		ensure(reply.type === "ack", "HOST_INTAKE_REJECTED");
		ensure(host.snapshot.status === status, "INTAKE_ACK_WITHOUT_STATE");
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
		const candidates = ids.map(
			(id, index) =>
				host.snapshot.candidates.find((place) => place.id === id) ?? {
					id,
					name: `직접 작성 검증 후보 ${index + 1}`,
					category: "직접 분류",
					included: true,
				},
		);
		const reply = await command(host, {
			type: "room-edit",
			baseListVersion: oldVersion,
			candidates,
		});
		ensure(reply.type === "ack", "HOST_CANDIDATES_REJECTED");
		await waitSnapshot(guest, matches);
		return host.snapshot.listVersion;
	}
	async function start(host, observer) {
		ensure(++startCount <= 2, "DRAW_LIMIT_EXCEEDED");
		const id = uuid();
		const [reply, observed] = await Promise.all([
			request(
				host,
				{
					type: "start",
					id,
					expectedRevision: host.snapshot.revision,
					...(!host.snapshot.excludeDrawn && host.snapshot.excludedIds?.length
						? { confirmReset: true }
						: {}),
				},
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
			(snapshot) => snapshot.status === "result" && snapshot.draw?.id === id,
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
			candidateIds: [],
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

		activeStage = "entry-info";
		const entryInfoResponse = await fetch(
			`${config.origin}/api/lunch/rooms/${roomId}/entry-info`,
			{
				method: "GET",
				cache: "no-store",
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(config.timeoutMs),
				]),
			},
		);
		const entryInfo = await entryInfoResponse.json();
		ensure(
			entryInfoResponse.status === 200 &&
				entryInfoResponse.headers.get("Cache-Control") === "no-store" &&
				JSON.stringify(Object.keys(entryInfo)) === JSON.stringify(["title"]) &&
				entryInfo.title === "릴리즈 #8 연결 검증",
			"PREJOIN_ROOM_TITLE_NOT_PUBLIC_AND_BOUNDED",
		);
		pass("prejoin-entry-info-exposes-only-current-room-title");

		activeStage = "auth-and-availability";
		let host = await join(hostName, hostProof);
		ensure(host.self.isHost === true, "HOST_AUTHORITY_MISSING");
		ensure(
			host.snapshot.status === "editing" &&
				host.snapshot.draw === null &&
				host.snapshot.intakeId === null,
			"NEW_ROOM_DID_NOT_START_IN_EDITING",
		);
		pass("new-room-starts-in-host-editing-without-opening-recommendations");
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
		ensure(
			host.snapshot.status === "editing" &&
				guest.snapshot.status === "editing" &&
				host.snapshot.candidates.length === 0 &&
				guest.snapshot.candidates.length === 0,
			"NEW_ROOM_WAS_NOT_EMPTY_FOR_BOTH_ROLES",
		);
		const emptyFinalize = await command(host, {
			type: "intake",
			action: "finalize",
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			emptyFinalize.code === "NO_CANDIDATES" &&
				host.snapshot.status === "editing",
			"EMPTY_ROOM_FINALIZED_WITHOUT_CANDIDATES",
		);
		await changeCandidates(host, guest, initialCandidates);
		ensure(
			host.snapshot.candidates.length === 3 &&
				host.snapshot.candidates.every(
					(candidate) => candidate.category === "직접 분류",
				),
			"CUSTOM_SETUP_NOT_SAVED",
		);
		pass("empty-create-both-roles-and-custom-setup-before-first-finalize");
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
		const guestCandidates = await command(guest, {
			type: "room-edit",
			baseListVersion: guest.snapshot.listVersion,
			candidates: guest.snapshot.candidates.slice(0, 2),
		});
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
		let firstVersion = await changeCandidates(host, guest, drawCandidates);
		pass("candidate-host-authority-and-version", { listVersion: firstVersion });
		await intake(host, guest, "finalize");
		const legacyCandidates = await request(
			host,
			{ type: "candidates", ids: initialCandidates },
			() => false,
		);
		ensure(
			legacyCandidates.code === "CLIENT_UPGRADE_REQUIRED" &&
				host.snapshot.listVersion === firstVersion,
			"LEGACY_CANDIDATES_BYPASSED_REVISION",
		);
		pass("legacy-candidate-protocol-cannot-bypass-versioned-edits");

		activeStage = "independent-game-filter";
		const filterSource = JSON.stringify(host.snapshot.candidates);
		const filterVersion = host.snapshot.listVersion;
		const firstGameFilter = {
			categories: ["직접 분류"],
			excludedIds: [initialCandidates[0]],
		};
		const waitingFilter = await command(host, {
			type: "game-filter",
			filter: firstGameFilter,
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			waitingFilter.code === "PHASE_CONFLICT" &&
				host.snapshot.status === "waiting" &&
				JSON.stringify(host.snapshot.candidates) === filterSource,
			"WAITING_GAME_FILTER_BYPASSED_PREPARATION_STAGE",
		);
		await intake(host, guest, "edit");
		const forbiddenFilter = await command(guest, {
			type: "game-filter",
			filter: firstGameFilter,
			expectedRevision: guest.snapshot.revision,
		});
		ensure(
			forbiddenFilter.code === "HOST_REQUIRED",
			"GUEST_CHANGED_GAME_FILTER",
		);
		const filtered = await command(host, {
			type: "game-filter",
			filter: firstGameFilter,
			expectedRevision: host.snapshot.revision,
		});
		ensure(filtered.type === "ack", "HOST_GAME_FILTER_REJECTED");
		await waitSnapshot(
			guest,
			(snapshot) =>
				JSON.stringify(snapshot.gameFilter) === JSON.stringify(firstGameFilter),
		);
		ensure(
			host.snapshot.status === "editing" &&
				host.snapshot.listVersion === filterVersion &&
				JSON.stringify(host.snapshot.candidates) === filterSource &&
				host.snapshot.excludedIds.length === 0,
			"GAME_FILTER_CHANGED_SOURCE_VERSION_PHASE_OR_LEDGER",
		);
		pass(
			"game-filter-is-preparation-only-host-only-and-preserves-source-list-version-and-ledger",
		);
		await intake(host, guest, "finalize");

		activeStage = "intake-and-candidate-concurrency";
		const guestIntake = await command(guest, {
			type: "intake",
			action: "open",
			expectedRevision: guest.snapshot.revision,
		});
		ensure(guestIntake.code === "HOST_REQUIRED", "GUEST_OPENED_INTAKE");
		const waitingEdit = await command(host, {
			type: "room-edit",
			baseListVersion: host.snapshot.listVersion,
			title: "대기에서 변경 불가",
			candidates: host.snapshot.candidates,
		});
		ensure(
			waitingEdit.code === "PHASE_CONFLICT",
			"WAITING_ROOM_EDIT_BYPASSED_EDITING_STAGE",
		);
		await intake(host, guest, "edit");
		ensure(
			host.snapshot.intakeId === null && host.snapshot.draw === null,
			"HOST_EDITING_OPENED_RECOMMENDATIONS_OR_DRAW",
		);
		pass("waiting-view-is-readonly-and-host-explicitly-enters-editing");
		await intake(host, guest, "open");
		const initialIntakeId = host.snapshot.intakeId;
		const baseListVersion = host.snapshot.listVersion;
		const recommendation = {
			type: "recommend",
			id: uuid(),
			name: "연결 검증 후보",
			intakeId: initialIntakeId,
		};
		const recommended = await command(guest, recommendation);
		ensure(recommended.type === "ack", "GUEST_RECOMMENDATION_REJECTED");
		await waitSnapshot(host, (snapshot) =>
			snapshot.candidates.some(
				(candidate) => candidate.name === recommendation.name,
			),
		);
		const ownCandidate = host.snapshot.candidates.find(
			(candidate) => candidate.name === recommendation.name,
		);
		ensure(
			ownCandidate.ownerId === guestIdentity,
			"CANDIDATE_OWNERSHIP_MISSING",
		);
		const acceptedVersion = host.snapshot.listVersion;
		const duplicate = await command(guest, recommendation);
		ensure(
			duplicate.type === "ack" &&
				guest.snapshot.listVersion === acceptedVersion &&
				guest.snapshot.candidates.filter(
					(candidate) => candidate.id === ownCandidate.id,
				).length === 1,
			"RECOMMENDATION_RETRY_DUPLICATED",
		);
		const forbidden = await command(guest, {
			type: "remove-candidate",
			candidateId: initialCandidates[0],
			intakeId: initialIntakeId,
		});
		ensure(
			forbidden.code === "CANDIDATE_FORBIDDEN",
			"GUEST_REMOVED_ANOTHER_CANDIDATE",
		);
		pass(
			"intake-host-authority-guest-recommendation-ownership-and-idempotent-ack",
		);
		const titleEdit = await command(host, {
			type: "room-edit",
			baseListVersion,
			title: "릴리즈 lifecycle 연결 검증",
		});
		ensure(
			titleEdit.type === "ack" &&
				host.snapshot.candidates.some(
					(candidate) => candidate.id === ownCandidate.id,
				),
			"TITLE_EDIT_LOST_RECOMMENDATION",
		);
		const staleEdit = await command(host, {
			type: "room-edit",
			baseListVersion,
			candidates: host.snapshot.candidates,
		});
		ensure(
			staleEdit.code === "LIST_CONFLICT",
			"STALE_CANDIDATE_DRAFT_OVERWROTE_RECOMMENDATION",
		);
		pass("title-only-edit-preserves-recommendation-and-stale-list-is-rejected");
		await intake(host, guest, "close");
		const lateRecommendation = await command(guest, {
			type: "recommend",
			name: "마감 뒤 후보",
			intakeId: initialIntakeId,
		});
		ensure(
			lateRecommendation.code === "INTAKE_CLOSED",
			"CLOSED_INTAKE_ACCEPTED_RECOMMENDATION",
		);
		await intake(host, guest, "open");
		ensure(
			host.snapshot.intakeId !== initialIntakeId,
			"REOPEN_REUSED_INTAKE_ID",
		);
		const oldIntake = await command(guest, {
			type: "recommend",
			name: "이전 접수 후보",
			intakeId: initialIntakeId,
		});
		ensure(
			oldIntake.code === "INTAKE_CLOSED",
			"REOPEN_ACCEPTED_OLD_INTAKE_REQUEST",
		);
		const beforeRemoval = host.snapshot.revision;
		const removed = await command(guest, {
			type: "remove-candidate",
			candidateId: ownCandidate.id,
			intakeId: guest.snapshot.intakeId,
		});
		ensure(removed.type === "ack", "OWNER_CANNOT_REMOVE_RECOMMENDATION");
		await waitSnapshot(
			host,
			(snapshot) =>
				!snapshot.candidates.some(
					(candidate) => candidate.id === ownCandidate.id,
				),
		);
		const staleFinalize = await command(host, {
			type: "intake",
			action: "finalize",
			expectedRevision: beforeRemoval,
		});
		ensure(
			staleFinalize.code === "REVISION_CONFLICT" &&
				host.snapshot.status === "collecting",
			"STALE_FINALIZE_ACCEPTED",
		);
		await intake(host, guest, "finalize");
		ensure(
			host.snapshot.draw === null &&
				host.snapshot.candidates.length === drawCandidates.length,
			"FINALIZE_STARTED_DRAW_OR_LOST_CANDIDATES",
		);
		firstVersion = host.snapshot.listVersion;
		pass(
			"intake-close-reopen-session-isolation-and-versioned-finalize-to-waiting",
		);
		const enableExclusion = await command(host, {
			type: "options",
			excludeDrawn: true,
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			enableExclusion.type === "ack" && host.snapshot.excludeDrawn === true,
			"EXCLUSION_OPTION_REJECTED",
		);

		activeStage = "draw-sync-and-late-join";
		const first = await start(host, guest);
		const busyClose = await command(host, { type: "room-close" });
		ensure(busyClose.code === "DRAW_BUSY", "ROOM_CLOSED_DURING_DRAW");
		pass("host-cannot-close-room-during-draw");
		const [hostDrawing, guestDrawing] = await Promise.all([
			drawFor(host, first.id),
			drawFor(guest, first.id),
		]);
		const firstDraw = hostDrawing.draw;
		const firstDrawCandidates = drawCandidates.filter(
			(id) => !firstGameFilter.excludedIds.includes(id),
		);
		drawSources.push(firstDraw.source);
		ensure(
			JSON.stringify(firstDraw) === JSON.stringify(guestDrawing.draw),
			"DRAW_CLIENTS_DIVERGED",
		);
		ensure(
			firstDraw.durationMs === 4000 &&
				Number.isSafeInteger(firstDraw.startedAt) &&
				Number.isSafeInteger(firstDraw.timestamp) &&
				Number.isSafeInteger(firstDraw.requestedAt) &&
				firstDraw.requestedAt <= firstDraw.timestamp &&
				firstDraw.startedAt >= firstDraw.timestamp &&
				firstDraw.fromRotation === 0 &&
				Number.isFinite(firstDraw.toRotation) &&
				firstDraw.winnerIndex >= 0 &&
				firstDraw.winnerIndex < firstDrawCandidates.length &&
				firstDraw.listVersion === firstVersion,
			"INVALID_DRAW_METADATA",
		);
		checkDrawGeometry(firstDraw);
		ensure(
			firstDraw.probabilities?.length === firstDrawCandidates.length &&
				firstDraw.probabilities.every(
					(value) => Math.abs(value - 1 / firstDrawCandidates.length) < 1e-12,
				) &&
				firstDraw.participants?.length === 2 &&
				firstDraw.participants.some((entry) => entry.id === hostIdentity) &&
				firstDraw.participants.some((entry) => entry.id === guestIdentity),
			"INVALID_DRAW_PROBABILITIES_OR_PARTICIPANTS",
		);
		ensure(
			JSON.stringify(firstDraw.candidates.map((candidate) => candidate.id)) ===
				JSON.stringify(firstDrawCandidates) &&
				firstDraw.candidates.every(
					(candidate) => candidate.category === "직접 분류",
				) &&
				JSON.stringify(firstDraw.gameFilter) ===
					JSON.stringify(firstGameFilter),
			"CUSTOM_DRAW_OR_FILTER_COPY_MISMATCH",
		);
		pass(
			"custom-classifications-and-filtered-final-candidates-are-fixed-in-the-draw",
		);
		pass("draw-same-winner-and-4000ms-random-position", {
			source: firstDraw.source,
			landingFraction: firstDraw.landingFraction,
		});
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
		ensure(hostVote.type === "snapshot", "HOST_VOTE_REJECTED");
		const savedHostVote = hostVote.snapshot.draw.votes.find(
			(entry) => entry.participantId === hostIdentity,
		);
		ensure(
			savedHostVote?.vote === "up" &&
				savedHostVote.name === hostName &&
				Number.isSafeInteger(savedHostVote.reactionMs) &&
				savedHostVote.reactionMs >= 0,
			"INVALID_SAVED_HOST_VOTE",
		);
		const hostReplay = await vote(host, first.id, "down");
		ensure(
			hostReplay.code === "VOTE_ALREADY_CAST",
			"HOST_VOTE_REPLAY_ACCEPTED",
		);
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
		ensure(
			lateVote.code === "VOTE_NOT_ELIGIBLE",
			"LATE_PARTICIPANT_VOTE_ACCEPTED",
		);
		pass("late-participant-cannot-vote-in-current-round");
		const voted = await waitSnapshot(
			host,
			(snapshot) =>
				snapshot.draw?.id === first.id && snapshot.draw.votes?.length === 2,
		);
		ensure(
			voted.draw.votes.find((entry) => entry.participantId === guestIdentity)
				?.vote === "up" &&
				JSON.stringify(
					voted.draw.votes.find(
						(entry) => entry.participantId === hostIdentity,
					),
				) === JSON.stringify(savedHostVote),
			"FIRST_VOTE_CHANGED",
		);
		pass("host-and-guest-one-irreversible-vote", {
			reactionMs: savedVote.reactionMs,
			hostReactionMs: savedHostVote.reactionMs,
		});

		activeStage = "freeze-and-history";
		const frozen = JSON.stringify(voted.draw);
		const firstWinnerId = voted.draw.candidates[voted.draw.winnerIndex].id;
		ensure(
			JSON.stringify(voted.excludedIds) === JSON.stringify([firstWinnerId]),
			"ON_DRAW_DID_NOT_SAVE_WINNER_LEDGER",
		);
		ensure(
			voted.drawCount === 1 &&
				voted.drawCountIsExact === true &&
				voted.draw.roundNumber === 1 &&
				voted.exclusionRecords?.length === 1 &&
				voted.exclusionRecords[0].candidateId === firstWinnerId &&
				voted.exclusionRecords[0].drawId === first.id &&
				voted.exclusionRecords[0].roundNumber === 1 &&
				voted.exclusionRecords[0].drawnAt ===
					voted.draw.startedAt + voted.draw.durationMs,
			"ON_DRAW_METADATA_NOT_SAVED",
		);
		const resultFilter = await command(host, {
			type: "game-filter",
			filter: { categories: null, excludedIds: [] },
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			resultFilter.code === "PHASE_CONFLICT" &&
				host.snapshot.status === "result" &&
				JSON.stringify(host.snapshot.candidates) === filterSource &&
				JSON.stringify(host.snapshot.gameFilter) ===
					JSON.stringify(firstGameFilter) &&
				JSON.stringify(host.snapshot.excludedIds) ===
					JSON.stringify([firstWinnerId]) &&
				JSON.stringify(host.snapshot.draw) === frozen,
			"RESULT_GAME_FILTER_BYPASSED_PREPARATION_STAGE",
		);
		pass(
			"result-game-filter-rejected-without-changing-source-drawn-exclusions-or-result",
		);
		const secondCandidates = [
			firstWinnerId,
			...nextCandidates.filter((id) => id !== firstWinnerId),
		].slice(0, 2);
		const resultEdit = await command(host, {
			type: "room-edit",
			baseListVersion: host.snapshot.listVersion,
			candidates: host.snapshot.candidates,
		});
		ensure(
			resultEdit.code === "PHASE_CONFLICT" &&
				host.snapshot.status === "result" &&
				JSON.stringify(host.snapshot.draw) === frozen,
			"RESULT_EDIT_BYPASSED_EXPLICIT_WAITING_AND_EDITING",
		);
		const disableExclusion = await command(host, {
			type: "options",
			excludeDrawn: false,
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			disableExclusion.type === "ack" &&
				host.snapshot.status === "result" &&
				JSON.stringify(host.snapshot.excludedIds) ===
					JSON.stringify([firstWinnerId]),
			"OFF_TOGGLE_RESET_LEDGER_OR_CLOSED_RESULT",
		);
		const resultStart = await command(host, {
			type: "start",
			expectedRevision: host.snapshot.revision,
			confirmReset: true,
		});
		ensure(resultStart.code === "DRAW_BUSY", "RESULT_DIRECT_REDRAW_ACCEPTED");
		pass(
			"between-round-options-preserve-result-ledger-and-require-explicit-next",
		);
		ensure(
			JSON.stringify(host.snapshot.draw) === frozen,
			"CURRENT_DRAW_METADATA_MUTATED",
		);
		const guestNext = await request(
			guest,
			{ type: "next", id: uuid(), drawId: first.id },
			() => false,
		);
		ensure(guestNext.code === "HOST_REQUIRED", "GUEST_CLOSED_VOTING");
		const matchesClosed = (snapshot) =>
			snapshot.status === "waiting" &&
			snapshot.draw === null &&
			snapshot.history.some((entry) => entry.id === first.id);
		const [closedReply] = await Promise.all([
			request(
				host,
				{ type: "next", id: uuid(), drawId: first.id },
				matchesClosed,
			),
			waitSnapshot(guest, matchesClosed),
			waitSnapshot(late, matchesClosed),
		]);
		ensure(closedReply.type === "snapshot", "HOST_CLOSE_REJECTED");
		ensure(
			JSON.stringify(
				closedReply.snapshot.history.find((entry) => entry.id === first.id),
			) === frozen,
			"CLOSE_DID_NOT_FREEZE_DRAW",
		);
		pass("host-closes-voting-and-prepares-next-round-for-everyone");
		await intake(host, guest, "edit");
		const clearFilter = await command(host, {
			type: "game-filter",
			filter: { categories: null, excludedIds: [] },
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			clearFilter.type === "ack" &&
				host.snapshot.status === "editing" &&
				JSON.stringify(host.snapshot.candidates) === filterSource &&
				JSON.stringify(host.snapshot.excludedIds) ===
					JSON.stringify([firstWinnerId]) &&
				JSON.stringify(
					host.snapshot.history.find((entry) => entry.id === first.id),
				) === frozen,
			"PREPARATION_FILTER_RESET_CHANGED_SOURCE_LEDGER_OR_HISTORY",
		);
		pass(
			"preparation-filter-reset-preserves-source-drawn-exclusions-and-history",
		);
		await changeCandidates(host, guest, secondCandidates);
		await intake(host, guest, "finalize");
		ensure(
			host.snapshot.draw === null &&
				JSON.stringify(
					host.snapshot.history.find((entry) => entry.id === first.id),
				) === frozen,
			"EXPLICIT_EDITING_CHANGED_ARCHIVED_RESULT",
		);
		pass(
			"result-edit-rejected-and-next-waiting-edit-finalize-preserve-history",
		);
		const unconfirmedStart = await command(host, {
			type: "start",
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			unconfirmedStart.code === "RESET_CONFIRMATION_REQUIRED" &&
				host.snapshot.status === "waiting" &&
				JSON.stringify(host.snapshot.excludedIds) ===
					JSON.stringify([firstWinnerId]),
			"OFF_START_BYPASSED_RESET_CONFIRMATION",
		);
		pass("off-draw-requires-current-revision-and-reset-confirmation");

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
		const hostHistoryVote = await vote(host, first.id, "down");
		ensure(
			hostHistoryVote.code === "VOTE_CLOSED",
			"HOST_HISTORY_VOTE_ACCEPTED",
		);
		await sync(host);
		ensure(
			JSON.stringify(
				host.snapshot.history.find((entry) => entry.id === first.id),
			) === frozen,
			"ARCHIVED_DRAW_MUTATED",
		);
		pass("closed-votes-probabilities-participants-survive-next-start");
		pass("history-vote-closed-and-record-immutable");
		const [secondCompleted] = await Promise.all([
			complete(host, second.id),
			complete(guest, second.id),
		]);
		drawSources.push(secondCompleted.draw.source);
		checkDrawGeometry(secondCompleted.draw);
		pass("second-draw-retains-correct-winning-position", {
			landingFraction: secondCompleted.draw.landingFraction,
		});
		const secondWinnerId =
			secondCompleted.draw.candidates[secondCompleted.draw.winnerIndex].id;
		ensure(
			JSON.stringify(secondCompleted.excludedIds) ===
				JSON.stringify([secondWinnerId]),
			"OFF_DRAW_DID_NOT_REPLACE_WINNER_LEDGER",
		);
		ensure(
			secondCompleted.drawCount === 2 &&
				secondCompleted.draw.roundNumber === 2 &&
				secondCompleted.exclusionRecords?.length === 1 &&
				secondCompleted.exclusionRecords[0].candidateId === secondWinnerId &&
				secondCompleted.exclusionRecords[0].drawId === second.id &&
				secondCompleted.exclusionRecords[0].roundNumber === 2,
			"OFF_DRAW_METADATA_DID_NOT_REPLACE_LEDGER_AND_KEEP_COUNT",
		);
		const enableAgain = await command(host, {
			type: "options",
			excludeDrawn: true,
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			enableAgain.type === "ack" &&
				JSON.stringify(host.snapshot.excludedIds) ===
					JSON.stringify([secondWinnerId]),
			"REENABLE_EXCLUSION_CHANGED_LEDGER",
		);
		pass("on-accumulation-off-replacement-and-reenable-use-latest-winner");
		const nowEligible = await vote(late, second.id, "down");
		ensure(
			nowEligible.type === "snapshot",
			"NEXT_ROUND_PARTICIPANT_CANNOT_VOTE",
		);
		pass("previously-late-participant-can-vote-in-next-round");
		ensure(
			JSON.stringify(
				host.snapshot.history.find((entry) => entry.id === first.id),
			) === frozen,
			"ARCHIVED_DRAW_CHANGED_AFTER_NEXT_COMPLETION",
		);
		await sync(host);
		const currentResult = JSON.stringify(host.snapshot.draw);
		const existingHistory = JSON.stringify(host.snapshot.history);
		const resetExclusions = await command(host, {
			type: "reset-exclusions",
			expectedRevision: host.snapshot.revision,
		});
		ensure(
			resetExclusions.type === "ack" &&
				host.snapshot.status === "result" &&
				host.snapshot.excludedIds.length === 0 &&
				host.snapshot.exclusionRecords?.length === 0 &&
				host.snapshot.drawCount === 2 &&
				JSON.stringify(host.snapshot.draw) === currentResult &&
				JSON.stringify(host.snapshot.history) === existingHistory,
			"MANUAL_RESET_CHANGED_RESULT_OR_HISTORY",
		);
		pass("manual-exclusion-reset-preserves-current-result-and-history");
		pass("public-snapshots-contain-no-proofs-or-hashes", {
			observations: publicSnapshotCount,
		});

		activeStage = "result-time-exclusion-enable";
		const guestEnable = await command(guest, {
			type: "options",
			excludeDrawn: true,
			expectedRevision: guest.snapshot.revision,
		});
		ensure(
			guestEnable.code === "HOST_REQUIRED" &&
				host.snapshot.excludedIds.length === 0,
			"GUEST_CHANGED_RESULT_EXCLUSIONS",
		);
		pass("only-host-can-enable-result-exclusion");
		await command(host, {
			type: "options",
			excludeDrawn: false,
			expectedRevision: host.snapshot.revision,
		});
		const lateEnable = await command(host, {
			type: "options",
			excludeDrawn: true,
			expectedRevision: host.snapshot.revision,
		});
		await Promise.all([sync(host), sync(guest), sync(late)]);
		ensure(
			lateEnable.type === "ack" &&
				[host, guest, late].every(
					(client) =>
						client.snapshot.excludeDrawn === true &&
						JSON.stringify(client.snapshot.excludedIds) ===
							JSON.stringify([secondWinnerId]) &&
						client.snapshot.exclusionRecords?.length === 1 &&
						client.snapshot.exclusionRecords[0].drawId === second.id &&
						JSON.stringify(client.snapshot.draw) === currentResult &&
						JSON.stringify(client.snapshot.history) === existingHistory,
				),
			"RESULT_ENABLE_DID_NOT_SYNC_CURRENT_WINNER_OR_MUTATED_RECORDS",
		);
		pass(
			"result-enable-after-reset-syncs-current-winner-and-preserves-records",
		);
		const afterLateEnableNext = await command(host, {
			type: "next",
			drawId: second.id,
		});
		await Promise.all([sync(host), sync(guest), sync(late)]);
		ensure(
			afterLateEnableNext.type === "ack" &&
				[host, guest, late].every(
					(client) =>
						client.snapshot.status === "waiting" &&
						client.snapshot.draw === null &&
						client.snapshot.excludeDrawn === true &&
						JSON.stringify(client.snapshot.excludedIds) ===
							JSON.stringify([secondWinnerId]) &&
						JSON.stringify(client.snapshot.history[0]) === currentResult,
				),
			"RESULT_ENABLE_LOST_WINNER_ON_NEXT_GAME",
		);
		pass("result-enable-keeps-current-winner-excluded-in-next-game");

		activeStage = "explicit-room-closure";
		const deniedClose = await command(guest, { type: "room-close" });
		ensure(
			deniedClose.code === "HOST_REQUIRED" && host.snapshot.status !== "closed",
			"GUEST_CLOSED_ROOM",
		);
		pass("only-host-can-close-room");
		const joinedClients = [host, guest, late];
		const closureSnapshots = joinedClients.map((client) =>
			waitSnapshot(client, (snapshot) => snapshot.status === "closed"),
		);
		const socketClosures = joinedClients.map(serverClosure);
		const [closure] = await Promise.all([
			command(host, { type: "room-close" }),
			...closureSnapshots,
			...socketClosures,
		]);
		ensure(closure.type === "ack", "HOST_ROOM_CLOSE_REJECTED");
		pass("host-closure-acknowledged-and-all-clients-closed");
		const closedEntry = await fetch(
			`${config.origin}/api/lunch/rooms/${roomId}/entry-info`,
			{
				cache: "no-store",
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(config.timeoutMs),
				]),
			},
		);
		const closedInfo = await closedEntry.json();
		const closedNickname = await post(
			`/api/lunch/rooms/${roomId}/nickname-availability`,
			{ name: "종료검증", ...outsiderProof },
		);
		ensure(
			closedEntry.status === 410 &&
				closedInfo.code === "ROOM_CLOSED" &&
				closedNickname.status === 410 &&
				closedNickname.value.code === "ROOM_CLOSED",
			"CLOSED_ROOM_HTTP_ADMISSION_ACCEPTED",
		);
		pass("closed-room-rejects-http-entry-and-nickname-check");
		await join(hostName, hostProof, "ROOM_CLOSED");
		await join("종료검증", outsiderProof, "ROOM_CLOSED");
		pass("closed-room-rejects-host-and-guest-websocket-reentry");
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
