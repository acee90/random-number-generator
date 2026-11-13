import {
	type LunchCategory,
	lunchCategories,
	sampleLunchPlaces,
} from "./lunch";

export interface RoomCandidateSelection {
	categories: LunchCategory[];
	excludedIds: string[];
}

function normalizeSelection(
	selection: RoomCandidateSelection,
): RoomCandidateSelection {
	const categories = new Set(selection.categories);
	const excludedIds = new Set(selection.excludedIds);
	return {
		categories: lunchCategories.filter((category) => categories.has(category)),
		excludedIds: sampleLunchPlaces
			.filter((place) => excludedIds.has(place.id))
			.map((place) => place.id),
	};
}

export function createRoomCandidateSelection(
	ids: readonly string[],
): RoomCandidateSelection {
	const selected = new Set(ids);
	const places = sampleLunchPlaces.filter((place) => selected.has(place.id));
	if (places.length === 0) return clearRoomCandidates();
	const activeCategories = new Set(places.map((place) => place.category));
	return {
		categories: lunchCategories.filter((category) =>
			activeCategories.has(category),
		),
		excludedIds: sampleLunchPlaces
			.filter(
				(place) =>
					activeCategories.has(place.category) && !selected.has(place.id),
			)
			.map((place) => place.id),
	};
}

export function getRoomCandidateIds(
	selection: RoomCandidateSelection,
): string[] {
	const categories = new Set(selection.categories);
	const excludedIds = new Set(selection.excludedIds);
	return sampleLunchPlaces
		.filter(
			(place) => categories.has(place.category) && !excludedIds.has(place.id),
		)
		.map((place) => place.id);
}

export function toggleRoomCandidateCategory(
	selection: RoomCandidateSelection,
	category: LunchCategory,
): RoomCandidateSelection {
	const normalized = normalizeSelection(selection);
	const categories = new Set(normalized.categories);
	if (categories.has(category)) categories.delete(category);
	else if (lunchCategories.includes(category)) categories.add(category);
	return {
		categories: lunchCategories.filter((item) => categories.has(item)),
		excludedIds: normalized.excludedIds,
	};
}

export function setRoomCandidateIncluded(
	selection: RoomCandidateSelection,
	id: string,
	included: boolean,
): RoomCandidateSelection {
	const normalized = normalizeSelection(selection);
	const excludedIds = new Set(normalized.excludedIds);
	if (included) excludedIds.delete(id);
	else if (sampleLunchPlaces.some((place) => place.id === id))
		excludedIds.add(id);
	return {
		categories: normalized.categories,
		excludedIds: sampleLunchPlaces
			.filter((place) => excludedIds.has(place.id))
			.map((place) => place.id),
	};
}

export function selectAllRoomCandidates(): RoomCandidateSelection {
	return { categories: [...lunchCategories], excludedIds: [] };
}

export function clearRoomCandidates(): RoomCandidateSelection {
	return {
		categories: [...lunchCategories],
		excludedIds: sampleLunchPlaces.map((place) => place.id),
	};
}

export function selectAllRoomCandidateCategories(
	selection: RoomCandidateSelection,
): RoomCandidateSelection {
	return {
		categories: [...lunchCategories],
		excludedIds: normalizeSelection(selection).excludedIds,
	};
}
