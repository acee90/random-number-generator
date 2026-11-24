import {
	Check,
	Layers,
	ListPlus,
	LoaderCircle,
	LocateFixed,
	MapPin,
} from "lucide-react";
import {
	type ReactNode,
	type RefObject,
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
import { Skeleton } from "@/components/ui/skeleton";
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
import {
	getPublicNearbyRestaurants,
	getRestaurantIndex,
} from "@/services/publicNearbyRestaurants";
import NearbyRestaurantMap from "./NearbyRestaurantMap";
import "./nearby-restaurant-picker.css";

type SearchProps = {
	existingIds: ReadonlySet<string>;
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

function SearchContents({
	existingIds,
	onAdd,
	titleRef,
}: SearchProps & { titleRef: RefObject<HTMLHeadingElement | null> }) {
	const filtersId = useId();
	const [center, setCenter] = useState(seonjeongneungStation);
	const [userLocation, setUserLocation] = useState<MapPosition | null>(null);
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
			setUserLocation(null);
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
				const position = {
					latitude: coords.latitude,
					longitude: coords.longitude,
				};
				setUserLocation(position);
				setCenter(position);
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
		// Start the location-independent download while the permission prompt is open.
		// The search below handles errors and retries once it knows the location.
		void getRestaurantIndex().catch(() => {});
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
		if (
			location === "locating" ||
			dragging ||
			hasCurrentData ||
			failedCenter === center
		)
			return;
		const abort = new AbortController();
		function search() {
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
		}
		let timer: number | undefined;
		if (location === "pin") timer = window.setTimeout(search, 100);
		else search();
		return () => {
			window.clearTimeout(timer);
			abort.abort();
		};
	}, [center, location, dragging, hasCurrentData, failedCenter]);

	const failed = !locating && !dragging && failedCenter === center;
	const ready = !locating && !dragging && hasCurrentData;
	const busy = !ready && !failed;
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
	const placesToAdd = restaurantItems;
	const categoryItems = nearbyCategoryItems(categories, existingIds);
	const progress = dragging
		? "지도를 놓으면 이 위치에서 검색해요."
		: locating
			? locationMessages.locating
			: "주변 음식점을 찾는 중이에요.";

	function select(value: string | null) {
		setSelected((previous) => {
			if (value === null) return [];
			const current = previous.length
				? previous
				: allTypes.map(([name]) => name);
			return current.includes(value)
				? current.filter((name) => name !== value)
				: [...current, value];
		});
		setLimit(pageSize);
		setAddError(false);
	}
	function add(items: CandidateListItem[]) {
		if (!ready) return;
		if (!onAdd(items)) setAddError(true);
	}

	return (
		<>
			<DialogHeader className="nearby-search-header">
				<DialogTitle ref={titleRef} tabIndex={-1}>
					주변 음식점
				</DialogTitle>
				<DialogDescription aria-live="polite" aria-atomic="true">
					{busy && !dragging && (
						<LoaderCircle
							size={16}
							className="me-2 inline-block align-text-bottom motion-safe:animate-spin"
							aria-hidden="true"
						/>
					)}
					{busy ? progress : "지도를 끌어 검색 위치를 바꾸세요."}
				</DialogDescription>
			</DialogHeader>
			<div className="nearby-search-body">
				<div className="nearby-search-map-pane">
					<div className="nearby-search-toolbar">
						<fieldset className="nearby-search-radii">
							<legend className="sr-only">검색 반경</legend>
							{nearbyRadii.map((value) => (
								<Button
									key={value}
									variant={value === radius ? "secondary" : "outline"}
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
					</div>
					<div className="nearby-map-frame">
						<NearbyRestaurantMap
							center={center}
							userLocation={userLocation}
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
						<Button
							className="nearby-map-locate"
							variant="outline"
							disabled={locating}
							onClick={() => locate(false)}
						>
							<LocateFixed size={16} aria-hidden="true" />내 위치
						</Button>
					</div>
					<div className="nearby-map-caption">
						{!locating && !dragging && (
							<span>{locationMessages[location]}</span>
						)}
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
								{(ready || visible.length > 0) &&
									`${visible.length}곳 · ${ready ? "가까운 순" : "이전 위치 결과"}`}
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
							allSelected={
								selected.length === 0 ||
								allTypes.every(([name]) => selected.includes(name))
							}
							total={results.length}
							onSelect={select}
						/>
					)}
					{busy && visible.length === 0 && (
						<ul className="nearby-search-list" aria-hidden="true">
							{[1, 2, 3].map((row) => (
								<li key={row}>
									<div>
										<Skeleton className="h-4 w-28 motion-reduce:animate-none" />
										<Skeleton className="h-3 w-44 max-w-full motion-reduce:animate-none" />
									</div>
								</li>
							))}
						</ul>
					)}
					{failed && (
						<div className="nearby-search-empty">
							<p role="alert">
								{visible.length > 0
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
					{ready && visible.length === 0 && (
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
					<p role="alert">
						후보를 추가하지 못했어요. 현재 목록을 확인한 뒤 다시 시도해 주세요.
					</p>
				) : (
					<output>가까운 순으로 후보 목록에 추가해요.</output>
				)}
				<div className="nearby-add-actions">
					<Button
						variant="outline"
						disabled={!ready || !categoryItems.length}
						onClick={() => add(categoryItems)}
					>
						<Layers size={16} aria-hidden="true" />
						{categoryItems.length
							? `카테고리 ${categoryItems.length}개 추가`
							: "카테고리 추가"}
					</Button>
					<Button
						disabled={!ready || !placesToAdd.length}
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
	disabled,
	...props
}: SearchProps & { disabled?: boolean }) {
	const [open, setOpen] = useState(false);
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);
	return (
		<NearbyRestaurantDialog
			{...props}
			open={open && !disabled}
			onOpenChange={setOpen}
			trigger={
				<DialogTrigger asChild>
					<Button variant="outline" disabled={disabled}>
						<MapPin size={16} aria-hidden="true" /> 주변 음식점
					</Button>
				</DialogTrigger>
			}
		/>
	);
}

export function NearbyRestaurantDialog({
	open,
	onOpenChange,
	existingIds,
	onAdd,
	trigger,
	onCloseAutoFocus,
}: SearchProps & {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	trigger?: ReactNode;
	onCloseAutoFocus?: (event: Event) => void;
}) {
	const title = useRef<HTMLHeadingElement>(null);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			{trigger}
			<DialogContent
				className="nearby-search-dialog"
				onCloseAutoFocus={onCloseAutoFocus}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					title.current?.focus();
				}}
			>
				{open && (
					<SearchContents
						titleRef={title}
						existingIds={existingIds}
						onAdd={(items) => {
							if (!onAdd(items)) return false;
							onOpenChange(false);
							return true;
						}}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}
