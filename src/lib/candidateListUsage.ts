/** Browser-local import history, separate from saved lists and room state. */
export const candidateListUsageKey = "jeommechu:candidate-list-usage:v1";
export const defaultCandidateListSourceId = "default-lunch";
export const savedCandidateListSourceId = (id: string) => `saved:${id}`;

export type CandidateListUsage = {
	recentId: string | null;
	loadedAt: Record<string, number>;
};

type UsageStorage = Pick<Storage, "getItem" | "setItem">;
const maximumEntries = 100;
const sourceIdPattern = /^(?:default-lunch|saved:[A-Za-z0-9_-]{1,80})$/;
const emptyUsage = (): CandidateListUsage => ({ recentId: null, loadedAt: {} });

function readUsage(
	storage: Pick<Storage, "getItem">,
): CandidateListUsage | null {
	const raw = storage.getItem(candidateListUsageKey);
	if (raw === null) return emptyUsage();
	if (raw.length > 20000) return null;
	const value: unknown = JSON.parse(raw);
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		record.version !== 1 ||
		typeof record.recentId !== "string" ||
		!sourceIdPattern.test(record.recentId) ||
		!record.loadedAt ||
		typeof record.loadedAt !== "object" ||
		Array.isArray(record.loadedAt)
	)
		return null;
	const entries = Object.entries(record.loadedAt);
	if (
		entries.length > maximumEntries ||
		entries.some(
			([id, time]) =>
				!sourceIdPattern.test(id) ||
				typeof time !== "number" ||
				!Number.isSafeInteger(time) ||
				time < 0 ||
				time > 8640000000000000,
		) ||
		!Object.hasOwn(record.loadedAt, record.recentId)
	)
		return null;
	return {
		recentId: record.recentId,
		loadedAt: Object.fromEntries(entries) as Record<string, number>,
	};
}

export function readCandidateListUsage(
	storage?: Pick<Storage, "getItem">,
): CandidateListUsage {
	try {
		return readUsage(storage ?? window.localStorage) ?? emptyUsage();
	} catch {
		return emptyUsage();
	}
}

/** Called only after a source has actually replaced the local editing draft. */
export function recordCandidateListUse(
	sourceId: string,
	storage?: UsageStorage,
): boolean {
	if (!sourceIdPattern.test(sourceId)) return false;
	try {
		const target = storage ?? window.localStorage;
		const current = readUsage(target);
		// Optional history must never overwrite unreadable data or block importing.
		if (!current) return false;
		const time = Date.now();
		const loadedAt = {
			[sourceId]: time,
			...Object.fromEntries(
				Object.entries(current.loadedAt)
					.filter(([id]) => id !== sourceId)
					.sort((a, b) => b[1] - a[1])
					.slice(0, maximumEntries - 1),
			),
		};
		target.setItem(
			candidateListUsageKey,
			JSON.stringify({ version: 1, recentId: sourceId, loadedAt }),
		);
		return true;
	} catch {
		return false;
	}
}
