import {
	Check,
	FolderOpen,
	ListPlus,
	MapPin,
	Plus,
	RotateCcw,
	Save,
	Search,
	Trash2,
} from "lucide-react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	CategoryFilterButton,
	CategoryFilterChips,
} from "@/components/ui/category-filter";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { candidateDraftLimits } from "@/lib/candidateListDraft";
import {
	lunchRoomLimits,
	type RoomCandidate,
	type RoomGameFilter,
} from "@/lib/lunchRoom";
import { NearbyRestaurantDialog } from "./NearbyRestaurantPicker";
import RoomCandidateEditorRow from "./RoomCandidateEditorRow";
import RoomCandidateQuickAdd, {
	type QuickAddDraft,
} from "./RoomCandidateQuickAdd";
import "./room-candidate-editor.css";

export type RoomCandidateEditorProps = {
	candidates: RoomCandidate[];
	filter: RoomGameFilter;
	onCandidatesChange: (candidates: RoomCandidate[]) => void;
	onFilterChange: (filter: RoomGameFilter) => void;
	onAdd: (name: string) => boolean | Promise<boolean>;
	onAddNearby?: (items: RoomCandidate[]) => boolean;
	addOwnerId?: string;
	onLoad: (trigger: HTMLButtonElement | null) => void;
	onSave: (trigger: HTMLButtonElement | null) => void;
	onDiscard?: (trigger: HTMLButtonElement | null) => void;
	disabled: boolean;
	rowLayout?: "managed" | "setup";
	unsaved?: boolean;
	scrollableList?: boolean;
	showSaveStatus?: boolean;
	categorySuggestions: readonly string[];
	preparedCount: number;
	eligibleCount: number;
	excludedIds: string[];
	excludeDrawn: boolean;
	contextKey: string;
	sourceName?: string;
	title?: string;
	titleRef?: RefObject<HTMLHeadingElement | null>;
	headerActions?: ReactNode;
	children?: ReactNode;
	notices?: ReactNode;
	quickAddDraft?: QuickAddDraft;
};

const normalize = (value: string) => value.normalize("NFC").trim();
const categoryOf = (candidate: RoomCandidate) =>
	normalize(candidate.category) || "미분류";

type DeletedCandidate = {
	candidate: RoomCandidate;
	index: number;
	manuallyExcluded: boolean;
};

export default function RoomCandidateEditor({
	candidates,
	filter,
	onCandidatesChange,
	onFilterChange,
	onAdd,
	onAddNearby,
	addOwnerId,
	onLoad,
	onSave,
	onDiscard,
	disabled,
	rowLayout = "managed",
	unsaved = false,
	scrollableList = false,
	showSaveStatus = true,
	categorySuggestions,
	preparedCount,
	eligibleCount,
	excludedIds,
	excludeDrawn,
	contextKey,
	sourceName = "후보 목록",
	title,
	titleRef,
	headerActions,
	children,
	notices,
	quickAddDraft,
}: RoomCandidateEditorProps) {
	const id = useId();
	const quickAddId = `${id}-quick-add`;
	const [editing, setEditing] = useState<{
		id: string;
		original: string;
	} | null>(null);
	const [nameError, setNameError] = useState("");
	const [filterOpen, setFilterOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
	const [nearbyOpen, setNearbyOpen] = useState(false);
	const [rowMenu, setRowMenu] = useState<string | null>(null);
	const [categoryCandidate, setCategoryCandidate] =
		useState<RoomCandidate | null>(null);
	const [category, setCategory] = useState("");
	const [bulkOpen, setBulkOpen] = useState(false);
	const [bulk, setBulk] = useState("");
	const [bulkError, setBulkError] = useState("");
	const [clearOpen, setClearOpen] = useState(false);
	const [deleted, setDeleted] = useState<DeletedCandidate | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [recentAdditionId, setRecentAdditionId] = useState<string | null>(null);
	const pendingAddition = useRef<{
		previousIds: Set<string>;
		name: string;
		ownerId?: string;
	} | null>(null);
	const menuRef = useRef<HTMLButtonElement | null>(null);
	const filterRef = useRef<HTMLButtonElement>(null);
	const nameRef = useRef<HTMLInputElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const quickAddRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
	const listRef = useRef<HTMLUListElement>(null);
	const categoryRef = useRef<HTMLInputElement | null>(null);
	const bulkRef = useRef<HTMLTextAreaElement | null>(null);
	const categoryTrigger = useRef<HTMLButtonElement | null>(null);
	const undoRef = useRef<HTMLButtonElement | null>(null);
	const nameTriggers = useRef(new Map<string, HTMLButtonElement>());
	const restoreNameFocus = useRef<string | null>(null);
	const skipNameBlur = useRef(false);
	const overlayFromMenu = useRef(false);
	const observedContext = useRef(contextKey);
	const isEmpty = candidates.length === 0;
	const filterIsModal = rowLayout === "setup";
	const categories = [...new Set(candidates.map(categoryOf))];
	const selectedCategories = filter.categories ?? categories;
	const allCategoriesSelected =
		categories.length > 0 &&
		categories.every((category) => selectedCategories.includes(category));
	const manual = new Set(filter.excludedIds);
	const drawnIds = new Set(excludedIds);
	const candidateIndexes = new Map(
		candidates.map(({ id }, index) => [id, index + 1]),
	);
	const filterActive =
		categories.some((category) => !selectedCategories.includes(category)) ||
		candidates.some((candidate) => manual.has(candidate.id));
	const searchTerm = normalize(query).toLocaleLowerCase();
	const visible = candidates.filter(
		(candidate) =>
			editing?.id === candidate.id ||
			recentAdditionId === candidate.id ||
			(selectedCategories.includes(categoryOf(candidate)) &&
				normalize(candidate.name).toLocaleLowerCase().includes(searchTerm)),
	);
	const currentCategoryCandidate = candidates.find(
		(candidate) => candidate.id === categoryCandidate?.id,
	);
	const categoryOptions = [
		...new Set(categorySuggestions.map(normalize).filter(Boolean)),
	];

	useEffect(() => {
		const pending = pendingAddition.current;
		if (pending) {
			const added = candidates.find(
				(candidate) =>
					!pending.previousIds.has(candidate.id) &&
					candidate.name === pending.name &&
					(!pending.ownerId || candidate.ownerId === pending.ownerId),
			);
			if (added) {
				pendingAddition.current = null;
				setRecentAdditionId(added.id);
				setAnnouncement(`${added.name} 후보를 추가했습니다.`);
			}
		}
		if (
			recentAdditionId &&
			!candidates.some((candidate) => candidate.id === recentAdditionId)
		)
			setRecentAdditionId(null);
	}, [candidates, recentAdditionId]);

	useLayoutEffect(() => {
		const list = listRef.current;
		if (recentAdditionId && !searchTerm && list)
			list.scrollTop = list.scrollHeight;
	}, [recentAdditionId, searchTerm]);

	useEffect(() => {
		if (!editing) {
			if (restoreNameFocus.current) {
				const trigger = nameTriggers.current.get(restoreNameFocus.current);
				if (trigger?.isConnected) trigger.focus();
				else searchRef.current?.focus();
			}
			restoreNameFocus.current = null;
			return;
		}
		nameRef.current?.focus();
		nameRef.current?.select();
	}, [editing]);

	useEffect(() => {
		if (disabled || observedContext.current !== contextKey) {
			setMenuOpen(false);
			setRowMenu(null);
			setCategoryCandidate(null);
			setBulkOpen(false);
			setNearbyOpen(false);
			setClearOpen(false);
			if (filterIsModal) setFilterOpen(false);
			setEditing(null);
			setNameError("");
		}
		if (observedContext.current !== contextKey) {
			setFilterOpen(false);
			setDeleted(null);
			setQuery("");
			setRecentAdditionId(null);
			pendingAddition.current = null;
			observedContext.current = contextKey;
		}
	}, [contextKey, disabled, filterIsModal]);

	async function requestAdd(name: string) {
		if (disabled || !finishName()) return false;
		pendingAddition.current = {
			previousIds: new Set(candidateIndexes.keys()),
			name,
			ownerId: addOwnerId,
		};
		const accepted = await Promise.resolve()
			.then(() => onAdd(name))
			.catch(() => false);
		if (accepted) setQuery("");
		else pendingAddition.current = null;
		return accepted;
	}

	function updateCandidate(
		candidateId: string,
		update: Partial<RoomCandidate>,
	) {
		if (disabled) return;
		onCandidatesChange(
			candidates.map((candidate) =>
				candidate.id === candidateId ? { ...candidate, ...update } : candidate,
			),
		);
	}

	function finishName(restoreFocus = false) {
		if (!editing) return true;
		const candidate = candidates.find((entry) => entry.id === editing.id);
		if (!candidate) {
			setEditing(null);
			return true;
		}
		const name = normalize(candidate.name);
		if (!name) {
			setNameError("후보 이름을 입력해 주세요.");
			nameRef.current?.focus();
			return false;
		}
		if (name !== candidate.name) updateCandidate(candidate.id, { name });
		if (restoreFocus) restoreNameFocus.current = candidate.id;
		setNameError("");
		setEditing(null);
		return true;
	}

	function changeInclusion(candidate: RoomCandidate, include: boolean) {
		if (disabled) return;
		const excluded = new Set(filter.excludedIds);
		if (include) excluded.delete(candidate.id);
		else excluded.add(candidate.id);
		onFilterChange({ ...filter, excludedIds: [...excluded] });
	}

	function deleteCandidate(candidate: RoomCandidate) {
		if (disabled) return;
		setDeleted({
			candidate: { ...candidate },
			index: candidates.findIndex((entry) => entry.id === candidate.id),
			manuallyExcluded: manual.has(candidate.id),
		});
		onCandidatesChange(candidates.filter((entry) => entry.id !== candidate.id));
		setAnnouncement(`${candidate.name} 삭제됨. 되돌릴 수 있습니다.`);
		requestAnimationFrame(() => undoRef.current?.focus());
	}

	function undoDelete() {
		if (disabled || !deleted) return;
		if (
			!candidates.some((candidate) => candidate.id === deleted.candidate.id)
		) {
			const next = [...candidates];
			next.splice(Math.min(deleted.index, next.length), 0, deleted.candidate);
			onCandidatesChange(next);
			if (deleted.manuallyExcluded && !manual.has(deleted.candidate.id))
				onFilterChange({
					...filter,
					excludedIds: [
						...new Set([...filter.excludedIds, deleted.candidate.id]),
					],
				});
		}
		setAnnouncement(`${deleted.candidate.name} 후보를 복구했습니다.`);
		searchRef.current?.focus();
		setDeleted(null);
	}

	function appendBulk() {
		if (disabled) return;
		const lines = bulk.split(/\r?\n/).map(normalize);
		const names = lines.filter(Boolean);
		if (names.length === 0) {
			setBulkError("추가할 후보를 한 줄에 하나씩 입력해 주세요.");
			bulkRef.current?.focus();
			return;
		}
		const invalidLine = lines.findIndex((name) =>
			/[\p{Cc}\p{Cf}\p{Cs}]/u.test(name),
		);
		if (invalidLine !== -1) {
			setBulkError(
				`${invalidLine + 1}번째 줄에 사용할 수 없는 문자가 있어요. 해당 후보 이름을 다시 입력해 주세요.`,
			);
			bulkRef.current?.focus();
			return;
		}
		if (names.some((name) => name.length > candidateDraftLimits.itemName)) {
			setBulkError(
				`후보 이름은 한 줄에 ${candidateDraftLimits.itemName}자까지 입력해 주세요.`,
			);
			bulkRef.current?.focus();
			return;
		}
		onCandidatesChange([
			...candidates,
			...names.map((name) => ({
				id: crypto.randomUUID(),
				name,
				category: "미분류",
				included: true,
			})),
		]);
		setBulkOpen(false);
		setBulk("");
		setBulkError("");
		setAnnouncement(`${names.length}개 후보를 추가했습니다.`);
	}

	function restoreMenuFocus(event: Event) {
		event.preventDefault();
		if (!menuRef.current?.disabled) menuRef.current?.focus();
		else searchRef.current?.focus();
	}

	function openFromMenu(open: () => void) {
		if (disabled || !finishName()) return;
		overlayFromMenu.current = true;
		open();
	}

	function resetFilter() {
		setRecentAdditionId(null);
		onFilterChange({ categories: null, excludedIds: [] });
	}

	const filterExpanded = filterOpen && !isEmpty;
	const filterChips = (
		<CategoryFilterChips
			legend="이번 추첨에 넣을 분류"
			options={categories.map((value) => ({ value }))}
			selected={selectedCategories}
			allSelected={allCategoriesSelected}
			disabled={disabled}
			onToggleAll={() => {
				setRecentAdditionId(null);
				onFilterChange({
					...filter,
					categories: allCategoriesSelected ? [] : null,
				});
			}}
			onSelect={(value) => {
				setRecentAdditionId(null);
				const next =
					value === null
						? null
						: selectedCategories.includes(value)
							? selectedCategories.filter((entry) => entry !== value)
							: [...new Set([...selectedCategories, value])];
				onFilterChange({ ...filter, categories: next });
			}}
		/>
	);

	return (
		<section
			className="room-simple-editor"
			aria-label="후보 편집"
			data-scrollable-list={scrollableList || undefined}
		>
			{title && (
				<div className="room-simple-heading">
					<h2 ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
						{title}
					</h2>
					<div className="room-simple-header-actions">
						{children}
						{headerActions}
					</div>
				</div>
			)}

			<div className="room-simple-toolbar">
				<div className="room-simple-search">
					<Label className="sr-only" htmlFor={`${id}-search`}>
						후보 검색
					</Label>
					<Search size={16} aria-hidden="true" />
					<Input
						ref={searchRef}
						id={`${id}-search`}
						type="search"
						name="candidate-search"
						value={query}
						placeholder="후보 검색"
						disabled={disabled}
						onChange={(event) => {
							setRecentAdditionId(null);
							setQuery(event.currentTarget.value);
						}}
					/>
				</div>
				<CategoryFilterButton
					ref={filterRef}
					controls={`${id}-filters`}
					expanded={filterExpanded}
					count={preparedCount}
					total={candidates.length}
					description={`전체 후보 ${candidates.length}개 중 필터로 ${preparedCount}개 선택`}
					size="default"
					showCount={false}
					active={filterIsModal && filterActive}
					popup={filterIsModal ? "dialog" : undefined}
					disabled={disabled || !candidates.length}
					onClick={() => {
						if (finishName()) setFilterOpen(!filterOpen);
					}}
				/>
				<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
					<DropdownMenuTrigger asChild>
						<Button
							ref={menuRef}
							variant="outline"
							size="icon"
							className="room-simple-actions-trigger"
							aria-label="목록 작업"
							disabled={disabled}
						>
							<Plus size={16} aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						aria-label="목록 작업"
						onCloseAutoFocus={(event) => {
							if (overlayFromMenu.current) {
								event.preventDefault();
								overlayFromMenu.current = false;
							}
						}}
					>
						<DropdownMenuItem
							onSelect={() =>
								openFromMenu(() => {
									setBulkError("");
									setBulkOpen(true);
								})
							}
						>
							<ListPlus size={16} aria-hidden="true" /> 여러 개 추가
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={() => openFromMenu(() => onLoad(menuRef.current))}
						>
							<FolderOpen size={16} aria-hidden="true" /> 목록 불러오기
						</DropdownMenuItem>
						{onAddNearby && (
							<DropdownMenuItem
								onSelect={() => openFromMenu(() => setNearbyOpen(true))}
							>
								<MapPin size={16} aria-hidden="true" /> 주변 음식점 가져오기
							</DropdownMenuItem>
						)}
						{(candidates.length > 0 || (onDiscard && unsaved)) && (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuLabel>{sourceName}</DropdownMenuLabel>
								<DropdownMenuItem
									disabled={!candidates.length}
									onSelect={() => openFromMenu(() => onSave(menuRef.current))}
								>
									<Save size={16} aria-hidden="true" /> 내 목록에 저장
								</DropdownMenuItem>
								{onDiscard && (
									<DropdownMenuItem
										disabled={!unsaved}
										onSelect={() =>
											openFromMenu(() => onDiscard(menuRef.current))
										}
									>
										<RotateCcw size={16} aria-hidden="true" /> 변경 취소
									</DropdownMenuItem>
								)}
								<DropdownMenuItem
									variant="destructive"
									disabled={!candidates.length}
									onSelect={() => openFromMenu(() => setClearOpen(true))}
								>
									<Trash2 size={16} aria-hidden="true" /> 전체 비우기
								</DropdownMenuItem>
							</>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{filterIsModal ? (
				<Dialog open={filterExpanded} onOpenChange={setFilterOpen}>
					<DialogContent
						id={`${id}-filters`}
						className="room-simple-filter-dialog"
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							if (!filterRef.current?.disabled) filterRef.current?.focus();
							else searchRef.current?.focus();
						}}
					>
						<DialogHeader>
							<DialogTitle>후보 필터</DialogTitle>
							<DialogDescription>
								<output>
									전체 {candidates.length}개 중 {preparedCount}개 추첨
								</output>
							</DialogDescription>
						</DialogHeader>
						{filterChips}
						<DialogFooter>
							<Button
								variant="outline"
								disabled={disabled || !filterActive}
								onClick={resetFilter}
							>
								<RotateCcw size={16} aria-hidden="true" /> 필터 초기화
							</Button>
							<DialogClose asChild>
								<Button>완료</Button>
							</DialogClose>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			) : (
				<div
					id={`${id}-filters`}
					hidden={!filterExpanded}
					className="room-simple-filters"
				>
					{filterChips}
					{filterActive && (
						<Button
							className="justify-self-start"
							variant="outline"
							size="sm"
							disabled={disabled}
							onClick={resetFilter}
						>
							<RotateCcw size={16} aria-hidden="true" /> 필터 초기화
						</Button>
					)}
				</div>
			)}

			{notices}
			<div className="room-simple-summary">
				<p>전체 후보 {candidates.length}개</p>
				<output>
					{!isEmpty && searchTerm
						? `검색 ${visible.length}개`
						: eligibleCount !== candidates.length
							? `추첨 ${eligibleCount}개`
							: null}
				</output>
			</div>
			{deleted && (
				<div className="room-simple-undo">
					<span>{deleted.candidate.name} 삭제됨</span>
					<Button
						ref={undoRef}
						variant="ghost"
						size="sm"
						disabled={disabled}
						onClick={undoDelete}
					>
						되돌리기
					</Button>
				</div>
			)}

			{visible.length > 0 && !disabled && (
				<a
					href={`#${quickAddId}`}
					className="sr-only focus:not-sr-only focus:self-start focus:text-sm focus:underline"
					onClick={(event) => {
						event.preventDefault();
						quickAddRef.current?.focus();
					}}
				>
					후보 목록 건너뛰기
				</a>
			)}
			<ul
				ref={listRef}
				className="room-simple-list"
				data-empty={isEmpty || undefined}
				aria-label="후보 편집 목록"
				tabIndex={visible.length ? 0 : undefined}
			>
				{visible.map((candidate) => {
					const category = categoryOf(candidate);
					const manuallyExcluded = manual.has(candidate.id);
					const exclusion = manuallyExcluded
						? "제외"
						: !selectedCategories.includes(category)
							? "분류 제외"
							: excludeDrawn && drawnIds.has(candidate.id)
								? "당첨 제외"
								: undefined;
					function editName() {
						if (!finishName()) return;
						setNameError("");
						skipNameBlur.current = false;
						setEditing({ id: candidate.id, original: candidate.name });
					}
					return (
						<RoomCandidateEditorRow
							key={candidate.id}
							candidate={candidate}
							number={candidateIndexes.get(candidate.id)}
							layout={rowLayout}
							category={category}
							exclusion={exclusion}
							checked={!manuallyExcluded}
							recentlyAdded={recentAdditionId === candidate.id}
							disabled={disabled}
							nameTriggerRef={(element) => {
								if (element) nameTriggers.current.set(candidate.id, element);
								else nameTriggers.current.delete(candidate.id);
							}}
							menuOpen={rowMenu === candidate.id}
							onMenuOpenChange={(open) => {
								if (open && (disabled || !finishName())) return;
								setRowMenu(open ? candidate.id : null);
							}}
							onToggle={(checked) => changeInclusion(candidate, checked)}
							onEditName={editName}
							onEditCategory={(trigger) => {
								if (!finishName()) return;
								categoryTrigger.current = trigger;
								setCategory(category === "미분류" ? "" : category);
								setCategoryCandidate(candidate);
							}}
							onRemove={() => {
								if (finishName()) deleteCandidate(candidate);
							}}
							nameEditor={
								editing?.id === candidate.id ? (
									<div className="room-simple-name-field">
										<div className="room-simple-name-edit">
											<Label className="sr-only" htmlFor={`${id}-edit-name`}>
												{candidateIndexes.get(candidate.id)}번 후보 이름
											</Label>
											<Input
												ref={nameRef}
												id={`${id}-edit-name`}
												name="candidate-name"
												value={candidate.name}
												maxLength={candidateDraftLimits.itemName}
												autoComplete="off"
												disabled={disabled}
												aria-invalid={Boolean(nameError)}
												aria-describedby={
													nameError ? `${id}-name-error` : undefined
												}
												onChange={(event) => {
													updateCandidate(candidate.id, {
														name: event.currentTarget.value,
													});
													setNameError("");
												}}
												onBlur={() => {
													if (skipNameBlur.current) {
														skipNameBlur.current = false;
														return;
													}
													finishName();
												}}
												onKeyDown={(event) => {
													if (event.nativeEvent.isComposing) return;
													if (event.key === "Enter") {
														event.preventDefault();
														finishName(true);
													} else if (event.key === "Escape") {
														event.preventDefault();
														skipNameBlur.current = true;
														restoreNameFocus.current = candidate.id;
														updateCandidate(candidate.id, {
															name: editing.original,
														});
														setEditing(null);
														setNameError("");
													}
												}}
											/>
											<Button
												variant="ghost"
												size="icon"
												aria-label="후보 이름 확인"
												disabled={disabled}
												onPointerDown={(event) => event.preventDefault()}
												onClick={() => finishName(true)}
											>
												<Check size={16} aria-hidden="true" />
											</Button>
										</div>
										{nameError && (
											<p
												id={`${id}-name-error`}
												className="room-simple-error"
												role="alert"
											>
												{nameError}
											</p>
										)}
									</div>
								) : undefined
							}
						/>
					);
				})}
			</ul>
			{!isEmpty && visible.length === 0 && (
				<p className="room-simple-empty">
					{searchTerm
						? "검색 결과가 없습니다. 다른 이름으로 검색해 주세요."
						: "선택한 분류의 후보가 없습니다. 필터를 변경해 주세요."}
				</p>
			)}
			<RoomCandidateQuickAdd
				key={contextKey}
				id={quickAddId}
				controlRef={quickAddRef}
				draft={quickAddDraft}
				disabled={disabled}
				onAdd={requestAdd}
			/>
			{isEmpty && <div className="room-simple-blank-row" aria-hidden="true" />}
			{showSaveStatus && (
				<p className="room-simple-note room-simple-save-status">
					{unsaved
						? "초안 변경됨 · 마감하면 저장돼요."
						: "변경사항이 저장되어 있어요."}
				</p>
			)}
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>
			{onAddNearby && (
				<NearbyRestaurantDialog
					open={nearbyOpen}
					onOpenChange={setNearbyOpen}
					onCloseAutoFocus={restoreMenuFocus}
					existingIds={new Set(candidateIndexes.keys())}
					onAdd={(items) => {
						if (!onAddNearby(items)) return false;
						setQuery("");
						return true;
					}}
				/>
			)}

			<Dialog
				open={Boolean(categoryCandidate)}
				onOpenChange={(open) => {
					if (!open) setCategoryCandidate(null);
				}}
			>
				<DialogContent
					className="room-simple-category-dialog"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						categoryRef.current?.focus();
					}}
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (categoryTrigger.current?.isConnected)
							categoryTrigger.current.focus();
						else searchRef.current?.focus();
					}}
				>
					<DialogHeader>
						<DialogTitle>분류 변경</DialogTitle>
						<DialogDescription>
							{currentCategoryCandidate?.name || "후보"}의 분류를 입력하거나
							추천 목록에서 선택하세요.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (disabled || !currentCategoryCandidate) return;
							updateCandidate(currentCategoryCandidate.id, {
								category: normalize(category) || "미분류",
							});
							setCategoryCandidate(null);
						}}
					>
						<Label htmlFor={`${id}-category`}>분류 (선택)</Label>
						<Input
							ref={categoryRef}
							id={`${id}-category`}
							name="candidate-category"
							list={`${id}-categories`}
							maxLength={lunchRoomLimits.maxCategoryLength}
							autoComplete="off"
							value={category}
							disabled={disabled}
							onChange={(event) => setCategory(event.currentTarget.value)}
						/>
						<datalist id={`${id}-categories`}>
							{categoryOptions.map((value) => (
								<option key={value} value={value} />
							))}
						</datalist>
						<p className="room-simple-note">비워 두면 미분류로 표시됩니다.</p>
						<DialogFooter>
							<Button
								variant="outline"
								onClick={() => setCategoryCandidate(null)}
							>
								취소
							</Button>
							<Button
								type="submit"
								disabled={disabled || !currentCategoryCandidate}
							>
								적용
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
				<DialogContent
					className="room-simple-bulk-dialog"
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						bulkRef.current?.focus();
					}}
					onCloseAutoFocus={restoreMenuFocus}
				>
					<DialogHeader>
						<DialogTitle>여러 개 추가</DialogTitle>
						<DialogDescription>
							후보를 한 줄에 하나씩 입력하세요. 기존 후보는 유지됩니다.
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							appendBulk();
						}}
					>
						<Label htmlFor={`${id}-bulk`}>후보 이름 목록</Label>
						<Textarea
							ref={bulkRef}
							id={`${id}-bulk`}
							name="candidate-names"
							rows={7}
							value={bulk}
							aria-invalid={Boolean(bulkError)}
							aria-describedby={bulkError ? `${id}-bulk-error` : undefined}
							disabled={disabled}
							onChange={(event) => {
								setBulk(event.currentTarget.value);
								setBulkError("");
							}}
						/>
						{bulkError && (
							<p
								className="room-simple-error"
								id={`${id}-bulk-error`}
								role="alert"
							>
								{bulkError}
							</p>
						)}
						<DialogFooter>
							<Button variant="outline" onClick={() => setBulkOpen(false)}>
								취소
							</Button>
							<Button type="submit" disabled={disabled}>
								후보 추가
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
			<AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
				<AlertDialogContent onCloseAutoFocus={restoreMenuFocus}>
					<AlertDialogHeader>
						<AlertDialogTitle>후보를 모두 비울까요?</AlertDialogTitle>
						<AlertDialogDescription>
							편집 중인 후보를 비웁니다. 저장한 개인 목록과 지난 추첨 기록은
							유지됩니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>돌아가기</AlertDialogCancel>
						<AlertDialogAction
							disabled={disabled}
							onClick={() => {
								if (disabled) return;
								onCandidatesChange([]);
								onFilterChange({ categories: null, excludedIds: [] });
								setQuery("");
								setFilterOpen(false);
								setDeleted(null);
								setAnnouncement("편집 중인 후보를 모두 비웠습니다.");
							}}
						>
							전체 비우기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
