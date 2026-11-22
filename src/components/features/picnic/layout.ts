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
export type Control = "exclude" | "sound" | "draw" | VoteChoice;
export type StageScene = {
	toolbar?: {
		exclude: boolean;
		locked: boolean;
		sound: boolean;
		soundSupported: boolean;
	};
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
export function stageLayout(width: number, height: number, hasVotes: boolean) {
	const small = width < 360;
	const pad = small ? 8 : 14;
	const top = small ? 8 : 11;
	const wheelSide = Math.max(1, Math.min(width - 13, height - 61));
	const heroWidth = Math.min(width - (small ? 28 : 48), 505);
	const heroHeight = Math.min(177, heroWidth * 0.46);
	const voteHeight = small ? 47 : 55;
	const voteWidth = Math.min(166, (width - (small ? 25 : 40) - 12) / 2);
	const gap = small ? 20 : 27;
	const ticketTop =
		60 + (height - 72 - heroHeight - (hasVotes ? gap + voteHeight : 0)) * 0.49;
	return {
		width,
		height,
		pad,
		top,
		switchWidth: small ? 147 : 156,
		wheelSide,
		wheelY: 56 + (height - 61) / 2,
		hubSize: Math.max(48, (wheelSide * 94) / 440),
		heroWidth,
		heroHeight,
		ticketTop,
		voteTop: ticketTop + heroHeight + gap,
		voteWidth,
		voteHeight,
	};
}
export type StageLayout = ReturnType<typeof stageLayout>;
