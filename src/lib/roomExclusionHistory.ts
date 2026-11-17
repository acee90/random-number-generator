import {
	getRoomPhase,
	type RoomCandidate,
	type RoomDraw,
	type RoomExclusionRecord,
	type RoomSnapshot,
} from "./lunchRoom";

export type RoomExclusionHistoryEntry = {
	candidate: RoomCandidate;
	record?: RoomExclusionRecord;
};

function validTime(value: number) {
	return (
		Number.isSafeInteger(value) &&
		value >= 0 &&
		Number.isFinite(new Date(value).getTime())
	);
}

function recordForDraw(draw: RoomDraw): RoomExclusionRecord | undefined {
	const winner = draw.candidates[draw.winnerIndex];
	const drawnAt = draw.startedAt + draw.durationMs;
	if (!winner || !validTime(drawnAt)) return undefined;
	return {
		candidateId: winner.id,
		drawId: draw.id,
		drawnAt,
		...(draw.roundNumber === undefined
			? {}
			: { roundNumber: draw.roundNumber }),
		...(draw.roundNumberIsExact === undefined
			? {}
			: { roundNumberIsExact: draw.roundNumberIsExact }),
	};
}

/**
 * The exclusion IDs remain authoritative. Metadata only describes those IDs;
 * missing older history never removes an excluded candidate or invents a date.
 */
export function getRoomExclusionHistory(
	snapshot: RoomSnapshot | null,
): RoomExclusionHistoryEntry[] {
	if (!snapshot) return [];
	const candidates = new Map(
		snapshot.candidates.map((candidate) => [candidate.id, candidate]),
	);
	const excludedIds = [...new Set(snapshot.excludedIds ?? [])].filter((id) =>
		candidates.has(id),
	);
	const excluded = new Set(excludedIds);
	const records = new Map<string, RoomExclusionRecord>();
	function addRecord(record: RoomExclusionRecord) {
		if (!excluded.has(record.candidateId) || !validTime(record.drawnAt)) return;
		const previous = records.get(record.candidateId);
		if (
			!previous ||
			record.drawnAt > previous.drawnAt ||
			(record.drawnAt === previous.drawnAt &&
				(record.roundNumber ?? 0) > (previous.roundNumber ?? 0))
		)
			records.set(record.candidateId, record);
	}
	for (const record of snapshot.exclusionRecords ?? []) addRecord(record);
	const phase = getRoomPhase(snapshot);
	const retained = [
		...(snapshot.draw && !["fetching", "drawing"].includes(phase)
			? [snapshot.draw]
			: []),
		...snapshot.history,
	].sort(
		(left, right) =>
			right.startedAt + right.durationMs - left.startedAt - left.durationMs,
	);
	for (const draw of retained) {
		const record = recordForDraw(draw);
		if (record && !records.has(record.candidateId)) addRecord(record);
	}
	const rows = excludedIds.reverse().flatMap((id) => {
		const candidate = candidates.get(id);
		return candidate ? [{ candidate, record: records.get(id) }] : [];
	});
	// Old IDs are stored in draw order even after history retention removes their
	// dates. Keep that reliable ordering for a partially known legacy ledger.
	if (rows.every((entry) => entry.record))
		rows.sort((left, right) => {
			if (!left.record || !right.record) return 0;
			return right.record.drawnAt - left.record.drawnAt;
		});
	return rows;
}

export function roomExclusionRoundLabel(record?: RoomExclusionRecord): string {
	if (record?.roundNumber === undefined) return "이전 추첨";
	return record.roundNumberIsExact === false
		? `기록 ${record.roundNumber}번째`
		: `${record.roundNumber}회차 당첨`;
}
