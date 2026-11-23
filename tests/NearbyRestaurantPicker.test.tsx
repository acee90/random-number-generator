// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type NearbyRestaurantMap from "@/components/features/NearbyRestaurantMap";
import NearbyRestaurantPicker from "@/components/features/NearbyRestaurantPicker";
import {
	type MapPosition,
	moveMapPosition,
	seonjeongneungStation,
} from "@/lib/nearbyRestaurants";
import {
	getPublicNearbyRestaurants,
	getRestaurantIndex,
} from "@/services/publicNearbyRestaurants";

vi.mock("@/services/publicNearbyRestaurants", () => ({
	getRestaurantIndex: vi.fn().mockResolvedValue({}),
	getPublicNearbyRestaurants: vi.fn(),
}));
vi.mock("@/components/features/NearbyRestaurantMap", () => ({
	default: ({
		center,
		userLocation,
		onDragStart,
		onDragEnd,
		onMove,
	}: ComponentProps<typeof NearbyRestaurantMap>) => (
		<>
			<output
				data-testid="nearby-map-location"
				data-user-location={
					userLocation
						? `${userLocation.latitude},${userLocation.longitude}`
						: ""
				}
			/>
			<button type="button" onClick={onDragStart}>
				지도 끌기
			</button>
			<button
				type="button"
				onClick={() => {
					onDragEnd();
					onMove(moveMapPosition(center, 2000, 0));
				}}
			>
				지도 놓기
			</button>
		</>
	),
}));

const lookup = vi.mocked(getPublicNearbyRestaurants);
const originalGeolocation = Object.getOwnPropertyDescriptor(
	navigator,
	"geolocation",
);
function mockGeolocation(
	getCurrentPosition: Geolocation["getCurrentPosition"],
) {
	Object.defineProperty(navigator, "geolocation", {
		configurable: true,
		value: { getCurrentPosition },
	});
}
const button = (name: string) => screen.getByRole("button", { name });
const rows = () =>
	within(screen.getByRole("list", { name: "음식점 목록" })).getAllByRole(
		"listitem",
	);
type Data = Awaited<ReturnType<typeof getPublicNearbyRestaurants>>;
function data(position: MapPosition, count: number, name: string): Data {
	return {
		asOf: "2026-11-20",
		restaurants: Array.from({ length: count }, (_, index) => ({
			id: `${name}-${index}`,
			name: `${name} ${index}`,
			category: "한식",
			address: "",
			position,
		})),
	};
}
function pendingLookup() {
	let finish!: (data: Data) => void;
	const promise = new Promise<Data>((resolve) => {
		finish = resolve;
	});
	lookup.mockReturnValueOnce(promise);
	return finish;
}
function openPicker() {
	const add = vi.fn<ComponentProps<typeof NearbyRestaurantPicker>["onAdd"]>(
		() => true,
	);
	render(<NearbyRestaurantPicker existingIds={new Set()} onAdd={add} />);
	fireEvent.click(button("주변 음식점"));
	return add;
}
afterEach(() => {
	cleanup();
	lookup.mockReset();
	vi.mocked(getRestaurantIndex).mockClear();
	if (originalGeolocation)
		Object.defineProperty(navigator, "geolocation", originalGeolocation);
	else Reflect.deleteProperty(navigator, "geolocation");
});

it("shows progress from opening and reports zero only for a completed search at the current pin", async () => {
	let found!: PositionCallback;
	mockGeolocation((success) => {
		found = success;
	});
	const first = pendingLookup();
	const second = pendingLookup();
	openPicker();
	const results = screen.getByRole("region", { name: "음식점 검색 결과" });
	const empty = "이 반경에 등록된 일반음식점이 없어요.";
	function expectLoading(message: string) {
		expect(results.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText(message)).toBeTruthy();
		expect(screen.queryByText(empty)).toBeNull();
		expect(screen.queryByText("0곳 · 가까운 순")).toBeNull();
		expect(button("음식점 추가").matches(":disabled")).toBe(true);
	}
	expectLoading("현재 위치를 확인하는 중이에요.");
	expect(getRestaurantIndex).toHaveBeenCalledOnce();
	expect(lookup).not.toHaveBeenCalled();
	const locateAt = (coords: MapPosition) =>
		act(() => found({ coords } as GeolocationPosition));
	const offshore = { latitude: 0, longitude: 0 };
	await locateAt(offshore);
	expect(lookup).toHaveBeenCalledTimes(1);
	expectLoading("주변 음식점을 찾는 중이에요.");
	await act(() => first(data(offshore, 0, "")));
	expect(screen.getByText(empty)).toBeTruthy();

	fireEvent.click(button("내 위치"));
	expectLoading("현재 위치를 확인하는 중이에요.");
	await locateAt(seonjeongneungStation);
	expectLoading("주변 음식점을 찾는 중이에요.");
	await act(() => second(data(seonjeongneungStation, 1, "새 식당")));
	expect(results.getAttribute("aria-busy")).toBe("false");
	expect(screen.getByText("새 식당 0")).toBeTruthy();
	expect(button("음식점 1곳 추가").matches(":disabled")).toBe(false);
});

it("adds every matching restaurant when the result set exceeds 200", async () => {
	lookup.mockResolvedValueOnce(data(seonjeongneungStation, 797, "근처 식당"));
	const add = openPicker();
	await screen.findByText("797곳 · 가까운 순");
	const addButton = button("음식점 797곳 추가");
	expect(addButton.matches(":disabled")).toBe(false);
	fireEvent.click(addButton);
	expect(add).toHaveBeenCalledTimes(1);
	expect(add.mock.calls[0][0]).toHaveLength(797);
});

it("keeps the expanded list, filter counts and choices while dragging, and only swaps in the latest pin", async () => {
	lookup.mockResolvedValueOnce(data(seonjeongneungStation, 26, "이전 식당"));
	const late = pendingLookup();
	const latest = pendingLookup();
	const add = openPicker();
	await screen.findByText("26곳 · 가까운 순");
	expect(rows()).toHaveLength(10);
	expect(button("음식점 26곳 추가").matches(":disabled")).toBe(false);
	fireEvent.click(button("한식 26"));
	fireEvent.click(button("음식점 더 보기"));
	expect(rows()).toHaveLength(20);
	fireEvent.click(button("음식점 더 보기"));
	expect(rows()).toHaveLength(26);
	expect(screen.queryByRole("button", { name: "음식점 더 보기" })).toBeNull();
	const first = rows()[0];
	fireEvent.click(button("지도 끌기"));
	expect(rows()[0]).toBe(first);
	expect(button("카테고리 1개 추가").matches(":disabled")).toBe(true);
	fireEvent.click(button("음식점 26곳 추가"));
	expect(add).not.toHaveBeenCalled();

	fireEvent.click(button("지도 놓기"));
	await waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
	expect(rows()).toHaveLength(26);
	expect(button("한식 26").getAttribute("aria-pressed")).toBe("true");
	fireEvent.click(button("지도 끌기"));
	fireEvent.click(button("지도 놓기"));
	await waitFor(() => expect(lookup).toHaveBeenCalledTimes(3));
	const [olderPoint, aborted] = lookup.mock.calls[1];
	expect(aborted.aborted).toBe(true);
	expect(rows()[0]).toBe(first);
	await act(() => latest(data(lookup.mock.calls[2][0], 1, "새 식당")));
	expect(rows()).toHaveLength(1);
	expect(screen.getByText("새 식당 0")).toBeTruthy();
	await act(() => late(data(olderPoint, 3, "늦은 식당")));
	expect(rows()).toHaveLength(1);
	expect(button("한식 1").getAttribute("aria-pressed")).toBe("true");
	fireEvent.click(button("음식점 1곳 추가"));
	expect(add).toHaveBeenCalledWith([
		expect.objectContaining({ name: "새 식당 0" }),
	]);
});

it("preserves the previous result on a failed refresh and shows empty only when the retry succeeds", async () => {
	lookup
		.mockResolvedValueOnce(data(seonjeongneungStation, 1, "이전 식당"))
		.mockRejectedValueOnce(new Error("offline"));
	const retry = pendingLookup();
	openPicker();
	await screen.findByText("이전 식당 0");
	fireEvent.click(button("지도 놓기"));
	await screen.findByRole("alert");
	expect(rows()).toHaveLength(1);
	expect(button("음식점 1곳 추가").matches(":disabled")).toBe(true);
	fireEvent.click(button("다시 검색"));
	await waitFor(() => expect(lookup).toHaveBeenCalledTimes(3));
	expect(rows()).toHaveLength(1);
	await act(() => retry(data(lookup.mock.calls[2][0], 0, "")));
	expect(
		screen.getByText("이 반경에 등록된 일반음식점이 없어요."),
	).toBeTruthy();
	expect(screen.queryByRole("list", { name: "음식점 목록" })).toBeNull();
	expect(button("음식점 추가").matches(":disabled")).toBe(true);
});

it("passes the geolocated coordinates to the map as the user's location", async () => {
	const position = { latitude: 37.51, longitude: 127.04 };
	mockGeolocation((success) =>
		success({ coords: position } as GeolocationPosition),
	);
	lookup.mockResolvedValueOnce(data(position, 1, "위치 식당"));
	openPicker();
	await screen.findByText("1곳 · 가까운 순");
	expect(screen.getByTestId("nearby-map-location").dataset.userLocation).toBe(
		"37.51,127.04",
	);
});
