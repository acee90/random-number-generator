import { MapPin, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	distanceBetween,
	type MapPosition,
	moveMapPosition,
	type NearbyRadius,
	type NearbyResult,
} from "@/lib/nearbyRestaurants";
import type { NearbyMapOptions, NearbyMapView } from "./nearbyMapProvider";
import { createNaverMap } from "./nearbyNaverMap";

type MapProps = {
	center: MapPosition;
	userLocation: MapPosition | null;
	radius: NearbyRadius;
	results: readonly NearbyResult[];
	onMove: (position: MapPosition) => void;
	onDragStart: () => void;
	onDragEnd: () => void;
};
const directions = {
	ArrowUp: [0, 50],
	ArrowDown: [0, -50],
	ArrowLeft: [-50, 0],
	ArrowRight: [50, 0],
} as const;
const keyId = import.meta.env.VITE_NAVER_MAPS_KEY_ID?.trim();

async function getNaverMapsClientId() {
	if (keyId) return keyId;

	const response = await fetch("/api/public-config", {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) throw new Error("네이버 지도 설정을 불러오지 못했어요.");
	const config = (await response.json()) as {
		naverMapsClientId?: string | null;
	};
	return config.naverMapsClientId?.trim() ?? "";
}

export default function NearbyRestaurantMap(props: MapProps) {
	const [canvas, setCanvas] = useState<HTMLDivElement | null>(null);
	const current = useRef(props);
	current.current = props;
	const [attempt, setAttempt] = useState(0);
	const [failed, setFailed] = useState(false);
	const [view, setView] = useState<NearbyMapView | null>(null);
	const [zoomLimits, setZoomLimits] = useState({
		canZoomIn: true,
		canZoomOut: true,
	});
	const previousRadius = useRef<NearbyRadius | null>(null);
	const fittedZoom = useRef<number | null>(null);
	const { center, userLocation, radius, results } = props;

	useEffect(() => {
		if (!canvas) return;
		const node = document.createElement("div");
		canvas.replaceChildren(node);
		let active = true;
		let map: NearbyMapView | undefined;
		let resize: ResizeObserver | undefined;
		const options: NearbyMapOptions = {
			node,
			center: current.current.center,
			radius: current.current.radius,
			onDragStart: () => {
				if (active) current.current.onDragStart();
			},
			onMove(position) {
				if (!active) return;
				current.current.onDragEnd();
				if (distanceBetween(current.current.center, position) > 1)
					current.current.onMove(position);
			},
			onZoomChange(level, min, max) {
				if (!active) return;
				// Keep a manual zoom through resizes until another radius is selected.
				if (level !== fittedZoom.current) fittedZoom.current = null;
				setZoomLimits({ canZoomIn: level < max, canZoomOut: level > min });
			},
			onFailure() {
				if (!active) return;
				current.current.onDragEnd();
				setFailed(true);
			},
		};
		async function start() {
			const clientId = await getNaverMapsClientId();
			if (!clientId) throw new Error("네이버 지도 Client ID가 필요해요.");
			return createNaverMap(options, clientId);
		}
		void start()
			.then((loaded) => {
				if (!active) {
					loaded.destroy();
					return;
				}
				map = loaded;
				previousRadius.current = null;
				fittedZoom.current = null;
				setView(loaded);
				resize = new ResizeObserver(() => {
					const atRadiusZoom = loaded.getZoom() === fittedZoom.current;
					loaded.resize();
					if (atRadiusZoom) {
						loaded.setView(
							current.current.center,
							current.current.radius,
							true,
						);
						fittedZoom.current = loaded.getZoom();
					}
				});
				resize.observe(node);
			})
			.catch(options.onFailure);
		return () => {
			active = false;
			resize?.disconnect();
			map?.destroy();
			node.remove();
		};
	}, [canvas]);

	useEffect(() => {
		if (!view) return;
		const fitRadius = previousRadius.current !== radius;
		view.setView(center, radius, fitRadius);
		if (fitRadius) fittedZoom.current = view.getZoom();
		previousRadius.current = radius;
	}, [view, center, radius]);
	useEffect(() => {
		view?.setRestaurants(results);
	}, [view, results]);
	useEffect(() => {
		view?.setUserLocation(userLocation);
	}, [view, userLocation]);
	const showCenterPin =
		!userLocation || distanceBetween(center, userLocation) > 1;

	return (
		<div className="nearby-map">
			<div
				role="application"
				aria-label="음식점 주변 지도. 방향키로 검색 위치 이동"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: The interactive two-dimensional map accepts arrow keys.
				tabIndex={0}
				className="nearby-map-surface"
				onKeyDown={(event) => {
					const offset = directions[event.key as keyof typeof directions];
					if (!offset) return;
					event.preventDefault();
					props.onMove(moveMapPosition(center, offset[0], offset[1]));
				}}
			>
				<div key={attempt} className="nearby-map-canvas" ref={setCanvas} />
				{view && !failed && showCenterPin && (
					<MapPin
						className="nearby-map-center-pin"
						aria-hidden="true"
						size={32}
						strokeWidth={2.5}
					/>
				)}
			</div>
			{view && !failed && (
				<div className="nearby-map-zoom">
					<Button
						variant="outline"
						size="icon"
						aria-label="지도 확대"
						title="지도 확대"
						disabled={!zoomLimits.canZoomIn}
						onClick={() => view.zoomBy(1)}
					>
						<Plus size={18} aria-hidden="true" />
					</Button>
					<Button
						variant="outline"
						size="icon"
						aria-label="지도 축소"
						title="지도 축소"
						disabled={!zoomLimits.canZoomOut}
						onClick={() => view.zoomBy(-1)}
					>
						<Minus size={18} aria-hidden="true" />
					</Button>
				</div>
			)}
			{!view && !failed && (
				<output className="nearby-map-notice">지도를 불러오는 중이에요.</output>
			)}
			{failed && (
				<div className="nearby-map-notice">
					<output>지도를 불러오지 못했어요.</output>
					<Button
						variant="outline"
						onClick={() => {
							setView(null);
							setFailed(false);
							setAttempt((value) => value + 1);
						}}
					>
						지도 다시 불러오기
					</Button>
				</div>
			)}
		</div>
	);
}
