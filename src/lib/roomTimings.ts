const stages = new Set([
	"create_http",
	"create_decode",
	"room_navigation",
	"nickname_check",
	"socket_open",
	"join_ack",
	"room_commit",
] as const);
export type RoomTimingStage =
	| "create_http"
	| "create_decode"
	| "room_navigation"
	| "nickname_check"
	| "socket_open"
	| "join_ack"
	| "room_commit";

const noop = () => {};
const enabled = (() => {
	try {
		return (
			typeof window !== "undefined" &&
			new URLSearchParams(window.location.search).get("debugRoom") === "1"
		);
	} catch {
		return false;
	}
})();

function performanceTime(): number | undefined {
	try {
		const value =
			typeof performance !== "undefined" ? performance.now() : undefined;
		return Number.isFinite(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function wallTime(): number | undefined {
	try {
		const value = Date.now();
		return Number.isFinite(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Opt-in, tab-local duration logs. Never accepts room/user/request details. */
export function beginRoomTiming(stage: RoomTimingStage): () => void {
	if (!enabled || !stages.has(stage)) return noop;
	const startedAt = performanceTime();
	const startedWallAt = wallTime();
	if (startedAt === undefined && startedWallAt === undefined) return noop;
	let stopped = false;
	return () => {
		if (stopped) return;
		stopped = true;
		try {
			const endedAt = startedAt === undefined ? undefined : performanceTime();
			const endedWallAt = wallTime();
			const elapsed =
				startedAt !== undefined && endedAt !== undefined
					? endedAt - startedAt
					: startedWallAt !== undefined && endedWallAt !== undefined
						? endedWallAt - startedWallAt
						: undefined;
			if (elapsed === undefined || !Number.isFinite(elapsed)) return;
			const durationMs = Number(Math.max(0, elapsed).toFixed(1));
			let visibility: "visible" | "hidden" | "unknown" = "unknown";
			try {
				if (
					document.visibilityState === "visible" ||
					document.visibilityState === "hidden"
				)
					visibility = document.visibilityState;
			} catch {
				// Visibility is optional in limited browser contexts.
			}
			console.info(
				`[room timing] ${JSON.stringify({ stage, durationMs, visibility })}`,
			);
		} catch {
			// Optional diagnostics must never interfere with joining or navigation.
		}
	};
}
