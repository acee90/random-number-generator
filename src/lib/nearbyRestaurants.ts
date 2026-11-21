import {
	type CandidateListItem,
	candidateDraftLimits,
} from "./candidateListDraft";

export type MapPosition = { latitude: number; longitude: number };
export const nearbyRadii = [300, 500, 700] as const;
export type NearbyRadius = (typeof nearbyRadii)[number];
export const seonjeongneungStation: MapPosition = {
	latitude: 37.51098,
	longitude: 127.04362,
};

export type NearbyRestaurant = Pick<
	CandidateListItem,
	"id" | "name" | "category"
> & {
	position: MapPosition;
	address: string;
};
export type NearbyResult = NearbyRestaurant & { distanceMeters: number };
const radians = Math.PI / 180;
const earthRadiusMeters = 6_371_000;

export function moveMapPosition(
	origin: MapPosition,
	east: number,
	north: number,
): MapPosition {
	const latitude = origin.latitude + north / earthRadiusMeters / radians;
	const longitude =
		origin.longitude +
		east /
			earthRadiusMeters /
			radians /
			Math.max(0.01, Math.cos(origin.latitude * radians));
	return {
		latitude: Math.max(-89.9, Math.min(89.9, latitude)),
		longitude: ((((longitude + 180) % 360) + 360) % 360) - 180,
	};
}

export function distanceBetween(a: MapPosition, b: MapPosition) {
	const distance =
		Math.sin(((b.latitude - a.latitude) * radians) / 2) ** 2 +
		Math.cos(a.latitude * radians) *
			Math.cos(b.latitude * radians) *
			Math.sin(((b.longitude - a.longitude) * radians) / 2) ** 2;
	return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, distance)));
}

export function restaurantsWithin(
	restaurants: readonly NearbyRestaurant[],
	center: MapPosition,
	radius: NearbyRadius,
): NearbyResult[] {
	return restaurants
		.map((restaurant) => ({
			...restaurant,
			distanceMeters: distanceBetween(center, restaurant.position),
		}))
		.filter((restaurant) => restaurant.distanceMeters <= radius)
		.sort(
			(a, b) => a.distanceMeters - b.distanceMeters || a.id.localeCompare(b.id),
		);
}

export function countCategories(restaurants: readonly NearbyRestaurant[]) {
	const counts = new Map<string, number>();
	for (const { category } of restaurants)
		counts.set(category, (counts.get(category) ?? 0) + 1);
	return [...counts].sort(
		([a, x], [b, y]) => y - x || a.localeCompare(b, "ko"),
	);
}

export function nearbyCandidateItems(
	restaurants: readonly NearbyResult[],
	existingIds: ReadonlySet<string>,
) {
	return restaurants
		.filter(({ id }) => !existingIds.has(id))
		.map(
			({ id, name, category }): CandidateListItem => ({
				id,
				name: name.slice(0, candidateDraftLimits.itemName).trimEnd(),
				category,
				included: true,
			}),
		);
}

export function nearbyCategoryItems(
	categories: readonly string[],
	existingIds: ReadonlySet<string>,
) {
	return categories
		.map(
			(name): CandidateListItem => ({
				// Public licence types are a fixed Korean vocabulary. Room IDs use ASCII.
				id:
					"food-type-" +
					Array.from(name, (ch) => ch.codePointAt(0)?.toString(36)).join("-"),
				name,
				category: name,
				included: true,
			}),
		)
		.filter(({ id }) => !existingIds.has(id));
}
