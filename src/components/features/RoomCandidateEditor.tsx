import {
	Check,
	CircleMinus,
	Ellipsis,
	FolderOpen,
	ListPlus,
	LoaderCircle,
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
import {
	lunchRoomLimits,
	type RoomCandidate,
	type RoomGameFilter,
} from "@/lib/lunchRoom";
import RoomCandidateAuthor from "./RoomCandidateAuthor";
import "./room-candidate-editor.css";

export type RoomCandidateEditorProps = {
	candidates: RoomCandidate[];
	filter: RoomGameFilter;
	onCandidatesChange: (candidates: RoomCandidate[]) => void;
	onFilterChange: (filter: RoomGameFilter) => void;
	newName: string;
	onNewNameChange: (name: string) => void;
	onAdd: () => void;
	sharedAdd?: boolean;
	sharedAddPending?: boolean;
	onLoad: (trigger: HTMLButtonElement | null) => void;
	onSave: (trigger: HTMLButtonElement | null) => void;
	onDiscard: (trigger: HTMLButtonElement | null) => void;
	disabled: boolean;
	unsaved: boolean;
	categorySuggestions: string[];
	newCandidateRef: RefObject<HTMLInputElement | null>;
	preparedCount: number;
	eligibleCount: number;
	excludedIds: string[];
	excludeDrawn: boolean;
	contextKey: string;
	sourceName?: string;
	title: string;
	titleRef?: RefObject<HTMLHeadingElement | null>;
	headerActions?: ReactNode;
	children?: ReactNode;
	notices?: ReactNode;
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
	newName,
	onNewNameChange,
	onAdd,
	sharedAdd = false,
	sharedAddPending = false,
	onLoad,
	onSave,
	onDiscard,
	disabled,
	unsaved,
	categorySuggestions,
	newCandidateRef,
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
}: RoomCandidateEditorProps) {
	const id = useId();
	const [editing, setEditing] = useState<{
		id: string;
		original: string;
	} | null>(null);
	const [nameError, setNameError] = useState("");
	const [filterOpen, setFilterOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [menuOpen, setMenuOpen] = useState(false);
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
	const pendingAdditionIds = useRef<Set<string> | null>(null);
	const menuRef = useRef<HTMLButtonElement | null>(null);
	const nameRef = useRef<HTMLInputElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const categoryRef = useRef<HTMLInputElement | null>(null);
	const bulkRef = useRef<HTMLTextAreaElement | null>(null);
	const categoryTriggers = useRef(new Map<string, HTMLButtonElement>());
	const categoryFocusId = useRef<string | null>(null);
	const nameTriggers = useRef(new Map<string, HTMLButtonElement>());
	const restoreNameFocus = useRef<string | null>(null);
	const skipNameBlur = useRef(false);
	const overlayFromMenu = useRef(false);
	const focusAfterDelete = useRef(false);
	const observedContext = useRef(contextKey);
	const categories = [...new Set(candidates.map(categoryOf))];
	const selectedCategories = filter.categories ?? categories;
	const manual = new Set(filter.excludedIds);
	const filterActive =
		categories.some((category) => !selectedCategories.includes(category)) ||
		candidates.some((candidate) => manual.has(candidate.id));
	const visible = candidates.filter(
		(candidate) =>
			editing?.id === candidate.id ||
			recentAdditionId === candidate.id ||
			(selectedCategories.includes(categoryOf(candidate)) &&
				normalize(candidate.name)
					.toLocaleLowerCase()
					.includes(normalize(query).toLocaleLowerCase())),
	);
	const currentCategoryCandidate = candidates.find(
		(candidate) => candidate.id === categoryCandidate?.id,
	);
	const categoryOptions = [
		...new Set(categorySuggestions.map(normalize).filter(Boolean)),
	];

	useEffect(() => {
		if (pendingAdditionIds.current) {
			const added = candidates.find(
				(candidate) => !pendingAdditionIds.current?.has(candidate.id),
			);
			if (added) {
				setRecentAdditionId(added.id);
				setAnnouncement(`${added.name} 후보를 추가했습니다.`);
			}
			pendingAdditionIds.current = null;
		}
		if (
			recentAdditionId &&
			!candidates.some((candidate) => candidate.id === recentAdditionId)
		)
			setRecentAdditionId(null);
	}, [candidates, recentAdditionId]);

	useEffect(() => {
		if (!editing) {
			if (restoreNameFocus.current) {
				const trigger = nameTriggers.current.get(restoreNameFocus.current);
				if (trigger?.isConnected) trigger.focus();
				else {
					const search = searchRef.current;
					const fallback =
						search && !search.closest("[hidden]")
							? search
							: newCandidateRef.current;
					fallback?.focus();
				}
			}
			restoreNameFocus.current = null;
			return;
		}
		nameRef.current?.focus();
		nameRef.current?.select();
	}, [editing, newCandidateRef]);

	useEffect(() => {
		if (disabled || observedContext.current !== contextKey) {
			setMenuOpen(false);
			setRowMenu(null);
			setCategoryCandidate(null);
			setBulkOpen(false);
			setClearOpen(false);
			setEditing(null);
			setNameError("");
		}
		if (observedContext.current !== contextKey) {
			setDeleted(null);
			setQuery("");
			setRecentAdditionId(null);
			pendingAdditionIds.current = null;
			observedContext.current = contextKey;
		}
	}, [contextKey, disabled]);

	function requestAdd() {
		if (
			disabled ||
			!newName.trim() ||
			candidates.length >= lunchRoomLimits.maxCandidates ||
			!finishName()
		)
			return;
		if (!sharedAdd) {
			pendingAdditionIds.current = new Set(
				candidates.map((candidate) => candidate.id),
			);
		}
		setQuery("");
		onAdd();
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
		focusAfterDelete.current = true;
	}

	function undoDelete() {
		if (
			disabled ||
			!deleted ||
			candidates.length >= lunchRoomLimits.maxCandidates
		)
			return;
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
		if (names.some((name) => name.length > 80)) {
			setBulkError("후보 이름은 한 줄에 80자까지 입력해 주세요.");
			bulkRef.current?.focus();
			return;
		}
		if (candidates.length + names.length > lunchRoomLimits.maxCandidates) {
			setBulkError(
				`후보는 ${lunchRoomLimits.maxCandidates}개까지 추가할 수 있습니다. ${lunchRoomLimits.maxCandidates - candidates.length}개 이하로 줄여 주세요.`,
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
		menuRef.current?.focus();
	}

	return (
		<section className="room-simple-editor" aria-label="후보 편집">
			<div className="room-simple-heading">
				<h2 ref={titleRef} tabIndex={titleRef ? -1 : undefined}>
					{title}
				</h2>
				<div className="room-simple-header-actions">
					{children}
					{headerActions}
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<DropdownMenuTrigger asChild>
							<Button
								ref={menuRef}
								variant="ghost"
								size="icon"
								aria-label="목록 작업"
								disabled={disabled}
							>
								<Ellipsis size={18} aria-hidden="true" />
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
							<DropdownMenuLabel>{sourceName}</DropdownMenuLabel>
							<DropdownMenuItem
								disabled={disabled}
								onSelect={() => {
									overlayFromMenu.current = true;
									onLoad(menuRef.current);
								}}
							>
								<FolderOpen size={16} aria-hidden="true" /> 목록 불러오기
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={disabled || (!candidates.length && !newName.trim())}
								onSelect={() => {
									overlayFromMenu.current = true;
									onSave(menuRef.current);
								}}
							>
								<Save size={16} aria-hidden="true" /> 내 목록에 저장
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={
									disabled || candidates.length >= lunchRoomLimits.maxCandidates
								}
								onSelect={() => {
									overlayFromMenu.current = true;
									setBulkError("");
									setBulkOpen(true);
								}}
							>
								<ListPlus size={16} aria-hidden="true" /> 여러 개 추가
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								disabled={disabled || (!candidates.length && !newName.trim())}
								onSelect={() => {
									overlayFromMenu.current = true;
									setClearOpen(true);
								}}
							>
								<Trash2 size={16} aria-hidden="true" /> 전체 비우기
							</DropdownMenuItem>
							<DropdownMenuItem
								disabled={disabled || !unsaved}
								onSelect={() => {
									overlayFromMenu.current = true;
									onDiscard(menuRef.current);
								}}
							>
								<RotateCcw size={16} aria-hidden="true" /> 변경 취소
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<div className="room-simple-listbar">
				<p>전체 후보 {candidates.length}개</p>
				<CategoryFilterButton
					controls={`${id}-filters`}
					expanded={filterOpen}
					count={preparedCount}
					total={candidates.length}
					description={`전체 후보 ${candidates.length}개 중 필터로 ${preparedCount}개 선택`}
					onClick={() => {
						if (!finishName()) return;
						setRecentAdditionId(null);
						setFilterOpen(!filterOpen);
						if (filterOpen) setQuery("");
					}}
				/>
			</div>
			<div
				id={`${id}-filters`}
				hidden={!filterOpen}
				className="room-simple-filters"
			>
				<CategoryFilterChips
					legend="이번 추첨에 넣을 분류"
					options={categories.map((value) => ({ value }))}
					selected={selectedCategories}
					allSelected={categories.every((value) =>
						selectedCategories.includes(value),
					)}
					disabled={disabled}
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
				<label className="room-simple-search" htmlFor={`${id}-search`}>
					<Search size={16} aria-hidden="true" />
					<span className="sr-only">후보 검색</span>
					<Input
						ref={searchRef}
						id={`${id}-search`}
						name="candidate-search"
						value={query}
						placeholder="후보 검색"
						onChange={(event) => {
							setRecentAdditionId(null);
							setQuery(event.currentTarget.value);
						}}
					/>
				</label>
				<p className="room-simple-note">
					선택은 이번 추첨에만 적용돼요. 후보 원본은 유지됩니다.
				</p>
			</div>
			{filterActive && (
				<div className="room-simple-filter-reset">
					<Button
						variant="outline"
						size="sm"
						disabled={disabled}
						onClick={() => {
							setRecentAdditionId(null);
							onFilterChange({ categories: null, excludedIds: [] });
						}}
					>
						<RotateCcw size={14} aria-hidden="true" />
						필터 초기화
					</Button>
					{preparedCount === 0 && <span>선택된 후보 없음</span>}
				</div>
			)}

			{notices}
			<div className="room-simple-add">
				<Label className="sr-only" htmlFor={`${id}-new-name`}>
					새 후보 이름
				</Label>
				<Input
					ref={newCandidateRef}
					id={`${id}-new-name`}
					name="new-candidate-name"
					value={newName}
					maxLength={80}
					placeholder="후보 이름 입력 후 Enter"
					autoComplete="off"
					disabled={disabled}
					onChange={(event) => onNewNameChange(event.currentTarget.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.nativeEvent.isComposing) {
							event.preventDefault();
							requestAdd();
						}
					}}
				/>
				<Button
					variant="outline"
					size="icon"
					aria-label={sharedAddPending ? "후보 추가 중" : "후보 추가"}
					aria-busy={sharedAddPending}
					disabled={
						disabled ||
						!newName.trim() ||
						candidates.length >= lunchRoomLimits.maxCandidates
					}
					onClick={() => {
						requestAdd();
						newCandidateRef.current?.focus();
					}}
				>
					{sharedAddPending ? (
						<LoaderCircle
							size={18}
							aria-hidden="true"
							className="motion-safe:animate-spin"
						/>
					) : (
						<Plus size={18} aria-hidden="true" />
					)}
				</Button>
			</div>
			{candidates.length >= lunchRoomLimits.maxCandidates && (
				<p className="room-simple-note">
					후보는 {lunchRoomLimits.maxCandidates}개까지 추가할 수 있습니다.
				</p>
			)}

			{deleted && (
				<div className="room-simple-undo">
					<span>{deleted.candidate.name} 삭제됨</span>
					<Button
						variant="ghost"
						size="sm"
						disabled={
							disabled || candidates.length >= lunchRoomLimits.maxCandidates
						}
						onClick={undoDelete}
					>
						되돌리기
					</Button>
					{candidates.length >= lunchRoomLimits.maxCandidates && (
						<span>복구하려면 후보를 하나 비워 주세요.</span>
					)}
				</div>
			)}

			<ul className="room-simple-list" aria-label="후보 편집 목록">
				{visible.map((candidate) => {
					const index = candidates.findIndex(
						(entry) => entry.id === candidate.id,
					);
					const manualExcluded = manual.has(candidate.id);
					const categoryExcluded = !selectedCategories.includes(
						categoryOf(candidate),
					);
					const drawn = excludeDrawn && excludedIds.includes(candidate.id);
					const included = !manualExcluded && !categoryExcluded && !drawn;
					const recentlyAdded = recentAdditionId === candidate.id;
					const exclusionDescription = manualExcluded
						? "이번 추첨에서 직접 제외된 후보입니다."
						: categoryExcluded
							? "선택한 분류에 속하지 않아 이번 추첨에서 제외된 후보입니다."
							: drawn
								? "이전에 당첨되어 이번 추첨에서 제외된 후보입니다."
								: "";
					return (
						<li
							key={candidate.id}
							className="room-simple-row"
							data-candidate-id={candidate.id}
							data-included={included}
							data-selecting={filterOpen}
						>
							<label
								className="room-simple-check"
								htmlFor={`${id}-include-${candidate.id}`}
							>
								<Input
									id={`${id}-include-${candidate.id}`}
									type="checkbox"
									checked={!manualExcluded}
									disabled={disabled}
									onChange={(event) =>
										changeInclusion(candidate, event.currentTarget.checked)
									}
								/>
								<span className="sr-only">{candidate.name} 추첨 포함</span>
							</label>
							<span className="room-simple-index" aria-hidden="true">
								{index + 1}
							</span>
							<div className="room-simple-name-column">
								{editing?.id === candidate.id ? (
									<div className="room-simple-name-edit">
										<Label className="sr-only" htmlFor={`${id}-edit-name`}>
											{index + 1}번 후보 이름
										</Label>
										<Input
											ref={nameRef}
											id={`${id}-edit-name`}
											name="candidate-name"
											value={candidate.name}
											maxLength={80}
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
								) : (
									<Button
										ref={(element) => {
											if (element)
												nameTriggers.current.set(candidate.id, element);
											else nameTriggers.current.delete(candidate.id);
										}}
										variant="ghost"
										size="auto"
										className="room-simple-name"
										aria-label={`${candidate.name} 이름 수정`}
										aria-describedby={
											!included || recentlyAdded
												? `${id}-state-${candidate.id}`
												: undefined
										}
										disabled={disabled}
										onClick={() => {
											if (!finishName()) return;
											setNameError("");
											skipNameBlur.current = false;
											setEditing({
												id: candidate.id,
												original: candidate.name,
											});
										}}
									>
										<span className="room-simple-name-text">
											{candidate.name || "이름을 입력해 주세요"}
										</span>
										{(recentlyAdded || !included) && (
											<span
												className="room-simple-state-badges"
												aria-hidden="true"
											>
												{recentlyAdded && (
													<span className="room-simple-state-badge room-simple-state-added">
														<Check size={12} aria-hidden="true" />
														추가됨
													</span>
												)}
												{!included && (
													<span className="room-simple-state-badge">
														<CircleMinus size={12} aria-hidden="true" />
														{manualExcluded
															? "제외"
															: categoryExcluded
																? "분류 제외"
																: "당첨 제외"}
													</span>
												)}
											</span>
										)}
									</Button>
								)}
								{candidate.ownerName && (
									<RoomCandidateAuthor name={candidate.ownerName} />
								)}
								{editing?.id === candidate.id && nameError && (
									<p
										id={`${id}-name-error`}
										className="room-simple-error"
										role="alert"
									>
										{nameError}
									</p>
								)}
								{(!included || recentlyAdded) && (
									<span className="sr-only" id={`${id}-state-${candidate.id}`}>
										{recentlyAdded ? "방금 추가한 후보입니다. " : ""}
										{exclusionDescription}
									</span>
								)}
							</div>
							<Button
								ref={(element) => {
									if (element)
										categoryTriggers.current.set(candidate.id, element);
									else categoryTriggers.current.delete(candidate.id);
								}}
								variant="outline"
								size="sm"
								className="room-simple-tag"
								aria-label={`${candidate.name} 분류 ${categoryOf(candidate)} 변경`}
								aria-haspopup="dialog"
								disabled={disabled}
								onClick={() => {
									if (!finishName()) return;
									setCategory(
										categoryOf(candidate) === "미분류"
											? ""
											: categoryOf(candidate),
									);
									setCategoryCandidate(candidate);
									categoryFocusId.current = candidate.id;
								}}
							>
								{categoryOf(candidate)}
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="room-simple-delete"
								aria-label={`${candidate.name} 후보 삭제`}
								disabled={disabled}
								onClick={() => {
									if (!finishName()) return;
									deleteCandidate(candidate);
									focusAfterDelete.current = false;
									newCandidateRef.current?.focus();
								}}
							>
								<CircleMinus size={18} aria-hidden="true" />
							</Button>
							<DropdownMenu
								open={rowMenu === candidate.id}
								onOpenChange={(open) => {
									if (open && (disabled || !finishName())) return;
									setRowMenu(open ? candidate.id : null);
								}}
							>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										aria-label={`${candidate.name} 후보 관리`}
										className="room-simple-row-menu"
										disabled={disabled}
									>
										<Ellipsis size={18} aria-hidden="true" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									aria-label={`${candidate.name} 후보 관리`}
									onCloseAutoFocus={(event) => {
										if (focusAfterDelete.current) {
											event.preventDefault();
											focusAfterDelete.current = false;
											newCandidateRef.current?.focus();
										}
									}}
								>
									<DropdownMenuLabel>
										등록자 · {candidate.ownerName || "방장"}
									</DropdownMenuLabel>
									<DropdownMenuItem
										disabled={disabled}
										onSelect={() => changeInclusion(candidate, manualExcluded)}
									>
										{manualExcluded ? (
											<Check size={16} aria-hidden="true" />
										) : (
											<CircleMinus size={16} aria-hidden="true" />
										)}
										{manualExcluded ? "추첨에 포함" : "이번 추첨에서 제외"}
									</DropdownMenuItem>
									<DropdownMenuItem
										variant="destructive"
										disabled={disabled}
										onSelect={() => deleteCandidate(candidate)}
									>
										<Trash2 size={16} aria-hidden="true" /> 후보 삭제
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</li>
					);
				})}
			</ul>
			{visible.length === 0 && (
				<p className="room-simple-empty">
					{candidates.length === 0
						? "첫 후보를 추가해 주세요."
						: query.trim()
							? "검색 결과가 없습니다. 다른 이름으로 검색해 주세요."
							: "선택한 분류의 후보가 없습니다. 필터를 변경해 주세요."}
				</p>
			)}
			<footer className="room-simple-footer">
				<output aria-live="polite">추첨 {eligibleCount}개</output>
			</footer>
			<p className="room-simple-note room-simple-save-status">
				{unsaved
					? "초안 변경됨 · 마감하면 저장돼요."
					: "변경사항이 저장되어 있어요."}
			</p>
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>

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
						const trigger = categoryFocusId.current
							? categoryTriggers.current.get(categoryFocusId.current)
							: null;
						if (trigger?.isConnected) trigger.focus();
						else newCandidateRef.current?.focus();
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
								onNewNameChange("");
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
