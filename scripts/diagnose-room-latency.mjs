#!/usr/bin/env node
// Creates one disposable room. Never accepts an existing room or credentials.
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import WebSocket from "ws";

const defaults = {
	origin: "https://jeommechu.dev",
	samples: 5,
	timeoutMs: 20_000,
};
const runTimeoutMs = 180_000;
const hostName = "진단방장";
const guestName = "진단참가자";
const emit = (event, values = {}) =>
	console.log(JSON.stringify({ event, ...values }));
const fault = (code) => Object.assign(new Error(code), { publicCode: code });
const publicCodes = new Set([
	"INVALID_CLI_ARGUMENT",
	"INVALID_ORIGIN",
	"INVALID_SAMPLES",
	"INVALID_TIMEOUT",
	"RUN_TIMEOUT",
	"INTERRUPTED",
	"HTTP_REQUEST_FAILED",
	"HTTP_BODY_TOO_LARGE",
	"INVALID_HTTP_RESPONSE",
	"CREATE_FAILED",
	"INVALID_CREATE_RESPONSE",
	"BASELINE_FAILED",
	"NICKNAME_CHECK_FAILED",
	"SOCKET_OPEN_FAILED",
	"SOCKET_CLOSED",
	"SOCKET_SEND_FAILED",
	"MESSAGE_TIMEOUT",
	"INVALID_SERVER_MESSAGE",
	"SERVER_MESSAGE_ERROR",
	"JOIN_FAILED",
	"CHECK_FAILED",
]);
const safeCode = (error) =>
	publicCodes.has(error?.publicCode) ? error.publicCode : "CHECK_FAILED";
function ensure(condition, code) {
	if (!condition) throw fault(code);
}
function options(args) {
	const config = { ...defaults };
	const seen = new Set();
	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg === "--help" || arg === "-h") {
			console.log(
				"Usage: node scripts/diagnose-room-latency.mjs [--origin http(s)://host] [--samples 5] [--timeout-ms 20000]\n" +
					"Creates one isolated room, checks nicknames, opens two sockets, measures ping and chat, then closes all sockets. No draws.\n" +
					"Samples: 1-10. Per-request timeout: 1000-30000ms. Entire run: at most 180 seconds plus socket cleanup.\n" +
					"Origin must have no credentials, path, query or fragment. Existing room IDs and credentials are not accepted.\n" +
					"JSON output excludes room IDs, names, message contents, IPs, URLs and credentials. Test data expires under the room TTL.",
			);
			return null;
		}
		ensure(
			["--origin", "--samples", "--timeout-ms"].includes(arg) &&
				!seen.has(arg) &&
				index + 1 < args.length,
			"INVALID_CLI_ARGUMENT",
		);
		seen.add(arg);
		const value = args[++index];
		if (arg === "--origin") config.origin = value;
		else if (arg === "--samples") config.samples = Number(value);
		else config.timeoutMs = Number(value);
	}
	let url;
	try {
		url = new URL(config.origin);
	} catch {
		throw fault("INVALID_ORIGIN");
	}
	ensure(
		/^https?:\/\/[^\s/?#]+\/?$/.test(config.origin) &&
			!url.username &&
			!url.password &&
			url.pathname === "/" &&
			!url.search &&
			!url.hash,
		"INVALID_ORIGIN",
	);
	ensure(
		Number.isInteger(config.samples) &&
			config.samples >= 1 &&
			config.samples <= 10,
		"INVALID_SAMPLES",
	);
	ensure(
		Number.isInteger(config.timeoutMs) &&
			config.timeoutMs >= 1_000 &&
			config.timeoutMs <= 30_000,
		"INVALID_TIMEOUT",
	);
	return { ...config, origin: url.origin };
}
function distribution(values) {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length) return { n: 0 };
	const middle = Math.floor(sorted.length / 2);
	const round = (value) => Math.round(value * 10) / 10;
	return {
		n: sorted.length,
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
function metadata(headers) {
	const ray = headers.get("cf-ray");
	const result = {};
	if (ray && /^[a-f0-9]{16,32}-[A-Z]{3}$/i.test(ray)) result.cfRay = ray;
	const timing = headers.get("server-timing") ?? "";
	const durations = {};
	for (const item of timing.split(",")) {
		const match = item
			.trim()
			.match(/^(nickname|room|worker);\s*dur=(\d+(?:\.\d+)?)$/);
		if (
			match &&
			Number.isFinite(Number(match[2])) &&
			Number(match[2]) <= runTimeoutMs
		)
			durations[match[1]] = Number(match[2]);
	}
	if (Object.keys(durations).length) result.serverTimingMs = durations;
	return result;
}

async function run(config) {
	const started = performance.now();
	const controller = new AbortController();
	const clients = [];
	const timings = {
		create: [],
		baseline: [],
		nickname: [],
		socketOpen: [],
		joinAck: [],
		ping: [],
		chatSenderEcho: [],
		chatPeerEcho: [],
	};
	const serverTimings = { nickname: [], room: [], worker: [] };
	let stage = "trace";
	const deadline = setTimeout(
		() => controller.abort(fault("RUN_TIMEOUT")),
		runTimeoutMs,
	);
	const interrupted = () => controller.abort(fault("INTERRUPTED"));
	process.once("SIGINT", interrupted);
	process.once("SIGTERM", interrupted);
	const record = (metric, ms, extra = {}) => {
		timings[metric].push(ms);
		emit("sample", { metric, durationMs: Math.round(ms * 10) / 10, ...extra });
	};
	async function http(path, body, metric) {
		controller.signal.throwIfAborted();
		const start = performance.now();
		try {
			const response = await fetch(config.origin + path, {
				method: body === undefined ? "GET" : "POST",
				headers:
					body === undefined
						? {}
						: { Origin: config.origin, "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				redirect: "error",
				signal: AbortSignal.any([
					controller.signal,
					AbortSignal.timeout(config.timeoutMs),
				]),
			});
			const meta = metadata(response.headers);
			const reader = response.body?.getReader();
			const chunks = [];
			let length = 0;
			if (reader) {
				try {
					for (;;) {
						const part = await reader.read();
						if (part.done) break;
						length += part.value.byteLength;
						if (length > 256_000) {
							await reader.cancel();
							throw fault("HTTP_BODY_TOO_LARGE");
						}
						chunks.push(part.value);
					}
				} finally {
					reader.releaseLock();
				}
			}
			const text = Buffer.concat(chunks).toString("utf8");
			if (metric)
				record(metric, performance.now() - start, {
					status: response.status,
					...meta,
				});
			if (metric === "nickname" && meta.serverTimingMs)
				for (const [name, ms] of Object.entries(meta.serverTimingMs))
					serverTimings[name].push(ms);
			return { status: response.status, text, meta };
		} catch (error) {
			if (controller.signal.aborted) throw controller.signal.reason;
			throw publicCodes.has(error?.publicCode)
				? error
				: fault("HTTP_REQUEST_FAILED");
		}
	}
	function json(result) {
		try {
			return JSON.parse(result.text);
		} catch {
			throw fault("INVALID_HTTP_RESPONSE");
		}
	}
	function waitMessage(client, predicate) {
		const pending = new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => finish(fault("MESSAGE_TIMEOUT")),
				config.timeoutMs,
			);
			function finish(error, message) {
				clearTimeout(timer);
				client.listeners.delete(onMessage);
				controller.signal.removeEventListener("abort", onAbort);
				error ? reject(error) : resolve(message);
			}
			function onAbort() {
				finish(controller.signal.reason);
			}
			function onMessage(message) {
				if (message.type === "__closed") return finish(fault("SOCKET_CLOSED"));
				if (message.type === "error")
					return finish(fault("SERVER_MESSAGE_ERROR"));
				try {
					if (predicate(message)) finish(null, message);
				} catch {
					finish(fault("INVALID_SERVER_MESSAGE"));
				}
			}
			client.listeners.add(onMessage);
			controller.signal.addEventListener("abort", onAbort, { once: true });
			if (controller.signal.aborted) onAbort();
			else if (client.closed) finish(fault("SOCKET_CLOSED"));
		});
		// A send failure can abort a waiter before its caller reaches await.
		pending.catch(() => {});
		return pending;
	}
	function send(client, message) {
		controller.signal.throwIfAborted();
		ensure(client.ws.readyState === WebSocket.OPEN, "SOCKET_CLOSED");
		try {
			client.ws.send(JSON.stringify(message));
		} catch {
			throw fault("SOCKET_SEND_FAILED");
		}
	}
	async function join(roomId, name, proof, scope) {
		const start = performance.now();
		const ws = new WebSocket(
			`${config.origin.replace(/^http/, "ws")}/parties/lunch-rooms/${roomId}?_pk=${randomUUID()}`,
			{
				origin: config.origin,
				handshakeTimeout: config.timeoutMs,
				maxPayload: 1_024_000,
				followRedirects: false,
			},
		);
		const client = { ws, listeners: new Set(), closed: false, self: null };
		clients.push(client);
		ws.on("upgrade", (response) => {
			const meta = metadata(new Headers(response.headers));
			emit("socket_upgrade", { scope, ...meta });
		});
		ws.on("message", (raw) => {
			let message;
			try {
				message = JSON.parse(raw.toString());
				ensure(
					message &&
						typeof message === "object" &&
						typeof message.type === "string",
					"INVALID_SERVER_MESSAGE",
				);
			} catch {
				controller.abort(fault("INVALID_SERVER_MESSAGE"));
				return;
			}
			for (const listener of [...client.listeners]) listener(message);
		});
		const disconnected = () => {
			client.closed = true;
			for (const listener of [...client.listeners])
				listener({ type: "__closed" });
		};
		ws.on("error", disconnected);
		ws.on("close", disconnected);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(
				() => finish(fault("SOCKET_OPEN_FAILED")),
				config.timeoutMs,
			);
			function finish(error) {
				clearTimeout(timer);
				ws.off("open", onOpen);
				ws.off("error", onError);
				ws.off("close", onError);
				controller.signal.removeEventListener("abort", onAbort);
				error ? reject(error) : resolve();
			}
			function onOpen() {
				finish();
			}
			function onError() {
				finish(fault("SOCKET_OPEN_FAILED"));
			}
			function onAbort() {
				finish(controller.signal.reason);
			}
			ws.once("open", onOpen);
			ws.once("error", onError);
			ws.once("close", onError);
			controller.signal.addEventListener("abort", onAbort, { once: true });
			if (controller.signal.aborted) onAbort();
		});
		record("socketOpen", performance.now() - start, { scope });
		const ack = waitMessage(
			client,
			(message) => message.type === "snapshot" && message.self,
		);
		const joinStart = performance.now();
		send(client, { type: "join", name, ...proof });
		const message = await ack;
		ensure(
			typeof message.self?.id === "string" &&
				message.self.isHost === (scope === "host"),
			"JOIN_FAILED",
		);
		client.self = message.self;
		record("joinAck", performance.now() - joinStart, { scope });
		return client;
	}
	async function pause(ms) {
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => finish(), ms);
			function finish(error) {
				clearTimeout(timer);
				controller.signal.removeEventListener("abort", onAbort);
				error ? reject(error) : resolve();
			}
			function onAbort() {
				finish(controller.signal.reason);
			}
			controller.signal.addEventListener("abort", onAbort, { once: true });
			if (controller.signal.aborted) onAbort();
		});
	}
	async function close(client) {
		if (client.ws.readyState === WebSocket.CLOSED) return;
		await new Promise((resolve) => {
			const timer = setTimeout(() => {
				client.ws.terminate();
				resolve();
			}, 1_500);
			client.ws.once("close", () => {
				clearTimeout(timer);
				resolve();
			});
			if (client.ws.readyState === WebSocket.OPEN)
				client.ws.close(1000, "Diagnostic complete");
			else client.ws.terminate();
		});
	}
	try {
		try {
			const trace = await http("/cdn-cgi/trace");
			const values = Object.fromEntries(
				trace.text.split("\n").map((line) => line.split("=", 2)),
			);
			const safe = {};
			if (/^[A-Z]{3}$/.test(values.colo)) safe.colo = values.colo;
			if (/^[A-Z]{2}$/.test(values.loc)) safe.loc = values.loc;
			if (/^(on|off|plus)$/.test(values.warp)) safe.warp = values.warp;
			emit("trace", { status: trace.status, ...safe, ...trace.meta });
		} catch {
			controller.signal.throwIfAborted();
			emit("notice", { code: "TRACE_UNAVAILABLE" });
		}
		stage = "create";
		const createdResponse = await http(
			"/api/lunch/rooms",
			{
				title: "네트워크 지연 진단",
				hostName,
				candidateIds: [
					"seonjeongneung-01",
					"seonjeongneung-02",
					"seonjeongneung-03",
				],
			},
			"create",
		);
		ensure(createdResponse.status === 201, "CREATE_FAILED");
		const created = json(createdResponse);
		ensure(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				created.roomId,
			) && /^[a-f0-9]{64}$/i.test(created.hostToken),
			"INVALID_CREATE_RESPONSE",
		);
		const guestProof = { guestToken: `diagnostic-${randomUUID()}` };
		for (let index = 0; index < config.samples; index++) {
			stage = "baseline";
			const baseline = await http("/api/lunch/rooms", undefined, "baseline");
			ensure(baseline.status === 405, "BASELINE_FAILED");
			stage = "nickname";
			const result = await http(
				`/api/lunch/rooms/${created.roomId}/nickname-availability`,
				{ name: guestName, ...guestProof },
				"nickname",
			);
			ensure(result.status === 200, "NICKNAME_CHECK_FAILED");
			const available = json(result);
			ensure(
				available.name === guestName && available.available === true,
				"NICKNAME_CHECK_FAILED",
			);
		}
		stage = "host_join";
		const host = await join(
			created.roomId,
			hostName,
			{ hostToken: created.hostToken },
			"host",
		);
		stage = "guest_join";
		const guest = await join(created.roomId, guestName, guestProof, "guest");
		for (let index = 0; index < config.samples; index++) {
			stage = "ping";
			const clientTime = Date.now();
			const pong = waitMessage(
				host,
				(message) =>
					message.type === "pong" && message.clientTime === clientTime,
			);
			const pingStart = performance.now();
			send(host, { type: "ping", clientTime });
			await pong;
			record("ping", performance.now() - pingStart);
			stage = "chat";
			const id = randomUUID();
			const matches = (message) =>
				message.type === "snapshot" &&
				Array.isArray(message.snapshot?.messages) &&
				message.snapshot.messages.some(
					(entry) => entry.id === id && entry.participantId === host.self.id,
				);
			const chatStart = performance.now();
			const responses = Promise.all([
				waitMessage(host, matches).then(() =>
					record("chatSenderEcho", performance.now() - chatStart),
				),
				waitMessage(guest, matches).then(() =>
					record("chatPeerEcho", performance.now() - chatStart),
				),
			]);
			responses.catch(() => {});
			send(host, { type: "chat", id, text: `지연 진단 ${index + 1}` });
			await responses;
			if (index + 1 < config.samples) await pause(900);
		}
		emit("summary", {
			elapsedMs: Math.round(performance.now() - started),
			timings: Object.fromEntries(
				Object.entries(timings).map(([name, values]) => [
					name,
					distribution(values),
				]),
			),
			serverTimingMs: Object.fromEntries(
				Object.entries(serverTimings).map(([name, values]) => [
					name,
					distribution(values),
				]),
			),
			note: "Single network and one isolated room; small samples are not a load test or SLA. HTTP includes transport and decoding; nickname excludes the UI debounce. Server timing scopes overlap and are not additive. CF-Ray/colo identifies request processing, not Durable Object location. Chat echo measures server acknowledgement, not optimistic UI rendering.",
		});
	} catch (error) {
		emit("failed", {
			stage,
			code: safeCode(error),
			elapsedMs: Math.round(performance.now() - started),
		});
		process.exitCode = 1;
	} finally {
		clearTimeout(deadline);
		controller.abort(fault("CHECK_FAILED"));
		process.removeListener("SIGINT", interrupted);
		process.removeListener("SIGTERM", interrupted);
		await Promise.all(clients.map(close));
	}
}

try {
	const config = options(process.argv.slice(2));
	if (config) await run(config);
} catch (error) {
	emit("failed", { stage: "options", code: safeCode(error) });
	process.exitCode = 1;
}
