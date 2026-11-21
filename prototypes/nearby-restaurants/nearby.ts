type Coordinates = { latitude: number; longitude: number };
type OverpassPoint = { lat: number; lon: number };
type OverpassPlace = {
	type: "node" | "way" | "relation";
	id: number;
	lat?: number;
	lon?: number;
	center?: OverpassPoint;
	tags?: Record<string, string>;
};

export type Restaurant = {
	osmPath: string;
	name: string;
	category: string;
	address: string;
	distance: number;
};

export const SEARCH_RADIUS = 500;
export const SEONJEONGNEUNG = { latitude: 37.51098, longitude: 127.04362 };
export const NEARBY_API_PATH = "/api/nearby-restaurants";

const OVERPASS = "https://overpass.openstreetmap.fr/api/interpreter";
const RADIAN = Math.PI / 180;
const EARTH_RADIUS_METERS = 6_371_000;

function distanceInMeters(origin: Coordinates, lat: number, lon: number) {
	const latitudeDifference = (lat - origin.latitude) * RADIAN;
	const longitudeDifference = (lon - origin.longitude) * RADIAN;
	const haversine =
		Math.sin(latitudeDifference / 2) ** 2 +
		Math.cos(origin.latitude * RADIAN) *
			Math.cos(lat * RADIAN) *
			Math.sin(longitudeDifference / 2) ** 2;
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function getCurrentPosition(): Promise<GeolocationCoordinates> {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(new Error("이 브라우저에서는 위치를 가져올 수 없어요."));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(position) => resolve(position.coords),
			(error) => {
				const message =
					error.code === error.PERMISSION_DENIED
						? "브라우저에서 위치 권한을 허용한 뒤 다시 검색해 주세요."
						: "현재 위치를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.";
				reject(new Error(message));
			},
			{ enableHighAccuracy: true, timeout: 12_000 },
		);
	});
}

export async function searchRestaurants(origin: Coordinates) {
	const center = `${origin.latitude},${origin.longitude}`;
	const query = `[out:json][timeout:8];nwr["amenity"~"^(restaurant|fast_food)$"]["name"](around:${SEARCH_RADIUS},${center});out center;`;
	const url = new URL(OVERPASS);
	url.searchParams.set("data", query);
	const response = await fetch(url, {
		headers: { "User-Agent": "jeommechu.dev local nearby-food prototype" },
		signal: AbortSignal.timeout(16_000),
	});
	if (!response.ok)
		throw new Error(`Overpass responded with ${response.status}`);
	const data: { elements?: OverpassPlace[]; remark?: string } =
		await response.json();
	if (!Array.isArray(data.elements) || data.remark) {
		throw new Error("Incomplete Overpass response");
	}

	const restaurants: Restaurant[] = [];
	for (const place of data.elements) {
		const lat = place.lat ?? place.center?.lat;
		const lon = place.lon ?? place.center?.lon;
		const tags = place.tags;
		const name = tags?.["name:ko"]?.trim() || tags?.name?.trim();
		if (lat == null || lon == null || !name) continue;
		const distance = distanceInMeters(origin, lat, lon);
		if (!Number.isFinite(distance) || distance > SEARCH_RADIUS) continue;
		const street = tags?.["addr:street"]?.trim();
		const streetAddress = street
			? [street, tags?.["addr:housenumber"]?.trim()].filter(Boolean).join(" ")
			: "";

		restaurants.push({
			osmPath: `${place.type}/${place.id}`,
			name,
			category: tags?.amenity === "fast_food" ? "패스트푸드" : "음식점",
			address: tags?.["addr:full"]?.trim() || streetAddress,
			distance,
		});
	}
	return restaurants.sort((first, second) => first.distance - second.distance);
}
