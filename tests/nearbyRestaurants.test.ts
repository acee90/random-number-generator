import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	countCategories,
	moveMapPosition,
	nearbyCandidateItems,
	nearbyCategoryItems,
	restaurantsWithin,
	seonjeongneungStation,
} from "@/lib/nearbyRestaurants";
import {
	nearbyCells,
	type RestaurantIndex,
} from "@/services/publicNearbyRestaurants";

const center = seonjeongneungStation;
const shop = (id: string, north: number, category = "한식") => ({
	id,
	name: `${id} 식당`,
	category,
	address: "테스트로",
	position: moveMapPosition(center, 0, north),
});
describe("nearby restaurant candidates", () => {
	it("measures from the chosen pin and sorts before taking the nearest available places", () => {
		const restaurants = [
			shop("outside", 301),
			shop("inside", 299),
			shop("first", 20),
		];
		expect(
			restaurantsWithin(restaurants, center, 300).map(({ id }) => id),
		).toEqual(["first", "inside"]);
		const moved = moveMapPosition(center, 0, 10);
		expect(
			restaurantsWithin(restaurants, moved, 300).map(({ id }) => id),
		).toEqual(["first", "inside", "outside"]);
	});
	it("adds one candidate per selected cuisine, or each matching restaurant, independently", () => {
		const results = restaurantsWithin(
			[shop("a", 50), shop("b", 60), shop("c", 5, "중식")],
			center,
			300,
		);
		expect(countCategories(results)).toEqual([
			["한식", 2],
			["중식", 1],
		]);
		const [korean] = nearbyCategoryItems(["한식"], new Set());
		expect(korean).toMatchObject({
			name: "한식",
			category: "한식",
			included: true,
		});
		expect(korean.id).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
		const existing = new Set([korean.id, "a"]);
		expect(
			nearbyCategoryItems(["한식", "중식"], existing).map((x) => x.name),
		).toEqual(["중식"]);
		expect(
			nearbyCandidateItems(
				results.filter((x) => x.category === "한식"),
				existing,
			),
		).toEqual([{ id: "b", name: "b 식당", category: "한식", included: true }]);
	});
});
describe("public licence data spatial index", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});
	it("includes cells across regional pack boundaries and leaves overseas searches empty", () => {
		const index: RestaurantIndex = {
			asOf: "2026-11-20",
			cellsPerDegree: 20,
			packs: {
				"37-126": { file: "west.bin", cells: { "750-2539": [0, 2] } },
				"37-127": { file: "east.bin", cells: { "750-2540": [12, 3] } },
			},
		};
		expect(
			nearbyCells(index, { latitude: 37.52, longitude: 127 }, 700).map(
				(x) => x.file,
			),
		).toEqual(["west.bin", "east.bin"]);
		expect(nearbyCells(index, { latitude: 0, longitude: 0 }, 700)).toEqual([]);
	});
	it.each([
		200, 206,
	])("reads the correct compressed cell from HTTP %s and retries an unavailable file", async (status) => {
		const prefix = Buffer.from("unrelated bytes");
		const cell = gzipSync(
			JSON.stringify([
				[
					"region-110",
					"가게",
					"한식",
					center.latitude,
					center.longitude,
					"테스트로",
				],
			]),
		);
		const index: RestaurantIndex = {
			asOf: "2026-11-20",
			cellsPerDegree: 20,
			packs: {
				"37-127": {
					file: "sample.bin",
					cells: { "750-2540": [prefix.length, cell.length] },
				},
			},
		};
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(Response.json(index))
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(
				new Response(
					Uint8Array.from(
						status === 200 ? Buffer.concat([prefix, cell]) : cell,
					),
					{ status },
				),
			);
		vi.stubGlobal("fetch", fetcher);
		const { getPublicNearbyRestaurants } = await import(
			"@/services/publicNearbyRestaurants"
		);
		const signal = new AbortController().signal;
		await expect(getPublicNearbyRestaurants(center, signal)).rejects.toThrow();
		const result = await getPublicNearbyRestaurants(center, signal);
		expect(result.restaurants).toEqual([
			{
				id: "lic-region-110",
				name: "가게",
				category: "한식",
				position: center,
				address: "테스트로",
			},
		]);
		expect(fetcher).toHaveBeenLastCalledWith("/nearby-restaurants/sample.bin", {
			headers: {
				Range: `bytes=${prefix.length}-${prefix.length + cell.length - 1}`,
			},
			signal,
		});
		await getPublicNearbyRestaurants(center, signal);
		expect(fetcher).toHaveBeenCalledTimes(3);
	});
});
