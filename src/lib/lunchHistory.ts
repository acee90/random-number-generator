import type { RandomSource } from "@/services/randomCore";
import { type LunchCategory, type LunchPlace, lunchCategories } from "./lunch";

export const lunchHistoryKey = "randomlab:lunch-history:v1";
export const lunchHistoryLimit = 20;

export interface LunchHistoryRecord {
	id: string;
	place: LunchPlace;
	source: RandomSource;
	candidateCount: number;
	timestamp: number;
}

type HistoryReader = { getItem: (key: string) => string | null };
type HistoryWriter = { setItem: (key: string, value: string) => void };

const sources: readonly RandomSource[] = [
	"quantum",
	"atmospheric",
	"csprng",
	"mixed",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return (
		typeof value === "string" && value.trim().length > 0 && value.length <= 200
	);
}

function parsePlace(value: unknown): LunchPlace | undefined {
	if (
		!isRecord(value) ||
		!isText(value.id) ||
		!isText(value.name) ||
		!lunchCategories.some((category) => category === value.category) ||
		(value.menu !== undefined && !isText(value.menu)) ||
		(value.distanceMeters !== undefined &&
			(!Number.isSafeInteger(value.distanceMeters) ||
				(value.distanceMeters as number) < 0))
	)
		return undefined;
	return {
		id: value.id,
		name: value.name,
		category: value.category as LunchCategory,
		...(value.menu !== undefined ? { menu: value.menu as string } : {}),
		...(value.distanceMeters !== undefined
			? { distanceMeters: value.distanceMeters as number }
			: {}),
	};
}

function parseHistoryRecord(value: unknown): LunchHistoryRecord | undefined {
	if (
		!isRecord(value) ||
		!isText(value.id) ||
		!Number.isSafeInteger(value.timestamp) ||
		(value.timestamp as number) < 0 ||
		!Number.isFinite(new Date(value.timestamp as number).getTime()) ||
		!Number.isSafeInteger(value.candidateCount) ||
		(value.candidateCount as number) < 2 ||
		!sources.some((source) => source === value.source)
	)
		return undefined;
	const place = parsePlace(value.place);
	if (!place) return undefined;
	return {
		id: value.id,
		place,
		source: value.source as RandomSource,
		candidateCount: value.candidateCount as number,
		timestamp: value.timestamp as number,
	};
}

function normalizeHistory(value: unknown): LunchHistoryRecord[] {
	if (!Array.isArray(value)) return [];
	const records = value
		.map(parseHistoryRecord)
		.filter((record): record is LunchHistoryRecord => record !== undefined)
		.sort((left, right) => right.timestamp - left.timestamp);
	const seen = new Set<string>();
	return records
		.filter((record) => {
			if (seen.has(record.id)) return false;
			seen.add(record.id);
			return true;
		})
		.slice(0, lunchHistoryLimit);
}

export function readLunchHistory(
	storage?: HistoryReader,
): LunchHistoryRecord[] {
	try {
		const target = storage ?? globalThis.localStorage;
		if (!target) return [];
		const saved = target.getItem(lunchHistoryKey);
		return saved === null ? [] : normalizeHistory(JSON.parse(saved));
	} catch {
		return [];
	}
}

export function appendLunchHistory(
	history: readonly LunchHistoryRecord[],
	record: LunchHistoryRecord,
): LunchHistoryRecord[] {
	const existing = normalizeHistory(history);
	const next = parseHistoryRecord(record);
	if (!next || existing.some((entry) => entry.id === next.id)) return existing;
	return normalizeHistory([next, ...existing]);
}

export function writeLunchHistory(
	storage: HistoryWriter | undefined,
	history: readonly LunchHistoryRecord[],
): boolean {
	try {
		const target = storage ?? globalThis.localStorage;
		if (!target || !Array.isArray(history)) return false;
		target.setItem(lunchHistoryKey, JSON.stringify(normalizeHistory(history)));
		return true;
	} catch {
		return false;
	}
}
