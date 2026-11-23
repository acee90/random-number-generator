export const drawViewLabels = { "slot-v1": "슬롯머신", wheel: "룰렛" } as const;
export type DrawView = keyof typeof drawViewLabels;
export const defaultDrawView = "slot-v1" satisfies DrawView;

export function isDrawView(value: unknown): value is DrawView {
	return typeof value === "string" && Object.hasOwn(drawViewLabels, value);
}

export function readDrawView(value: unknown): DrawView {
	// Unversioned rooms and draws used the wheel before selectable views existed.
	return isDrawView(value) ? value : "wheel";
}
