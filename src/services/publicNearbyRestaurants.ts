import {
	type MapPosition,
	moveMapPosition,
	type NearbyRestaurant,
} from "@/lib/nearbyRestaurants";

type Pack = {
	file: string;
	cells: Record<string, [offset: number, length: number]>;
};
export type RestaurantIndex = {
	asOf: string;
	cellsPerDegree: number;
	packs: Record<string, Pack>;
};
type RestaurantRow = [string, string, string, number, number, string];
const base = "/nearby-restaurants/";
const recentCells = new Map<string, NearbyRestaurant[]>();
let cachedIndex: { index: RestaurantIndex; time: number } | undefined;
let pendingIndex: Promise<RestaurantIndex> | undefined;

async function fetchIndex() {
	const response = await fetch(`${base}index.json`, {
		cache: "no-cache",
	});
	if (!response.ok) throw new Error("음식점 자료를 불러오지 못했어요.");
	const index: RestaurantIndex = await response.json();
	cachedIndex = { index, time: Date.now() };
	return index;
}

// The index is shared by all locations. Only the subsequent cell reads belong to a pin.
export function getRestaurantIndex() {
	if (cachedIndex && Date.now() - cachedIndex.time < 300_000)
		return Promise.resolve(cachedIndex.index);
	pendingIndex ??= fetchIndex().finally(() => {
		pendingIndex = undefined;
	});
	return pendingIndex;
}

export function nearbyCells(
	index: RestaurantIndex,
	center: MapPosition,
	meters: number,
) {
	const cells: { file: string; offset: number; length: number }[] = [];
	if (
		center.latitude < 31 ||
		center.latitude > 41 ||
		center.longitude < 123 ||
		center.longitude > 134
	)
		return cells;
	const { cellsPerDegree, packs } = index;
	const padding = meters + 2;
	const southWest = moveMapPosition(center, -padding, -padding);
	const northEast = moveMapPosition(center, padding, padding);
	for (
		let y = Math.floor(southWest.latitude * cellsPerDegree);
		y <= Math.floor(northEast.latitude * cellsPerDegree);
		y++
	) {
		for (
			let x = Math.floor(southWest.longitude * cellsPerDegree);
			x <= Math.floor(northEast.longitude * cellsPerDegree);
			x++
		) {
			const pack =
				packs[
					`${Math.floor(y / cellsPerDegree)}-${Math.floor(x / cellsPerDegree)}`
				];
			const range = pack?.cells[`${y}-${x}`];
			if (range)
				cells.push({ file: pack.file, offset: range[0], length: range[1] });
		}
	}
	return cells;
}

async function readCell(
	{ file, offset, length }: ReturnType<typeof nearbyCells>[number],
	signal: AbortSignal,
) {
	const key = `${file}:${offset}`;
	const cached = recentCells.get(key);
	if (cached) return cached;
	const response = await fetch(base + file, {
		headers: { Range: `bytes=${offset}-${offset + length - 1}` },
		signal,
	});
	if (!response.ok) {
		if (response.status === 404 || response.status === 416)
			cachedIndex = undefined;
		throw new Error("이 지역 음식점 자료를 불러오지 못했어요.");
	}
	const data = await response.blob();
	// Some static hosts return the complete pack for a byte-range request.
	const cell =
		response.status === 206 ? data : data.slice(offset, offset + length);
	const stream = cell.stream().pipeThrough(new DecompressionStream("gzip"));
	const rows: RestaurantRow[] = await new Response(stream).json();
	const restaurants = rows.map(
		([id, name, category, latitude, longitude, address]) => ({
			id: `lic-${id}`,
			name,
			category,
			position: { latitude, longitude },
			address,
		}),
	);
	if (recentCells.size >= 16) {
		const oldest = recentCells.keys().next().value;
		if (oldest) recentCells.delete(oldest);
	}
	recentCells.set(key, restaurants);
	return restaurants;
}

export async function getPublicNearbyRestaurants(
	center: MapPosition,
	signal: AbortSignal,
) {
	const index = await getRestaurantIndex();
	signal.throwIfAborted();
	// Fetch once for all three radii. Only nearby public data cells leave the server.
	const cells = nearbyCells(index, center, 700);
	const results = await Promise.all(
		cells.map((cell) => readCell(cell, signal)),
	);
	return { restaurants: results.flat(), asOf: index.asOf };
}
