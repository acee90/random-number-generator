import { Check, Layers, ListPlus, LocateFixed, MapPin } from "lucide-react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
	CategoryFilterButton,
	CategoryFilterChips,
} from "@/components/ui/category-filter";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import type { CandidateListItem } from "@/lib/candidateListDraft";
import {
	countCategories,
	type MapPosition,
	type NearbyRadius,
	nearbyCandidateItems,
	nearbyCategoryItems,
	nearbyRadii,
	restaurantsWithin,
	seonjeongneungStation,
} from "@/lib/nearbyRestaurants";
import { getPublicNearbyRestaurants } from "@/services/publicNearbyRestaurants";
import NearbyRestaurantMap from "./NearbyRestaurantMap";
import "./nearby-restaurant-picker.css";

type SearchProps = {
	existingIds: ReadonlySet<string>;
	remaining: number;
	onAdd: (items: CandidateListItem[]) => boolean;
};
type LocationState = "locating" | "current" | "default" | "pin" | "unavailable";
const locationMessages: Record<LocationState, string> = {
	locating: "현재 위치를 확인하는 중이에요.",
	current: "내 위치 기준",
	default: "현재 위치를 확인할 수 없어 선정릉역에서 시작했어요.",
	pin: "이동한 핀 기준",
	unavailable: "현재 위치를 확인할 수 없어 기존 핀을 유지했어요.",
};
type Load = {
	center: MapPosition;
	data: Awaited<ReturnType<typeof getPublicNearbyRestaurants>>;
};
const pageSize = 10;

function SearchContents({ existingIds, remaining, onAdd }: SearchProps) {
	const filtersId = useId();
	const [center, setCenter] = useState(seonjeongneungStation);
	const [radius, setRadius] = useState<NearbyRadius>(500);
	const [location, setLocation] = useState<LocationState>("locating");
	const [dragging, setDragging] = useState(false);
	const [selected, setSelected] = useState<string[]>([]);
	const [expanded, setExpanded] = useState(false);
	const [limit, setLimit] = useState(pageSize);
	const [addError, setAddError] = useState(false);
	const [loaded, setLoaded] = useState<Load | null>(null);
	const [failedCenter, setFailedCenter] = useState<MapPosition | null>(null);
	const locationAttempt = useRef(0);

	const locate = useCallback((initial: boolean) => {
		const request = ++locationAttempt.current;
		const fail = () => {
			if (request !== locationAttempt.current) return;
			setLocation(initial ? "default" : "unavailable");
		};
		setLocation("locating");
		setAddError(false);
		if (!navigator.geolocation) {
			fail();
			return;
		}
		navigator.geolocation.getCurrentPosition(
			({ coords }) => {
				if (request !== locationAttempt.current) return;
				setCenter({ latitude: coords.latitude, longitude: coords.longitude });
				setLocation("current");
			},
			fail,
			{
				enableHighAccuracy: true,
				timeout: 10_000,
				maximumAge: initial ? 60_000 : 0,
			},
		);
	}, []);
	useEffect(() => {
		locate(true);
		return () => {
			locationAttempt.current += 1;
		};
	}, [locate]);

	const move = (position: MapPosition) => {
		locationAttempt.current += 1;
		setCenter(position);
		setLocation("pin");
		setAddError(false);
	};
	const locating = location === "locating";
	const hasCurrentData = loaded?.center === center;
	useEffect(() => {
		if (locating || dragging || hasCurrentData) return;
		const abort = new AbortController();
		const timer = window.setTimeout(() => {
			void getPublicNearbyRestaurants(center, abort.signal)
				.then((data) => {
					if (abort.signal.aborted) return;
					setLoaded({ center, data });
					setFailedCenter(null);
					setLimit(pageSize);
				})
				.catch(() => {
					if (!abort.signal.aborted) setFailedCenter(center);
				});
		}, 100);
		return () => {
			window.clearTimeout(timer);
			abort.abort();
		};
	}, [center, locating, dragging, hasCurrentData]);

	const failed = !locating && !dragging && failedCenter === center;
	const canAdd = !locating && !dragging && hasCurrentData;
	const busy = !canAdd && !failed;
	const results = useMemo(
		() =>
			loaded
				? restaurantsWithin(loaded.data.restaurants, loaded.center, radius)
				: [],
		[loaded, radius],
	);
	const counts = useMemo(() => countCategories(results), [results]);
	const visible = useMemo(
		() =>
			selected.length
				? results.filter(({ category }) => selected.includes(category))
				: results,
		[results, selected],
	);
	const categories = counts
		.filter(([name]) => !selected.length || selected.includes(name))
		.map(([name]) => name);
	const allTypes = [
		...counts,
		...selected
			.filter((value) => !counts.some(([name]) => name === value))
			.map((name) => [name, 0] as [string, number]),
	];
	const shownTypes = allTypes.filter(
		([name], index) => expanded || index < 4 || selected.includes(name),
	);
	const restaurantItems = nearbyCandidateItems(visible, existingIds);
	const placesToAdd = restaurantItems.slice(0, remaining);
	const categoryItems = nearbyCategoryItems(categories, existingIds);
	const tooManyCategories = categoryItems.length > remaining;
	const status = dragging
		? "핀 이동 중"
		: failed && loaded
			? "이전 위치 결과"
			: loaded && busy && !locating
				? "새 위치 검색 중"
				: locationMessages[location];

	function select(value: string | null) {
		setSelected((previous) =>
			value === null
				? []
				: previous.includes(value)
					? previous.filter((name) => name !== value)
					: [...previous, value],
		);
		setLimit(pageSize);
		setAddError(false);
	}
	function add(items: CandidateListItem[]) {
		if (!canAdd) return;
		if (!onAdd(items)) setAddError(true);
	}

	return (
		<>
			<div className="nearby-search-body">
				<div className="nearby-search-map-pane">
					<div className="nearby-search-toolbar">
						<fieldset className="nearby-search-radii">
							<legend className="sr-only">검색 반경</legend>
							{nearbyRadii.map((value) => (
								<Button
									key={value}
									variant="outline"
									aria-pressed={value === radius}
									onClick={() => {
										setRadius(value);
										setLimit(pageSize);
										setAddError(false);
									}}
								>
									{value}m
								</Button>
							))}
						</fieldset>
						<Button
							variant="outline"
							disabled={locating}
							onClick={() => locate(false)}
						>
							<LocateFixed size={16} aria-hidden="true" />내 위치
						</Button>
					</div>
					<NearbyRestaurantMap
						center={center}
						radius={radius}
						results={visible}
						onMove={move}
						onDragStart={() => {
							locationAttempt.current += 1;
							if (locating) setLocation("pin");
							setDragging(true);
						}}
						onDragEnd={() => setDragging(false)}
					/>
					<div className="nearby-map-caption">
						<output>{status}</output>
						<div className="nearby-source">
							<span>음식점 출처</span>
							<a
								href="https://www.data.go.kr/data/15096283/standard.do"
								target="_blank"
								rel="noreferrer"
							>
								공공데이터포털 · 전국일반음식점표준데이터
							</a>
							{loaded && (
								<time dateTime={loaded.data.asOf}>
									{loaded.data.asOf.replaceAll("-", ".")} 기준
								</time>
							)}
						</div>
					</div>
				</div>
				<section
					className="nearby-search-results"
					aria-label="음식점 검색 결과"
					aria-busy={busy}
				>
					<div className="nearby-search-results-header">
						<div className="nearby-result-summary">
							<h3>음식점</h3>
							<output aria-atomic="true">
								{loaded && `${visible.length}곳 · 가까운 순`}
							</output>
						</div>
						{allTypes.length > 4 && (
							<CategoryFilterButton
								controls={filtersId}
								expanded={expanded}
								count={visible.length}
								total={results.length}
								description={`전체 음식점 ${results.length}곳 중 ${visible.length}곳 표시. 전체 카테고리 펼치기 또는 접기`}
								onClick={() => setExpanded((value) => !value)}
							/>
						)}
					</div>
					{allTypes.length > 0 && (
						<CategoryFilterChips
							id={filtersId}
							legend="음식점 카테고리 여러 개 선택"
							options={shownTypes.map(([value, count]) => ({ value, count }))}
							selected={selected}
							allSelected={selected.length === 0}
							total={results.length}
							onSelect={select}
						/>
					)}
					{tooManyCategories && remaining > 0 && (
						<p className="nearby-search-empty">
							카테고리는 {remaining}개까지 선택해 주세요.
						</p>
					)}
					{!loaded && busy && (
						<output className="nearby-search-empty">
							{locating
								? "현재 위치를 확인한 뒤 음식점을 표시해요."
								: dragging
									? "지도를 놓으면 이 위치에서 검색해요."
									: "주변 음식점을 불러오는 중이에요."}
						</output>
					)}
					{failed && (
						<div className="nearby-search-empty">
							<p role="alert">
								{loaded
									? "새 위치의 음식점을 불러오지 못했어요. 이전 위치의 목록을 표시하고 있어요."
									: "음식점 자료를 불러오지 못했어요."}
							</p>
							<Button
								variant="outline"
								onClick={() => {
									setCenter((position) => ({ ...position }));
								}}
							>
								다시 검색
							</Button>
						</div>
					)}
					{loaded && visible.length === 0 && (
						<p className="nearby-search-empty">
							{selected.length
								? "이 반경에는 선택한 카테고리의 음식점이 없어요."
								: "이 반경에 등록된 일반음식점이 없어요."}
						</p>
					)}
					{visible.length > 0 && (
						<ul className="nearby-search-list" aria-label="음식점 목록">
							{visible
								.slice(0, limit)
								.map(({ id, name, category, address, distanceMeters }) => (
									<li key={id}>
										<div>
											<strong>{name}</strong>
											<span className="nearby-search-meta">
												{category}
												{address && ` · ${address}`}
											</span>
										</div>
										<div className="nearby-search-distance">
											<span>{Math.round(distanceMeters)}m</span>
											{existingIds.has(id) && (
												<span className="nearby-search-added">
													<Check size={14} aria-hidden="true" />
													목록에 있음
												</span>
											)}
										</div>
									</li>
								))}
						</ul>
					)}
					{visible.length > limit && (
						<Button
							variant="outline"
							onClick={() => setLimit((value) => value + pageSize)}
						>
							음식점 더 보기
						</Button>
					)}
				</section>
			</div>
			<DialogFooter className="nearby-search-footer">
				{addError ? (
					<p role="alert">후보 목록이 바뀌었어요. 다시 추가해 주세요.</p>
				) : (
					<output>
						{remaining === 0
							? "후보 목록이 가득 찼어요."
							: `남은 ${remaining}자리 · 음식점은 가까운 순으로 담아요.`}
					</output>
				)}
				<div className="nearby-add-actions">
					<Button
						variant="outline"
						disabled={!canAdd || !categoryItems.length || tooManyCategories}
						onClick={() => add(categoryItems)}
					>
						<Layers size={16} aria-hidden="true" />
						{categoryItems.length
							? `카테고리 ${categoryItems.length}개 추가`
							: "카테고리 추가"}
					</Button>
					<Button
						disabled={!canAdd || !placesToAdd.length}
						onClick={() => add(placesToAdd)}
					>
						<ListPlus size={17} aria-hidden="true" />
						{placesToAdd.length
							? `음식점 ${placesToAdd.length}곳 추가`
							: "음식점 추가"}
					</Button>
				</div>
			</DialogFooter>
		</>
	);
}
export default function NearbyRestaurantPicker({
	existingIds,
	remaining,
	onAdd,
	disabled = false,
	setup = false,
}: SearchProps & { disabled?: boolean; setup?: boolean }) {
	const [open, setOpen] = useState(false);
	const title = useRef<HTMLHeadingElement>(null);
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);
	return (
		<Dialog open={open && !disabled} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="outline"
					className="nearby-search-trigger"
					disabled={disabled}
				>
					<MapPin size={setup ? 20 : 16} aria-hidden="true" />
					{setup ? <strong>주변 음식점</strong> : "주변 음식점"}
				</Button>
			</DialogTrigger>
			<DialogContent
				className="nearby-search-dialog"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					title.current?.focus();
				}}
			>
				<DialogHeader className="nearby-search-header">
					<DialogTitle ref={title} tabIndex={-1}>
						주변 음식점
					</DialogTitle>
					<DialogDescription>
						지도를 끌어 검색 위치를 바꾸세요.
					</DialogDescription>
				</DialogHeader>
				{open && !disabled && (
					<SearchContents
						existingIds={existingIds}
						remaining={remaining}
						onAdd={(items) => {
							if (!onAdd(items)) return false;
							setOpen(false);
							return true;
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
