import type { LunchHistoryRecord } from "./lunchHistory";
import {
	getEligibleRoomCandidates,
	lunchRoomLimits,
	type RoomDraw,
	type RoomSnapshot,
	type RoomWinSummary,
} from "./lunchRoom";

export function captureRoomCandidates(
	snapshot: Pick<RoomSnapshot, "candidates" | "gameFilter">,
) {
	const eligible = new Set(
		getEligibleRoomCandidates({ ...snapshot, excludeDrawn: false }).map(
			(candidate) => candidate.id,
		),
	);
	return new Map(
		snapshot.candidates.map(({ id, name, category }) => [
			id,
			{ name, category, eligible: eligible.has(id) },
		]),
	);
}

export function describeCandidateChange(
	before: ReturnType<typeof captureRoomCandidates>,
	after: ReturnType<typeof captureRoomCandidates>,
) {
	const removed: string[] = [],
		added: string[] = [],
		edited: string[] = [];
	for (const [id, prior] of before) {
		const next = after.get(id);
		if (!next || prior.name !== next.name) removed.push(prior.name);
		else if (prior.eligible !== next.eligible)
			(next.eligible ? added : removed).push(next.name);
		else if (prior.category !== next.category)
			edited.push(`${next.name} 분류 ${prior.category} → ${next.category}`);
	}
	for (const [id, next] of after) {
		const prior = before.get(id);
		if (!prior || prior.name !== next.name) added.push(next.name);
	}
	if (removed.length === 1 && added.length === 1 && !edited.length) {
		return removed[0] === added[0]
			? `${added[0]} 항목 교체`
			: `${removed[0]} → ${added[0]}`;
	}
	const preview = (items: string[]) =>
		items.length > 1 ? `${items[0]} 외 ${items.length - 1}개` : items[0];
	return [
		removed.length && `${preview(removed)} 제외`,
		added.length && `${preview(added)} 추가`,
		edited.length && preview(edited),
	]
		.filter(Boolean)
		.join(" · ");
}

export function summarizeRoomWin(draw: RoomDraw): RoomWinSummary {
	return {
		id: draw.id,
		name: draw.candidates[draw.winnerIndex].name,
		timestamp: draw.timestamp,
		candidateSetVersion: draw.candidateSetVersion ?? draw.listVersion,
	};
}

export function getRoomWins(
	snapshot: RoomSnapshot,
	now: number,
	showResult: boolean,
	currentOnly: boolean,
) {
	const currentVersion = snapshot.candidateSetVersion ?? snapshot.listVersion;
	const draws = new Map<string, RoomDraw>();
	const active = showResult && snapshot.draw ? [snapshot.draw] : [];
	for (const draw of [...active, ...snapshot.history]) {
		if (draws.has(draw.id) || now < draw.startedAt + draw.durationMs) continue;
		draws.set(draw.id, draw);
	}
	const recent: RoomDraw[] = [];
	const older: RoomWinSummary[] = [];
	let index = 0;
	for (const draw of draws.values()) {
		const detailed = index++ < lunchRoomLimits.maxHistory;
		if (
			currentOnly &&
			(draw.candidateSetVersion ?? draw.listVersion) !== currentVersion
		)
			continue;
		if (detailed) recent.push(draw);
		else older.push(summarizeRoomWin(draw));
	}
	for (const win of snapshot.olderWins ?? []) {
		if (!currentOnly || win.candidateSetVersion === currentVersion)
			older.push(win);
	}
	return { recent, older };
}

type TimelineStamp = { id: string; timestamp: number; version?: number };
type WinEvent = TimelineStamp &
	({ kind: "draw"; draw: RoomDraw } | { kind: "win"; name: string });
type ChangeEvent = TimelineStamp & {
	kind: "change";
	summary: string;
	exactTime: boolean;
};
export type RoomHistoryEvent = WinEvent | ChangeEvent;

function knownDrawPool(win: WinEvent, matchByName = false) {
	if (win.kind !== "draw") return null;
	const draw = win.draw;
	if (draw.excludeDrawn !== false && draw.excludedIdsBefore?.length !== 0)
		return null;
	if (!matchByName)
		return captureRoomCandidates({ candidates: draw.candidates });
	// Imported solo sessions can assign fresh IDs to the same menu.
	const counts = new Map<string, number>();
	return captureRoomCandidates({
		candidates: draw.candidates.map((candidate) => {
			const key = JSON.stringify([candidate.name, candidate.category]);
			const occurrence = (counts.get(key) ?? 0) + 1;
			counts.set(key, occurrence);
			return { ...candidate, id: `${key}-${occurrence}` };
		}),
	});
}

function importedPoolChanges(wins: WinEvent[]): ChangeEvent[] {
	wins.sort((a, b) => a.timestamp - b.timestamp);
	const changes: ChangeEvent[] = [];
	for (let i = 1; i < wins.length; i++) {
		const prior = wins[i - 1],
			next = wins[i];
		if (prior.version !== undefined && next.version !== undefined) continue;
		const before = knownDrawPool(prior, true),
			after = knownDrawPool(next, true);
		if (!before || !after) continue;
		const summary = describeCandidateChange(before, after);
		if (summary)
			changes.push({
				kind: "change",
				id: `solo-${next.id}`,
				version: next.version,
				timestamp: next.timestamp,
				summary,
				exactTime: false,
			});
	}
	return changes;
}

export function getRoomHistoryTimeline(
	snapshot: RoomSnapshot | null,
	now: number,
	showResult: boolean,
	previousDraws: readonly RoomDraw[] = [],
	legacyHistory: readonly LunchHistoryRecord[] = [],
): RoomHistoryEvent[] {
	const wins = new Map<string, WinEvent>();
	const changes = new Map<number, ChangeEvent>();
	if (snapshot) {
		const { recent, older } = getRoomWins(snapshot, now, showResult, false);
		for (const draw of recent)
			wins.set(draw.id, {
				kind: "draw",
				id: draw.id,
				timestamp: draw.timestamp,
				version: draw.candidateSetVersion ?? draw.listVersion,
				draw,
			});
		for (const win of older)
			wins.set(win.id, {
				kind: "win",
				id: win.id,
				timestamp: win.timestamp,
				version: win.candidateSetVersion,
				name: win.name,
			});
		for (const change of snapshot.candidateChanges ?? []) {
			const version = change.candidateSetVersion;
			changes.set(version, {
				kind: "change",
				id: String(version),
				version,
				timestamp: change.timestamp,
				summary: change.summary,
				exactTime: true,
			});
		}
		// Older saves record pool versions on draws, but may lack the edit time or the full pool.
		const chronological = [...wins.values()].sort(
			(a, b) =>
				a.timestamp - b.timestamp || (a.version ?? 0) - (b.version ?? 0),
		);
		const currentVersion = snapshot.candidateSetVersion ?? snapshot.listVersion;
		for (const [index, prior] of chronological.entries()) {
			const next = chronological[index + 1];
			const version = next?.version ?? currentVersion;
			if (version === prior.version || changes.has(version)) continue;
			const before = knownDrawPool(prior);
			const after = next
				? knownDrawPool(next)
				: captureRoomCandidates({
						candidates: getEligibleRoomCandidates({
							...snapshot,
							excludeDrawn: false,
						}),
					});
			changes.set(version, {
				kind: "change",
				id: String(version),
				version,
				timestamp: next?.timestamp ?? prior.timestamp,
				summary: before && after ? describeCandidateChange(before, after) : "",
				exactTime: false,
			});
		}
	}
	for (const draw of previousDraws) {
		if (!wins.has(draw.id) && now >= draw.startedAt + draw.durationMs)
			wins.set(draw.id, {
				kind: "draw",
				id: draw.id,
				timestamp: draw.timestamp,
				draw,
			});
	}
	for (const record of legacyHistory) {
		if (!wins.has(record.id))
			wins.set(record.id, {
				kind: "win",
				id: record.id,
				timestamp: record.timestamp,
				name: record.place.name,
			});
	}
	const imported = previousDraws.length
		? importedPoolChanges([...wins.values()])
		: [];
	return [...wins.values(), ...changes.values(), ...imported].sort(
		(a, b) =>
			b.timestamp - a.timestamp ||
			(b.version ?? 0) - (a.version ?? 0) ||
			Number(a.kind === "change") - Number(b.kind === "change"),
	);
}
