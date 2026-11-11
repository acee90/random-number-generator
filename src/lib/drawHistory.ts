import type { RandomSource } from "@/services/randomCore";

export type Mode = "number" | "lotto" | "pension";
export type Row = { numbers: number[]; group?: number };
export type LottoOptions = {
	mode: "random" | "spread" | "fixed";
	fixedNumbers: number[];
	excludedNumbers?: number[];
	spreadRemainder: boolean;
};
export type Draw = {
	id: string;
	kind: Mode;
	rows: Row[];
	source: RandomSource;
	timestamp: number;
	lottoOptions?: LottoOptions;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSelection(value: unknown, maximum: number): value is number[] {
	return (
		Array.isArray(value) &&
		value.length <= maximum &&
		Array.from(value).every(
			(number) => Number.isInteger(number) && number >= 1 && number <= 45,
		) &&
		new Set(value).size === value.length
	);
}

export function isLottoOptions(value: unknown): value is LottoOptions {
	if (!isRecord(value)) return false;
	const options = value as LottoOptions;
	return (
		["random", "spread", "fixed"].includes(options.mode) &&
		isSelection(options.fixedNumbers, 5) &&
		(options.excludedNumbers === undefined ||
			(isSelection(options.excludedNumbers, 39) &&
				options.excludedNumbers.every(
					(number) => !options.fixedNumbers.includes(number),
				))) &&
		typeof options.spreadRemainder === "boolean"
	);
}

function isRow(value: unknown, kind: Mode): value is Row {
	if (!isRecord(value) || !Array.isArray(value.numbers)) return false;
	if (kind === "number") {
		if (value.numbers.length < 1 || value.numbers.length > 100) return false;
	} else if (value.numbers.length !== 6) return false;
	const numbers = Array.from(value.numbers);
	if (kind === "number") {
		return numbers.every(Number.isSafeInteger);
	}
	if (kind === "lotto") return isSelection(numbers, 6);
	return (
		Number.isInteger(value.group) &&
		(value.group as number) >= 1 &&
		(value.group as number) <= 5 &&
		numbers.every(
			(number) => Number.isInteger(number) && number >= 0 && number <= 9,
		)
	);
}

function matchesLottoOptions(draw: Draw): boolean {
	const options = draw.lottoOptions;
	if (!options) return true;
	const fixed = options.mode === "fixed" ? options.fixedNumbers : [];
	if (options.mode === "fixed" && !fixed.length) return false;
	if (
		draw.rows.some(
			({ numbers }) =>
				fixed.some((number) => !numbers.includes(number)) ||
				options.excludedNumbers?.some((number) => numbers.includes(number)),
		)
	)
		return false;
	if (
		options.mode === "spread" ||
		(options.mode === "fixed" && options.spreadRemainder)
	) {
		const remaining = draw.rows.flatMap(({ numbers }) =>
			numbers.filter((number) => !fixed.includes(number)),
		);
		return new Set(remaining).size === remaining.length;
	}
	return true;
}

export function isDraw(value: unknown): value is Draw {
	if (!isRecord(value)) return false;
	const draw = value as Draw;
	return (
		typeof draw.id === "string" &&
		draw.id.trim().length > 0 &&
		["number", "lotto", "pension"].includes(draw.kind) &&
		Number.isSafeInteger(draw.timestamp) &&
		Number.isFinite(new Date(draw.timestamp).getTime()) &&
		(draw.lottoOptions === undefined || isLottoOptions(draw.lottoOptions)) &&
		["quantum", "atmospheric", "csprng", "mixed"].includes(draw.source) &&
		Array.isArray(draw.rows) &&
		draw.rows.length >= 1 &&
		draw.rows.length <= (draw.kind === "number" ? 1 : 5) &&
		Array.from(draw.rows).every((row) => isRow(row, draw.kind)) &&
		(draw.kind !== "lotto" || matchesLottoOptions(draw))
	);
}
