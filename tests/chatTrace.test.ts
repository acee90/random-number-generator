// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { beginChatTrace } from "../src/lib/chatTrace";
import type { ChatTrace } from "../src/lib/lunchRoom";

function requiredTrace() {
	const trace = beginChatTrace();
	if (!trace) throw new Error("Expected debug tracing");
	return trace;
}

beforeEach(() => {
	vi.useFakeTimers();
	window.history.replaceState(null, "", "/?debugRoom=1");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	window.history.replaceState(null, "", "/");
});

it("does not create timers or logs without opt-in", () => {
	window.history.replaceState(null, "", "/");
	expect(beginChatTrace()).toBeUndefined();
	expect(vi.getTimerCount()).toBe(0);
});
it("separates server work and browser processing, correlates only the requested diagnostic ID", () => {
	const info = vi.spyOn(console, "info").mockImplementation(() => {});
	const trace = requiredTrace();
	const server: ChatTrace = {
		diagnosticId: trace.diagnosticId,
		serverReceivedAt: Date.now() + 50000,
		serverSendAt: Date.now() + 50010,
		queueMs: 2,
		prepareMs: 3,
		saveMs: 4,
		alarmMs: 1,
		serverTotalMs: 10,
	};
	vi.advanceTimersByTime(440);
	const receivedAt = performance.now();
	vi.advanceTimersByTime(5);
	trace.finish(server, {
		at: receivedAt,
		wallAt: Date.now() - 5,
		parsedAt: receivedAt + 2,
		eventTimeStamp: receivedAt - 1,
	});
	const log = JSON.parse(
		String(info.mock.calls[0][0]).slice("[room chat trace] ".length),
	);
	expect(log).toMatchObject({
		diagnosticId: trace.diagnosticId,
		rttMs: 440,
		parseMs: 2,
		ackHandlingMs: 3,
		outsideServerMs: 430,
		clockSynchronized: false,
		eventDispatchAgeMs: 1,
		server,
	});
	expect(vi.getTimerCount()).toBe(0);
	trace.finish(server, {
		at: receivedAt,
		wallAt: Date.now(),
		parsedAt: receivedAt,
		eventTimeStamp: receivedAt,
	});
	expect(info).toHaveBeenCalledTimes(1);
});
it("cleans up cancelled requests and does not attribute a different server diagnostic", () => {
	const info = vi.spyOn(console, "info").mockImplementation(() => {});
	const trace = requiredTrace();
	const server: ChatTrace = {
		diagnosticId: crypto.randomUUID(),
		serverReceivedAt: Date.now(),
		serverSendAt: Date.now(),
		queueMs: 0,
		prepareMs: 0,
		saveMs: 0,
		alarmMs: 0,
		serverTotalMs: 0,
	};
	trace.finish(server, {
		at: performance.now(),
		wallAt: Date.now(),
		parsedAt: performance.now(),
		eventTimeStamp: 0,
	});
	expect(String(info.mock.calls[0][0])).toContain('"server":null');
	expect(String(info.mock.calls[0][0])).toContain('"outsideServerMs":null');
	const cancelled = requiredTrace();
	cancelled.cancel();
	expect(vi.getTimerCount()).toBe(0);
});
it("tracks a hidden interval even if the acknowledgement arrives after returning", () => {
	const info = vi.spyOn(console, "info").mockImplementation(() => {});
	const visibility = vi
		.spyOn(document, "visibilityState", "get")
		.mockReturnValue("visible");
	const trace = requiredTrace();
	visibility.mockReturnValue("hidden");
	document.dispatchEvent(new Event("visibilitychange"));
	visibility.mockReturnValue("visible");
	document.dispatchEvent(new Event("visibilitychange"));
	trace.finish(undefined, {
		at: performance.now(),
		wallAt: Date.now(),
		parsedAt: performance.now(),
		eventTimeStamp: 0,
	});
	expect(String(info.mock.calls[0][0])).toContain('"hiddenDuring":true');
});

it("detects an event-loop stall even if the interval has not run before the ACK", () => {
	const info = vi.spyOn(console, "info").mockImplementation(() => {});
	const now = vi.spyOn(performance, "now").mockReturnValue(0);
	const trace = requiredTrace();
	now.mockReturnValue(2200);
	trace.finish(undefined, {
		at: 2200,
		wallAt: Date.now(),
		parsedAt: 2200,
		eventTimeStamp: 2200,
	});
	const log = JSON.parse(
		String(info.mock.calls[0][0]).slice("[room chat trace] ".length),
	);
	expect(log.maxEventLoopLagMs).toBe(2100);
	expect(vi.getTimerCount()).toBe(0);
});
