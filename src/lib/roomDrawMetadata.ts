import {
	getRoomPhase,
	lunchRoomLimits,
	type RoomDraw,
	type RoomExclusionRecord,
	type RoomSnapshot,
} from "./lunchRoom";
import { getSpinDeadline } from "./spinDrive";

/** History is newest first; keep the current draw last without counting it twice. */
function retainedDraws(snapshot: RoomSnapshot): RoomDraw[] {
	const draws = new Map(
		[...snapshot.history].reverse().map((draw) => [draw.id, draw]),
	);
	if (snapshot.draw) draws.set(snapshot.draw.id, snapshot.draw);
	return [...draws.values()];
}

/** Clear OFF exclusions at game boundaries; a current result keeps its ledger until next. */
export function clearDisabledRoomExclusions(snapshot: RoomSnapshot): void {
	if (snapshot.excludeDrawn) return;
	snapshot.excludedIds = [];
	snapshot.exclusionRecords = [];
}

/** Upgrade old storage without inventing missing lifetime round numbers or times. */
export function hydrateRoomDrawMetadata(snapshot: RoomSnapshot): void {
	const draws = retainedDraws(snapshot);
	if (snapshot.drawCount === undefined) {
		const largestKnown = Math.max(
			0,
			...draws.map((draw) => draw.roundNumber ?? 0),
		);
		snapshot.drawCount = Math.max(draws.length, largestKnown);
		snapshot.drawCountIsExact =
			!draws.some((draw) => draw.roundNumberIsExact === false) &&
			(snapshot.history.length < lunchRoomLimits.maxHistory ||
				(largestKnown >= draws.length && largestKnown > 0));
	}
	const exact = snapshot.drawCountIsExact !== false;
	const firstNumber = snapshot.drawCount - draws.length + 1;
	draws.forEach((draw, index) => {
		if (draw.roundNumber !== undefined) return;
		draw.roundNumber = firstNumber + index;
		if (!exact) draw.roundNumberIsExact = false;
	});
	const excluded = new Set(snapshot.excludedIds ?? []);
	const records = new Map(
		(snapshot.exclusionRecords ?? [])
			.filter((record) => excluded.has(record.candidateId))
			.map((record) => [record.candidateId, record]),
	);
	for (const candidateId of excluded) {
		if (records.has(candidateId)) continue;
		const draw = [...draws]
			.reverse()
			.find((entry) => entry.candidates[entry.winnerIndex]?.id === candidateId);
		if (
			draw &&
			!(draw.drive && snapshot.status === "drawing" && draw === snapshot.draw)
		)
			records.set(candidateId, exclusionRecordFor(draw));
	}
	snapshot.exclusionRecords = [...records.values()];
	if (!snapshot.draw) clearDisabledRoomExclusions(snapshot);
}

export function exclusionRecordFor(draw: RoomDraw): RoomExclusionRecord {
	return {
		candidateId: draw.candidates[draw.winnerIndex].id,
		drawId: draw.id,
		drawnAt: getSpinDeadline(draw),
		...(draw.roundNumber === undefined
			? {}
			: { roundNumber: draw.roundNumber }),
		...(draw.roundNumberIsExact === undefined
			? {}
			: { roundNumberIsExact: draw.roundNumberIsExact }),
	};
}

/** Commit this together with the new draw; caller owns persistence and rollback. */
export function recordRoomDrawMetadata(
	snapshot: RoomSnapshot,
	draw: RoomDraw,
	excludeDrawn: boolean,
): void {
	// The previous draw is already archived before starting a new one.
	hydrateRoomDrawMetadata(snapshot);
	const nextNumber = (snapshot.drawCount ?? 0) + 1;
	if (!Number.isSafeInteger(nextNumber))
		throw new Error("Round count exhausted");
	draw.roundNumber = nextNumber;
	if (snapshot.drawCountIsExact === false) draw.roundNumberIsExact = false;
	snapshot.drawCount = nextNumber;
	const candidateId = draw.candidates[draw.winnerIndex].id;
	snapshot.excludedIds = excludeDrawn
		? [...new Set([...(snapshot.excludedIds ?? []), candidateId])]
		: [];
	snapshot.exclusionRecords = excludeDrawn
		? [
				...(snapshot.exclusionRecords ?? []).filter(
					(entry) => entry.candidateId !== candidateId,
				),
				...(draw.drive ? [] : [exclusionRecordFor(draw)]),
			]
		: [];
}

export function recordFinishedDriveExclusion(
	snapshot: RoomSnapshot,
	draw: RoomDraw,
) {
	if (!draw.drive || !draw.excludeDrawn) return;
	const record = exclusionRecordFor(draw);
	snapshot.exclusionRecords = [...(snapshot.exclusionRecords ?? []), record];
}

/** Apply the live option without rewriting the immutable draw's original rules. */
export function setRoomExcludeDrawn(
	snapshot: RoomSnapshot,
	enabled: boolean,
): void {
	snapshot.excludeDrawn = enabled;
	const draw = snapshot.draw;
	if (!enabled || !draw || getRoomPhase(snapshot) !== "result") return;
	const winner = draw.candidates[draw.winnerIndex];
	if (
		!winner ||
		!snapshot.candidates.some((candidate) => candidate.id === winner.id)
	)
		return;
	snapshot.excludedIds = [
		...new Set([...(snapshot.excludedIds ?? []), winner.id]),
	];
	snapshot.exclusionRecords = [
		...(snapshot.exclusionRecords ?? []).filter(
			(record) => record.candidateId !== winner.id,
		),
		exclusionRecordFor(draw),
	];
}

/** Do not publish the next winning exclusion before its reveal time. */
export function visibleRoomExclusions(
	snapshot: RoomSnapshot,
): Pick<RoomSnapshot, "excludedIds" | "exclusionRecords"> {
	const excludedIds =
		snapshot.status === "drawing" && snapshot.draw
			? snapshot.draw.excludeDrawn
				? (snapshot.draw.excludedIdsBefore ?? [])
				: []
			: (snapshot.excludedIds ?? []);
	const ids = new Set(excludedIds);
	return {
		excludedIds,
		exclusionRecords: snapshot.exclusionRecords?.filter((record) =>
			ids.has(record.candidateId),
		),
	};
}
