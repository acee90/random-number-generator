import { describe, expect, it } from "vitest";
import {
	type LunchCategory,
	lunchCategories,
	sampleLunchPlaces,
} from "../src/lib/lunch";
import {
	clearRoomCandidates,
	createRoomCandidateSelection,
	getRoomCandidateIds,
	type RoomCandidateSelection,
	selectAllRoomCandidateCategories,
	selectAllRoomCandidates,
	setRoomCandidateIncluded,
	toggleRoomCandidateCategory,
} from "../src/lib/roomCandidateSelection";

const allIds = sampleLunchPlaces.map((place) => place.id);
const korean = sampleLunchPlaces.filter((place) => place.category === "한식");
const japanese = sampleLunchPlaces.filter((place) => place.category === "일식");

describe("initial room candidate selection", () => {
	it("infers active categories and individual exclusions from the server IDs", () => {
		const omitted = [korean[0].id, korean.at(-1)?.id];
		const ids = allIds.filter((id) => !omitted.includes(id));
		const selection = createRoomCandidateSelection([...ids].reverse());
		expect(ids).toHaveLength(allIds.length - omitted.length);
		expect(selection.categories).toEqual(lunchCategories);
		expect(selection.excludedIds).toEqual(omitted);
		expect(getRoomCandidateIds(selection)).toEqual(ids);
	});

	it("does not invent individual exclusions for a category absent from the server selection", () => {
		const omitted = japanese.map((place) => place.id);
		const ids = allIds.filter((id) => !omitted.includes(id));
		const selection = createRoomCandidateSelection(ids);
		expect(ids).toHaveLength(allIds.length - japanese.length);
		expect(selection.categories).not.toContain("일식");
		expect(selection.excludedIds).toEqual([]);
		expect(getRoomCandidateIds(selection)).toEqual(ids);
		expect(
			getRoomCandidateIds(toggleRoomCandidateCategory(selection, "일식")),
		).toEqual(allIds);
	});

	it("keeps every category visible for an empty selection so individual candidates can be restored", () => {
		const selection = createRoomCandidateSelection([]);
		expect(selection).toEqual({
			categories: lunchCategories,
			excludedIds: allIds,
		});
		expect(getRoomCandidateIds(selection)).toEqual([]);
		const included = setRoomCandidateIncluded(selection, korean[0].id, true);
		expect(getRoomCandidateIds(included)).toEqual([korean[0].id]);
		expect(getRoomCandidateIds(selection)).toEqual([]);
	});

	it("ignores unknown and duplicated server IDs while retaining canonical source order", () => {
		const selection = createRoomCandidateSelection([
			...japanese.map((place) => place.id).reverse(),
			"https://example.com/injected",
			japanese[0].id,
		]);
		expect(selection).toEqual({ categories: ["일식"], excludedIds: [] });
		expect(getRoomCandidateIds(selection)).toEqual(
			japanese.map((place) => place.id),
		);
		expect(createRoomCandidateSelection(["unknown", "unknown"])).toEqual(
			clearRoomCandidates(),
		);
	});

	it("allows zero or one candidate without imposing the host submission minimum", () => {
		const selection = createRoomCandidateSelection([korean[0].id]);
		expect(getRoomCandidateIds(selection)).toEqual([korean[0].id]);
		expect(
			getRoomCandidateIds(toggleRoomCandidateCategory(selection, "한식")),
		).toEqual([]);
	});
});

describe("category and individual candidate controls", () => {
	it("preserves an individual exclusion across category off/on and restores the other candidates", () => {
		const selection = setRoomCandidateIncluded(
			selectAllRoomCandidates(),
			korean[1].id,
			false,
		);
		const disabled = toggleRoomCandidateCategory(selection, "한식");
		expect(disabled.excludedIds).toEqual([korean[1].id]);
		expect(
			getRoomCandidateIds(disabled).some((id) =>
				korean.some((place) => place.id === id),
			),
		).toBe(false);
		const restored = toggleRoomCandidateCategory(disabled, "한식");
		expect(getRoomCandidateIds(restored)).toEqual(
			allIds.filter((id) => id !== korean[1].id),
		);
		expect(selection.categories).toEqual(lunchCategories);
	});

	it("selecting all categories keeps exclusions while selecting all candidates resets them", () => {
		const excluded = setRoomCandidateIncluded(
			selectAllRoomCandidates(),
			japanese[0].id,
			false,
		);
		const narrowed = toggleRoomCandidateCategory(excluded, "한식");
		const categories = selectAllRoomCandidateCategories(narrowed);
		expect(categories.categories).toEqual(lunchCategories);
		expect(categories.excludedIds).toEqual([japanese[0].id]);
		expect(getRoomCandidateIds(categories)).toEqual(
			allIds.filter((id) => id !== japanese[0].id),
		);
		expect(getRoomCandidateIds(selectAllRoomCandidates())).toEqual(allIds);
	});

	it("including a candidate never turns on its currently inactive category", () => {
		const selection = createRoomCandidateSelection(
			japanese.map((place) => place.id),
		);
		const changed = setRoomCandidateIncluded(selection, korean[0].id, true);
		expect(changed.categories).toEqual(["일식"]);
		expect(getRoomCandidateIds(changed)).toEqual(
			japanese.map((place) => place.id),
		);
		expect(
			getRoomCandidateIds(toggleRoomCandidateCategory(changed, "한식")),
		).toEqual(
			sampleLunchPlaces
				.filter(
					(place) => place.category === "일식" || place.category === "한식",
				)
				.map((place) => place.id),
		);
	});

	it("clearing preserves all category controls and lets a single checkbox restore one candidate", () => {
		const cleared = clearRoomCandidates();
		expect(cleared.categories).toEqual(lunchCategories);
		expect(getRoomCandidateIds(cleared)).toEqual([]);
		expect(
			getRoomCandidateIds(
				setRoomCandidateIncluded(cleared, japanese[0].id, true),
			),
		).toEqual([japanese[0].id]);
	});

	it("normalizes duplicate and unknown values without putting unknown IDs in output", () => {
		const selection: RoomCandidateSelection = {
			categories: ["한식", "한식", "unknown" as LunchCategory],
			excludedIds: [korean[1].id, korean[1].id, "unknown"],
		};
		expect(getRoomCandidateIds(selection)).toEqual(
			korean
				.filter((place) => place.id !== korean[1].id)
				.map((place) => place.id),
		);
		const normalized = setRoomCandidateIncluded(selection, "unknown", false);
		expect(normalized).toEqual({
			categories: ["한식"],
			excludedIds: [korean[1].id],
		});
		expect(
			toggleRoomCandidateCategory(normalized, "unknown" as LunchCategory),
		).toEqual(normalized);
		expect(selection.excludedIds).toEqual([
			korean[1].id,
			korean[1].id,
			"unknown",
		]);
	});

	it("returns source-order IDs even if category and exclusion arrays have a different order", () => {
		const selection: RoomCandidateSelection = {
			categories: ["중식", "일식", "한식"],
			excludedIds: [japanese[1].id, korean[0].id],
		};
		expect(getRoomCandidateIds(selection)).toEqual(
			sampleLunchPlaces
				.filter(
					(place) =>
						["중식", "일식", "한식"].includes(place.category) &&
						!selection.excludedIds.includes(place.id),
				)
				.map((place) => place.id),
		);
	});
});

describe("selection ownership", () => {
	it("never aliases input or source arrays across any returned selection", () => {
		const before = structuredClone(sampleLunchPlaces);
		const categoriesBefore = [...lunchCategories];
		const selection = setRoomCandidateIncluded(
			selectAllRoomCandidates(),
			korean[0].id,
			false,
		);
		const returned = [
			createRoomCandidateSelection(allIds),
			toggleRoomCandidateCategory(selection, "한식"),
			setRoomCandidateIncluded(selection, korean[1].id, false),
			selectAllRoomCandidateCategories(selection),
			selectAllRoomCandidates(),
			clearRoomCandidates(),
		];
		for (const result of returned) {
			expect(result.categories).not.toBe(selection.categories);
			expect(result.excludedIds).not.toBe(selection.excludedIds);
			expect(result.categories).not.toBe(lunchCategories);
			result.categories.length = 0;
			result.excludedIds.push("new-value");
		}
		const resultIds = getRoomCandidateIds(selection);
		resultIds.length = 0;
		expect(selection).toEqual({
			categories: lunchCategories,
			excludedIds: [korean[0].id],
		});
		expect(sampleLunchPlaces).toEqual(before);
		expect(lunchCategories).toEqual(categoriesBefore);
		expect(getRoomCandidateIds(selectAllRoomCandidates())).toEqual(allIds);
	});
});
