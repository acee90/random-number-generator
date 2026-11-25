import type { LunchPlace } from "@/lib/lunch";

export type WheelLabel = { id: string; number: number; name: string };
export const wheelFaceRadius = 173;
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

/** The painted disc and the SVG use the same radial tracks for numbers and names. */
export function layoutWheelLabels(labels: readonly WheelLabel[], side: number) {
	const count = labels.length;
	const step = (2 * Math.PI) / Math.max(1, count);
	const scale = Math.max(side, 1) / 440;
	const roomy = count <= 6;
	const showNames = roomy || step * 115 * scale >= 12;
	const numberSize = showNames
		? Math.min(roomy ? 16 : 13, step * 100)
		: Math.min(18, Math.max(12, 10 / scale));
	const badgeHeight = showNames ? numberSize + (roomy ? 6 : 3) : 0;
	const digits = Math.max(
		1,
		...labels.map(({ number }) => String(number).length),
	);
	const badgeWidth = Math.max(
		badgeHeight,
		digits * numberSize * 0.68 + (showNames ? 6 : 0),
	);
	const numberRadius = wheelFaceRadius - 8 - badgeWidth / 2;
	const innerNumberEdge = numberRadius - badgeWidth / 2;
	const nameOffset = badgeWidth / 2 + (roomy ? 6 : 4);
	const longestName = Math.max(
		1,
		...labels.map(({ name }) => Array.from(name).length),
	);
	// Leave the hub clear, and keep glyphs inside the narrow end of each wedge.
	const nameSize = Math.min(
		roomy ? 21 : 17,
		step * 92,
		(numberRadius - nameOffset - 64) / longestName,
	);
	// At the inner edge, allow for digit cap height and a gap between neighbors.
	const numberPitch = numberSize * 0.85 + 1;
	const stride = showNames
		? 1
		: Math.max(1, Math.ceil(numberPitch / (step * innerNumberEdge)));
	const visible = Math.floor(count / stride);
	const items = Array.from({ length: visible }, (_, slot) => {
		const index = Math.floor((slot * count) / visible);
		const angle = ((index + 0.5) * 360) / count - 90;
		const radians = (angle * Math.PI) / 180;
		const nameOnRight = angle > 90;
		return {
			label: labels[index],
			// Round SVG coordinates so SSR and the browser agree across math engines.
			x: Number((numberRadius * Math.cos(radians)).toFixed(4)),
			y: Number((numberRadius * Math.sin(radians)).toFixed(4)),
			rotation: nameOnRight ? angle - 180 : angle,
			nameOnRight,
		};
	});
	return {
		items,
		badgeWidth,
		badgeHeight,
		numberSize,
		showNames,
		nameOffset,
		nameSize,
	};
}

export type VoteChoice = "up" | "down";
export type Control = "sound" | "draw" | VoteChoice;
type WheelPhase = "spinning" | "fetching" | "idle" | "done";

export function wheelControl(
	phase: WheelPhase,
	canDraw: boolean,
	driven: boolean,
	drawLabel = "점심 메뉴 추첨하기",
	drawText = "추첨하기",
) {
	if (!driven && phase === "fetching")
		return { busy: true, caption: "준비 중", label: "룰렛 준비 중" };
	if (!driven && phase === "spinning")
		return { busy: true, caption: "회전 중", label: "룰렛이 돌아가고 있어요" };
	if (!canDraw)
		return driven
			? { busy: false, caption: "회전 중", label: "룰렛 회전 중" }
			: {
					busy: false,
					caption: "방장 대기",
					label: "방장이 추첨을 시작할 때까지 대기",
				};
	if (phase === "done")
		return { busy: false, caption: "한 번 더", label: "한 번 더 추첨하기" };
	return { busy: false, caption: drawText, label: drawLabel };
}

export type StageScene = {
	/** The ticket or wheel occupies the top of the same canvas as the lists. */
	mainHeight?: number;
	voteMotionRound?: string;
	sound?: { enabled: boolean; supported: boolean };
	wheel: {
		labels: readonly WheelLabel[];
		count: number;
		caption: string;
		busy: boolean;
		disabled: boolean;
		phase: WheelPhase;
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
	const wheelSide = Math.max(1, Math.min(width, height - 61, 480));
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
