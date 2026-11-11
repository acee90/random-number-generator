export const lotterySettingsKey = "randomlab.lottery-settings";

export interface LotterySettings {
	lottoGameCount: number;
	pensionGameCount: number;
	group: string;
	lottoMode: "random" | "spread" | "fixed";
	fixedNumbers: number[];
	excludedNumbers: number[];
	spreadRemainder: boolean;
}

function validGameCount(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 5
	);
}

function validNumbers(value: unknown, maximum: number): value is number[] {
	return (
		Array.isArray(value) &&
		value.length <= maximum &&
		Array.from(value).every(
			(number) => Number.isInteger(number) && number >= 1 && number <= 45,
		) &&
		new Set(value).size === value.length
	);
}

export function parseLotterySettings(value: unknown): LotterySettings {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Invalid saved lottery settings");
	}
	const settings = value as Partial<LotterySettings>;
	if (
		!validGameCount(settings.lottoGameCount) ||
		!validGameCount(settings.pensionGameCount) ||
		typeof settings.group !== "string" ||
		!["random", "all", "1", "2", "3", "4", "5"].includes(settings.group) ||
		typeof settings.lottoMode !== "string" ||
		!["random", "spread", "fixed"].includes(settings.lottoMode) ||
		!validNumbers(settings.fixedNumbers, 5) ||
		!validNumbers(settings.excludedNumbers, 39) ||
		settings.fixedNumbers.some((number) =>
			settings.excludedNumbers?.includes(number),
		) ||
		typeof settings.spreadRemainder !== "boolean"
	) {
		throw new Error("Invalid saved lottery settings");
	}
	return {
		lottoGameCount: settings.lottoGameCount,
		pensionGameCount: settings.group === "all" ? 5 : settings.pensionGameCount,
		group: settings.group,
		lottoMode: settings.lottoMode,
		fixedNumbers: [...settings.fixedNumbers].sort((a, b) => a - b),
		excludedNumbers: [...settings.excludedNumbers].sort((a, b) => a - b),
		spreadRemainder: settings.spreadRemainder,
	};
}
