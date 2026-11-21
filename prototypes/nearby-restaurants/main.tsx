import { ArrowUpRight, LoaderCircle, LocateFixed, MapPin } from "lucide-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import "@/styles.css";
import {
	getCurrentPosition,
	NEARBY_API_PATH,
	type Restaurant,
	SEARCH_RADIUS,
	SEONJEONGNEUNG,
} from "./nearby";

type Source = "current" | "station";
type SearchState =
	| { status: "idle" }
	| { status: "locating" | "loading"; source: Source }
	| { status: "results"; source: Source; restaurants: Restaurant[] }
	| { status: "error"; message: string };

const sourceLabels = { current: "현재 위치", station: "선정릉역" };

function statusMessage(state: SearchState) {
	switch (state.status) {
		case "idle":
			return "검색 위치를 선택해 주세요.";
		case "locating":
			return "현재 위치를 확인하는 중이에요.";
		case "loading":
			return `${sourceLabels[state.source]} 주변 음식점을 불러오는 중이에요.`;
		case "results":
			return state.restaurants.length
				? `${sourceLabels[state.source]} 기준 · ${state.restaurants.length}곳 · 직선거리순`
				: `${sourceLabels[state.source]} 주변에서 이름이 등록된 음식점을 찾지 못했어요.`;
		case "error":
			return "";
	}
}

function NearbyRestaurants() {
	const [state, setState] = useState<SearchState>({ status: "idle" });
	const busy = state.status === "locating" || state.status === "loading";
	const CurrentIcon =
		busy && state.source === "current" ? LoaderCircle : LocateFixed;
	const StationIcon =
		busy && state.source === "station" ? LoaderCircle : MapPin;

	async function search(source: Source) {
		if (busy) return;
		let center = SEONJEONGNEUNG;
		if (source === "current") {
			setState({ status: "locating", source });
			try {
				center = await getCurrentPosition();
			} catch (error) {
				setState({ status: "error", message: (error as Error).message });
				return;
			}
		}
		setState({ status: "loading", source });
		try {
			const query = new URLSearchParams({
				lat: String(center.latitude),
				lon: String(center.longitude),
			});
			const response = await fetch(`${NEARBY_API_PATH}?${query}`, {
				signal: AbortSignal.timeout(18_000),
			});
			if (!response.ok)
				throw new Error(`Search responded with ${response.status}`);
			const restaurants: Restaurant[] = await response.json();
			setState({ status: "results", source, restaurants });
		} catch {
			setState({
				status: "error",
				message:
					"음식점 데이터를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
			});
		}
	}

	return (
		<main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
			<header className="grid gap-4">
				<div className="grid gap-2">
					<h1 className="text-3xl font-bold tracking-tight">
						주변 음식점 찾기
					</h1>
					<p className="text-sm text-muted-foreground">
						선택한 위치의 {SEARCH_RADIUS}m 반경에서 찾아요.
					</p>
				</div>
				<div className="flex flex-wrap gap-2 max-[420px]:[&>button]:w-full">
					<Button
						size="lg"
						className="min-h-11 aria-disabled:opacity-60"
						aria-disabled={busy}
						aria-describedby="location-notice"
						onClick={() => void search("current")}
					>
						<CurrentIcon
							aria-hidden="true"
							className={
								CurrentIcon === LoaderCircle
									? "motion-safe:animate-spin"
									: undefined
							}
						/>
						내 위치로 검색
					</Button>
					<Button
						size="lg"
						variant="outline"
						className="min-h-11 aria-disabled:opacity-60"
						aria-disabled={busy}
						onClick={() => void search("station")}
					>
						<StationIcon
							aria-hidden="true"
							className={
								StationIcon === LoaderCircle
									? "motion-safe:animate-spin"
									: undefined
							}
						/>
						선정릉역에서 테스트
					</Button>
				</div>
				<div className="grid gap-1 text-sm text-muted-foreground">
					<p id="location-notice">
						내 위치를 사용하면 검색 좌표를 OpenStreetMap Overpass에 보내요.
					</p>
					<a
						href="https://www.openstreetmap.org/copyright"
						className="w-fit rounded-sm underline underline-offset-2"
					>
						© OpenStreetMap 기여자
					</a>
				</div>
			</header>
			<section
				aria-label="음식점 검색 결과"
				className="rounded-lg border border-border bg-card"
			>
				<output
					aria-atomic="true"
					className="block text-sm font-medium not-empty:p-4"
				>
					{statusMessage(state)}
				</output>
				{state.status === "error" && (
					<p role="alert" className="p-4 text-sm text-destructive">
						{state.message}
					</p>
				)}
				{state.status === "results" && state.restaurants.length > 0 && (
					<ul className="divide-y divide-border border-t border-border">
						{state.restaurants.map((place) => (
							<li
								key={place.osmPath}
								className="flex items-start justify-between gap-4 p-4"
							>
								<div className="min-w-0">
									<a
										className="inline-flex items-start gap-1 rounded-sm font-semibold hover:underline"
										href={`https://www.openstreetmap.org/${place.osmPath}`}
										target="_blank"
										rel="noreferrer"
									>
										<span className="wrap-anywhere">{place.name}</span>
										<ArrowUpRight
											className="mt-1 size-4 shrink-0 text-muted-foreground"
											aria-hidden="true"
										/>
									</a>
									<p className="mt-1 wrap-anywhere text-sm text-muted-foreground">
										{place.address
											? `${place.category} · ${place.address}`
											: place.category}
									</p>
								</div>
								<span className="shrink-0 whitespace-nowrap text-sm tabular-nums text-muted-foreground">
									{Math.round(place.distance)}m
								</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<NearbyRestaurants />);
