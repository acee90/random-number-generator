import type { ChatTrace } from "./lunchRoom";

/** Debug-only timing; cross-machine timestamps are evidence, not one-way latency. */
export function beginChatTrace() {
	if (
		typeof window === "undefined" ||
		new URLSearchParams(window.location.search).get("debugRoom") !== "1"
	)
		return;
	const diagnosticId = crypto.randomUUID();
	const clientSentAt = Date.now();
	const started = performance.now();
	let lastTick = started;
	let maxEventLoopLagMs = 0;
	let hiddenDuring = document.visibilityState !== "visible";
	let stopped = false;
	const visibility = () => {
		hiddenDuring ||= document.visibilityState !== "visible";
	};
	const timer = setInterval(() => {
		const now = performance.now();
		maxEventLoopLagMs = Math.max(maxEventLoopLagMs, now - lastTick - 100);
		lastTick = now;
	}, 100);
	document.addEventListener("visibilitychange", visibility);
	const cancel = () => {
		clearInterval(timer);
		document.removeEventListener("visibilitychange", visibility);
		stopped = true;
	};
	return {
		diagnosticId,
		cancel,
		finish(
			trace: ChatTrace | undefined,
			received: {
				at: number;
				wallAt: number;
				parsedAt: number;
				eventTimeStamp: number;
			},
		) {
			if (stopped) return;
			const acknowledgedAt = performance.now();
			// Includes a delayed final timer even when the interval callback has not run.
			maxEventLoopLagMs = Math.max(
				maxEventLoopLagMs,
				acknowledgedAt - lastTick - 100,
				0,
			);
			visibility();
			cancel();
			const server = trace?.diagnosticId === diagnosticId ? trace : undefined;
			const eventAge = received.at - received.eventTimeStamp;
			const rttMs = received.at - started;
			try {
				console.info(
					`[room chat trace] ${JSON.stringify({
						diagnosticId,
						clientSentAt,
						clientReceivedAt: received.wallAt,
						clientAckAt: Date.now(),
						rttMs,
						parseMs: received.parsedAt - received.at,
						ackHandlingMs: acknowledgedAt - received.parsedAt,
						maxEventLoopLagMs,
						hiddenDuring,
						// Event construction/dispatch age; does not measure the wire arrival time.
						eventDispatchAgeMs:
							Number.isFinite(eventAge) && eventAge >= 0 && eventAge <= rttMs
								? eventAge
								: null,
						server: server ?? null,
						// Contains transport, pre-handler waits, buffering and browser scheduling.
						outsideServerMs: server
							? Math.max(0, rttMs - server.serverTotalMs)
							: null,
						clockSynchronized: false,
					})}`,
				);
			} catch {
				/* Optional diagnostics must not affect acknowledgement. */
			}
		},
	};
}
