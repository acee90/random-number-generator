// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { createNaverMap } from "@/components/features/nearbyNaverMap";
import { seonjeongneungStation } from "@/lib/nearbyRestaurants";

it("follows a dragged Naver map center, refits a changed radius, and releases overlays", async () => {
	class LatLng {
		constructor(
			private latitude: number,
			private longitude: number,
		) {}
		lat() {
			return this.latitude;
		}
		lng() {
			return this.longitude;
		}
	}
	const events = new Map<string, () => void>();
	const station = seonjeongneungStation;
	let current = new LatLng(station.latitude, station.longitude);
	let zoom = 15;
	const mapOptions = vi.fn();
	const instance = {
		getCenter: () => current,
		getZoom: () => zoom,
		getMinZoom: () => 6,
		getMaxZoom: () => 21,
		zoomBy: vi.fn((steps: number) => {
			zoom += steps;
			events.get("zoom_changed")?.();
		}),
		setOptions: vi.fn(),
		setCenter: (p: LatLng) => {
			current = p;
		},
		autoResize: vi.fn(),
		destroy: vi.fn(),
		fitBounds: vi.fn(() => {
			zoom = 14;
			events.get("zoom_changed")?.();
		}),
	};
	const circle = {
		setCenter: vi.fn(),
		setRadius: vi.fn(),
		getBounds: () => ({ region: "circle" }),
	};
	const marker = { setMap: vi.fn() };
	const maps = {
		LatLng,
		Map: class {
			constructor(_node: HTMLElement, options: object) {
				mapOptions(options);
				Object.assign(this, instance);
			}
		},
		Circle: class {
			constructor() {
				Object.assign(this, circle);
			}
		},
		Marker: class {
			constructor() {
				Object.assign(this, marker);
			}
		},
		Point: class {},
		Event: {
			addListener: (_: unknown, name: string, callback: () => void) => {
				events.set(name, callback);
				return name;
			},
			removeListener: (name: string) => events.delete(name),
		},
	};
	const onMove = vi.fn(),
		onDragStart = vi.fn(),
		onZoomChange = vi.fn(),
		onFailure = vi.fn();
	const previous = window.navermap_authFailure;
	const originalMaps = window.naver;
	Object.defineProperty(window, "naver", {
		value: { maps },
		configurable: true,
		writable: true,
	});
	try {
		const node = document.createElement("div");
		const view = await createNaverMap(
			{
				node,
				center: station,
				radius: 500,
				onDragStart,
				onMove,
				onZoomChange,
				onFailure,
			},
			"test",
		);
		expect(mapOptions).toHaveBeenCalledWith(
			expect.objectContaining({
				scrollWheel: true,
				pinchZoom: true,
				zoomOrigin: current,
			}),
		);
		view.setView(station, 700, true);
		expect(circle.setRadius).toHaveBeenCalledWith(700);
		expect(instance.fitBounds).toHaveBeenCalledTimes(1);
		view.zoomBy(1);
		expect(instance.zoomBy).toHaveBeenCalledWith(1, current);
		expect(view.getZoom()).toBe(15);
		expect(onZoomChange).toHaveBeenLastCalledWith(15, 6, 21);
		events.get("idle")?.();
		expect(onMove).not.toHaveBeenCalled();
		events.get("dragstart")?.();
		current = new LatLng(37.52, 127.05);
		events.get("center_changed")?.();
		expect(circle.setCenter).toHaveBeenLastCalledWith(current);
		events.get("dragend")?.();
		expect(onDragStart).toHaveBeenCalledOnce();
		expect(onMove).toHaveBeenCalledExactlyOnceWith({
			latitude: 37.52,
			longitude: 127.05,
		});
		view.setView({ latitude: 37.52, longitude: 127.05 }, 700, false);
		expect(instance.fitBounds).toHaveBeenCalledTimes(1);
		expect(instance.setOptions).toHaveBeenLastCalledWith("zoomOrigin", current);
		expect(view.getZoom()).toBe(15);
		view.zoomBy(-1);
		view.zoomBy(-1);
		expect(view.getZoom()).toBe(13);
		view.setView({ latitude: 37.52, longitude: 127.05 }, 300, true);
		expect(instance.fitBounds).toHaveBeenCalledTimes(2);
		expect(view.getZoom()).toBe(14);
		view.setRestaurants([
			{
				id: "license",
				name: "식당",
				category: "한식",
				address: "주소",
				position: station,
				distanceMeters: 100,
			},
		]);
		window.navermap_authFailure?.();
		expect(onFailure).toHaveBeenCalledOnce();
		view.destroy();
		expect(marker.setMap).toHaveBeenCalledWith(null);
		expect(events.size).toBe(0);
		expect(instance.destroy).toHaveBeenCalledOnce();
		expect(window.navermap_authFailure).toBe(previous);
	} finally {
		window.naver = originalMaps;
		window.navermap_authFailure = previous;
	}
});
