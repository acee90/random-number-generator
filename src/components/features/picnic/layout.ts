import type { LunchPlace } from "@/lib/lunch";

export type WheelLabel = { id: string; number: number; name: string };
const maximumReadableLabels = Math.floor((2 * Math.PI * 112) / 6);

export function getWheelLabels(
	candidates: readonly LunchPlace[],
	numbers: readonly number[],
): WheelLabel[] {
	if (candidates.length > maximumReadableLabels) return [];
	return candidates.map((place, index) => {
		const letters = Array.from(place.name);
		return {
			id: place.id,
			number: numbers[index] ?? index + 1,
			name:
				letters.length > 5 ? `${letters.slice(0, 4).join("")}…` : place.name,
		};
	});
}

export type VoteChoice = "up" | "down";
export type Control = "sound" | "draw" | VoteChoice;
export type StageScene = {
	/** The ticket or wheel occupies the top of the same canvas as the lists. */
	mainHeight?: number;
	voteMotionRound?: string;
	sound?: { enabled: boolean; supported: boolean };
	wheel: {
		labels: readonly WheelLabel[];
		count: number;
		caption: string;
		disabled: boolean;
		phase: "spinning" | "fetching" | "idle" | "done";
	};
	result: {
		name: string;
		category: string;
		number: number;
		votes?: {
			up: number;
			down: number;
			selected?: VoteChoice;
			enabled: boolean;
		};
	} | null;
	hover: Control | null;
	pressed: Control | null;
};

// Logical CSS pixels, shared by the drawing and its keyboard/pointer targets.
export function stageLayout(width: number, height: number) {
	const small = width < 360;
	const pad = small ? 8 : 14;
	const top = small ? 8 : 11;
	const wheelSide = Math.max(1, Math.min(width - 13, height - 61));
	const heroWidth = Math.min(width - (small ? 24 : 48), 568);
	const heroHeight = Math.min(164, heroWidth * 0.46);
	const ticketTop = small ? 70 : 78;
	return {
		width,
		height,
		pad,
		top,
		wheelSide,
		wheelY: 56 + (height - 61) / 2,
		hubSize: Math.max(48, (wheelSide * 94) / 440),
		heroWidth,
		heroHeight,
		ticketTop,
	};
}
export type StageLayout = ReturnType<typeof stageLayout>;
