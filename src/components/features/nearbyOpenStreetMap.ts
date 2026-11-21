import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { distanceBetween } from "@/lib/nearbyRestaurants";
import type { NearbyMapOptions, NearbyMapView } from "./nearbyMapProvider";

export function createOpenStreetMap({
	node,
	center,
	radius,
	onDragStart,
	onMove,
	onZoomChange,
	onFailure,
}: NearbyMapOptions): NearbyMapView {
	const map = L.map(node, {
		center: [center.latitude, center.longitude],
		zoom: 15,
		zoomSnap: 0.125,
		inertia: false,
		zoomControl: false,
		keyboard: false,
		scrollWheelZoom: "center",
		touchZoom: "center",
		doubleClickZoom: "center",
		trackResize: false,
		zoomAnimation: false,
		fadeAnimation: false,
	});
	map.attributionControl.setPrefix(false);
	const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		attribution:
			'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap 기여자</a>',
	});
	let loaded = false;
	tiles.on("loading", () => {
		loaded = false;
	});
	tiles.on("tileload", () => {
		loaded = true;
	});
	tiles.on("load", () => {
		// Pans can reuse existing tiles without loading another image.
		if (!loaded && !node.querySelector(".leaflet-tile-loaded")) onFailure();
	});
	tiles.addTo(map);
	const color = getComputedStyle(node).getPropertyValue("--ring").trim();
	const surface = getComputedStyle(node).getPropertyValue("--card").trim();
	const circle = L.circle(map.getCenter(), {
		radius,
		color,
		weight: 2,
		fillOpacity: 0.06,
		interactive: false,
	}).addTo(map);
	const markers = L.layerGroup().addTo(map);
	let userMarker: L.CircleMarker | undefined;
	const reportZoom = () =>
		onZoomChange(map.getZoom(), map.getMinZoom(), map.getMaxZoom());
	reportZoom();
	map.on("zoomend", reportZoom);
	map.on("dragstart", onDragStart);
	map.on("move", () => circle.setLatLng(map.getCenter()));
	map.on("dragend boxzoomend", () => {
		const { lat, lng } = map.getCenter();
		onMove({ latitude: lat, longitude: lng });
	});
	return {
		getZoom: () => map.getZoom(),
		zoomBy: (steps) => map.setZoom(map.getZoom() + steps, { animate: false }),
		setView(position, meters, fitRadius) {
			const p = L.latLng(position.latitude, position.longitude);
			circle.setLatLng(p).setRadius(meters);
			if (fitRadius) {
				const zoom = map.getBoundsZoom(
					circle.getBounds(),
					false,
					L.point(32, 32),
				);
				map.setView(p, zoom, { animate: false });
			} else {
				const { lat, lng } = map.getCenter();
				if (distanceBetween(position, { latitude: lat, longitude: lng }) > 0.5)
					map.panTo(p, { animate: false });
			}
		},
		setRestaurants(results) {
			markers.clearLayers();
			for (const { position } of results) {
				L.circleMarker([position.latitude, position.longitude], {
					radius: 3.5,
					color: surface,
					weight: 1,
					fillColor: color,
					fillOpacity: 0.9,
					interactive: false,
					className: "nearby-map-restaurant",
				}).addTo(markers);
			}
		},
		setUserLocation(position) {
			userMarker?.remove();
			if (!position) {
				userMarker = undefined;
				return;
			}
			userMarker = L.circleMarker([position.latitude, position.longitude], {
				radius: 8,
				color: surface,
				weight: 3,
				fillColor: color,
				fillOpacity: 1,
				interactive: false,
				className: "nearby-map-user-location",
			}).addTo(map);
		},
		resize: () => {
			map.invalidateSize({ animate: false });
		},
		destroy: () => {
			tiles.off();
			map.remove();
		},
	};
}
