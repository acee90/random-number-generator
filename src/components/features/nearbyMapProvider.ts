import type {
	MapPosition,
	NearbyRadius,
	NearbyResult,
} from "@/lib/nearbyRestaurants";

export type NearbyMapView = {
	setView: (center: MapPosition, radius: NearbyRadius, fit: boolean) => void;
	getZoom: () => number;
	zoomBy: (steps: -1 | 1) => void;
	setUserLocation: (position: MapPosition | null) => void;
	setRestaurants: (results: readonly NearbyResult[]) => void;
	resize: () => void;
	destroy: () => void;
};
export type NearbyMapOptions = {
	node: HTMLDivElement;
	center: MapPosition;
	radius: NearbyRadius;
	onDragStart: () => void;
	onMove: (position: MapPosition) => void;
	onZoomChange: (level: number, min: number, max: number) => void;
	onFailure: () => void;
};
