// Wire values identify a presentation version. Old rooms and unknown scenes use the wheel.
export const drawViewLabels = { wheel: "룰렛", "slot-v1": "슬롯머신" } as const;
export type DrawView = keyof typeof drawViewLabels;

export function isDrawView(value: unknown): value is DrawView {
	return typeof value === "string" && Object.hasOwn(drawViewLabels, value);
}

export function readDrawView(value: unknown): DrawView {
	return isDrawView(value) ? value : "wheel";
}
