import { distanceBetween } from "@/lib/nearbyRestaurants";
import type { NearbyMapOptions, NearbyMapView } from "./nearbyMapProvider";

type Point = { lat(): number; lng(): number };
type MapInstance = {
	getCenter(): Point;
	setCenter(point: Point): void;
	getZoom(): number;
	getMinZoom(): number;
	getMaxZoom(): number;
	zoomBy(steps: number, origin: Point): void;
	setOptions(key: "zoomOrigin", value: Point): void;
	fitBounds(bounds: unknown, margins: Record<string, number>): void;
	autoResize(): void;
	destroy(): void;
};
type Marker = { setMap(map: MapInstance | null): void };
type Maps = {
	Map: new (node: HTMLElement, options: object) => MapInstance;
	LatLng: new (latitude: number, longitude: number) => Point;
	Point: new (x: number, y: number) => object;
	Circle: new (
		options: object,
	) => {
		setCenter(point: Point): void;
		setRadius(meters: number): void;
		getBounds(): unknown;
	};
	Marker: new (options: object) => Marker;
	Event: {
		addListener(
			target: MapInstance,
			event: string,
			callback: () => void,
		): unknown;
		removeListener(listener: unknown): void;
	};
};
declare global {
	interface Window {
		naver?: { maps?: Maps };
		navermap_authFailure?: () => void;
	}
}

let sdk: Promise<Maps> | undefined;

function loadMaps(keyId: string) {
	if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps);
	if (sdk) return sdk;
	sdk = new Promise<Maps>((resolve, reject) => {
		const script = document.createElement("script");
		const timer = window.setTimeout(fail, 12_000);
		function fail() {
			clearTimeout(timer);
			script.remove();
			reject(new Error("네이버 지도를 불러오지 못했어요."));
		}
		script.src =
			"https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=" +
			encodeURIComponent(keyId);
		script.async = true;
		script.onerror = fail;
		script.onload = () => {
			clearTimeout(timer);
			const maps = window.naver?.maps;
			if (maps?.Map) resolve(maps);
			else fail();
		};
		document.head.appendChild(script);
	}).catch((error: unknown) => {
		sdk = undefined;
		throw error;
	});
	return sdk;
}

const asPosition = (point: Point) => ({
	latitude: point.lat(),
	longitude: point.lng(),
});

export async function createNaverMap(
	options: NearbyMapOptions,
	keyId: string,
): Promise<NearbyMapView> {
	const { node, center, radius, onDragStart, onMove, onZoomChange, onFailure } =
		options;
	// The SDK can report an invalid key after the script has loaded.
	const previous = window.navermap_authFailure;
	window.navermap_authFailure = onFailure;
	try {
		const maps = await loadMaps(keyId);
		const point = new maps.LatLng(center.latitude, center.longitude);
		const map = new maps.Map(node, {
			center: point,
			zoom: 15,
			keyboardShortcuts: false,
			disableKineticPan: true,
			scrollWheel: true,
			pinchZoom: true,
			zoomOrigin: point,
		});
		const color = getComputedStyle(node).getPropertyValue("--ring").trim();
		const circle = new maps.Circle({
			map,
			center: point,
			radius,
			clickable: false,
			strokeColor: color,
			strokeWeight: 2,
			fillColor: color,
			fillOpacity: 0.06,
		});
		const fitCircle = () =>
			map.fitBounds(circle.getBounds(), {
				top: 16,
				right: 16,
				bottom: 16,
				left: 16,
			});
		let markers: Marker[] = [];
		let userMarker: Marker | null = null;
		let dragging = false;
		let gesturing = false;
		const startGesture = () => {
			gesturing = true;
		};
		const finishGesture = () => {
			gesturing = false;
			onMove(asPosition(map.getCenter()));
		};
		node.addEventListener("pointerdown", startGesture, true);
		const reportZoom = () =>
			onZoomChange(map.getZoom(), map.getMinZoom(), map.getMaxZoom());
		reportZoom();
		const listeners = [
			maps.Event.addListener(map, "zoom_changed", reportZoom),
			maps.Event.addListener(map, "center_changed", () =>
				circle.setCenter(map.getCenter()),
			),
			maps.Event.addListener(map, "dragstart", () => {
				dragging = true;
				onDragStart();
			}),
			maps.Event.addListener(map, "dragend", () => {
				dragging = false;
				finishGesture();
			}),
			maps.Event.addListener(map, "idle", () => {
				if (gesturing && !dragging) finishGesture();
			}),
		];
		return {
			getZoom: () => map.getZoom(),
			zoomBy: (steps) => map.zoomBy(steps, map.getCenter()),
			setView(position, meters, fitRadius) {
				const p = new maps.LatLng(position.latitude, position.longitude);
				map.setOptions("zoomOrigin", p);
				circle.setRadius(meters);
				if (fitRadius) {
					circle.setCenter(p);
					fitCircle();
				}
				if (distanceBetween(asPosition(map.getCenter()), position) > 0.5)
					map.setCenter(p);
			},
			setUserLocation(position) {
				userMarker?.setMap(null);
				userMarker = position
					? new maps.Marker({
							map,
							position: new maps.LatLng(position.latitude, position.longitude),
							title: "내 위치",
							clickable: false,
							zIndex: 1000,
							icon: {
								content:
									'<span class="nearby-map-user-location" aria-hidden="true"></span>',
								anchor: new maps.Point(8, 8),
							},
						})
					: null;
			},
			setRestaurants(results) {
				for (const marker of markers) marker.setMap(null);
				markers = results.map(
					({ name, position }) =>
						new maps.Marker({
							map,
							position: new maps.LatLng(position.latitude, position.longitude),
							title: name,
							clickable: false,
							icon: {
								content: '<span class="nearby-map-point"></span>',
								anchor: new maps.Point(4, 4),
							},
						}),
				);
			},
			resize: () => map.autoResize(),
			destroy() {
				node.removeEventListener("pointerdown", startGesture, true);
				for (const listener of listeners) maps.Event.removeListener(listener);
				for (const marker of markers) marker.setMap(null);
				userMarker?.setMap(null);
				map.destroy();
				if (window.navermap_authFailure === onFailure)
					window.navermap_authFailure = previous;
			},
		};
	} catch (error) {
		if (window.navermap_authFailure === onFailure)
			window.navermap_authFailure = previous;
		throw error;
	}
}
