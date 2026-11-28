import {
	FolderOpen,
	List,
	Sparkles,
	Trash2,
	Users,
	Utensils,
} from "lucide-react";
import {
	type RefObject,
	useCallback,
	useEffect,
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
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	CandidateListConflict,
	candidateLibraryKey,
	deleteCandidateList,
	mutateCandidateLibrary,
	readCandidateLibrary,
	type VersionedCandidateList,
} from "@/lib/candidateLibrary";
import {
	type CandidateListUsage,
	candidateListUsageKey,
	defaultCandidateListSourceId,
	gatheringActivityPresetSourceId,
	lunchMenuPresetSourceId,
	readCandidateListUsage,
	savedCandidateListSourceId,
} from "@/lib/candidateListUsage";
import {
	defaultActivityCandidates,
	defaultLunchMenuCandidates,
	sampleLunchPlaces,
} from "@/lib/lunch";
import type { RoomCandidate } from "@/lib/lunchRoom";
import "./candidate-list-load-dialog.css";

export type CandidateListSelection = {
	sourceId: string;
	name: string;
	candidates: RoomCandidate[];
};

const listDateFormat = new Intl.DateTimeFormat("ko-KR", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
});

function ListTimestamp({ value }: { value: number }) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? (
		<>정보 없음</>
	) : (
		<time dateTime={date.toISOString()}>{listDateFormat.format(date)}</time>
	);
}

function ListDetails({
	name,
	items,
	sourceId,
	usage,
	savedAt,
	description,
}: {
	name: string;
	items: readonly Pick<RoomCandidate, "name" | "category">[];
	sourceId: string;
	usage: CandidateListUsage;
	savedAt?: number;
	description?: string;
}) {
	const categories = new Set(
		items.map((item) => item.category.trim() || "미분류"),
	);
	const preview = items
		.slice(0, 3)
		.map((item) => item.name)
		.join(" · ");
	const loadedAt = usage.loadedAt[sourceId];
	return (
		<span>
			<span className="candidate-load-title">
				<strong>{name}</strong>
				{usage.recentId === sourceId && (
					<span className="candidate-load-recent">최근 불러온 목록</span>
				)}
			</span>
			<small>
				{description && `${description} · `}후보 {items.length}개 · 분류{" "}
				{categories.size}개
			</small>
			{preview && (
				<small className="candidate-load-preview">
					{preview}
					{items.length > 3 && ` 외 ${items.length - 3}개`}
				</small>
			)}
			<span className="candidate-load-dates">
				{savedAt !== undefined && (
					<small>
						저장 <ListTimestamp value={savedAt} />
					</small>
				)}
				{loadedAt !== undefined ? (
					<small>
						최근 불러옴 <ListTimestamp value={loadedAt} />
					</small>
				) : (
					<small>불러온 기록 없음</small>
				)}
			</span>
		</span>
	);
}

export default function CandidateListLoadDialog({
	open,
	onOpenChange,
	onSelect,
	onEdit,
	onCreate,
	disabled = false,
	preserveInclusion = false,
	returnFocusRef,
	fallbackFocusRef,
	roomMembers,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// biome-ignore lint/suspicious/noConfusingVoidType: controlled consumers may return nothing; only false keeps the picker open.
	onSelect: (selection: CandidateListSelection) => boolean | void;
	onEdit?: (list: VersionedCandidateList) => void;
	onCreate?: () => void;
	disabled?: boolean;
	preserveInclusion?: boolean;
	returnFocusRef?: RefObject<HTMLButtonElement | null>;
	fallbackFocusRef?: RefObject<HTMLButtonElement | null>;
	roomMembers?: RoomCandidate[];
}) {
	const [lists, setLists] = useState<VersionedCandidateList[]>([]);
	const [usage, setUsage] = useState<CandidateListUsage>({
		recentId: null,
		loadedAt: {},
	});
	const [error, setError] = useState("");
	const [deleting, setDeleting] = useState<VersionedCandidateList | null>(null);
	const [deleteError, setDeleteError] = useState("");
	const [deletePending, setDeletePending] = useState(false);
	const [deleteConflict, setDeleteConflict] = useState(false);
	const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
	const baseChoiceRef = useRef<HTMLButtonElement | null>(null);
	const refresh = useCallback(() => {
		const next = readCandidateLibrary();
		const history = readCandidateListUsage();
		setUsage(history);
		setLists(
			[...next.lists].sort(
				(a, b) =>
					Number(history.recentId === savedCandidateListSourceId(b.id)) -
						Number(history.recentId === savedCandidateListSourceId(a.id)) ||
					(history.loadedAt[savedCandidateListSourceId(b.id)] ?? 0) -
						(history.loadedAt[savedCandidateListSourceId(a.id)] ?? 0) ||
					b.updatedAt - a.updatedAt,
			),
		);
		setError(next.error);
	}, []);
	useEffect(() => {
		if (!open) return;
		refresh();
		function onStorage(event: StorageEvent) {
			if (
				event.key === candidateLibraryKey ||
				event.key === candidateListUsageKey ||
				event.key === null
			)
				refresh();
		}
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [open, refresh]);

	function select(
		sourceId: string,
		name: string,
		candidates: readonly RoomCandidate[],
	) {
		if (disabled) return;
		try {
			const accepted = onSelect({
				sourceId,
				name,
				candidates: candidates.map((candidate) => ({
					...candidate,
					id: crypto.randomUUID(),
					category: candidate.category.trim() || "미분류",
					menu: candidate.menu?.trim() || undefined,
					included: !preserveInclusion || candidate.included !== false,
				})),
			});
			if (accepted !== false) onOpenChange(false);
		} catch {
			setError(
				"목록을 가져오지 못했어요. 기존 입력은 유지됩니다. 다시 선택해 주세요.",
			);
		}
	}
	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent
					className="candidate-load-dialog"
					onCloseAutoFocus={(event) => {
						if (returnFocusRef?.current?.isConnected) {
							event.preventDefault();
							returnFocusRef.current.focus();
						} else if (fallbackFocusRef?.current?.isConnected) {
							event.preventDefault();
							fallbackFocusRef.current.focus();
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{onEdit ? "내 후보 목록" : "목록 불러오기"}
						</DialogTitle>
						<DialogDescription>
							{onEdit
								? "이 브라우저에 저장한 목록을 관리합니다."
								: "목록을 선택하면 사본을 가져와 편집할 수 있어요."}
						</DialogDescription>
					</DialogHeader>
					{roomMembers && roomMembers.length > 0 && (
						<section className="candidate-load-section" aria-label="이 방">
							<h3>이 방</h3>
							<Button
								variant="outline"
								className="candidate-load-choice"
								disabled={disabled}
								onClick={() => {
									if (
										onSelect({
											sourceId: "room-members",
											name: "방 멤버",
											candidates: roomMembers,
										}) !== false
									)
										onOpenChange(false);
								}}
							>
								<Users aria-hidden="true" />
								<span>
									<strong>방 멤버 {roomMembers.length}명</strong>
									<small className="candidate-load-preview">
										{roomMembers
											.slice(0, 3)
											.map(({ name }) => name)
											.join(" · ")}
									</small>
								</span>
							</Button>
						</section>
					)}
					<section className="candidate-load-section" aria-label="기본 목록">
						<h3>기본 목록</h3>
						<Button
							ref={baseChoiceRef}
							variant="outline"
							className="candidate-load-choice"
							disabled={disabled}
							onClick={() =>
								select(
									lunchMenuPresetSourceId,
									"점심 메뉴 추천",
									defaultLunchMenuCandidates,
								)
							}
						>
							<Utensils size={20} aria-hidden="true" />
							<ListDetails
								name="점심 메뉴 추천"
								description={
									onEdit
										? "기본 점심 메뉴로 새 목록 만들기"
										: "어디서나 바로 뽑는 대표 점심 메뉴"
								}
								items={defaultLunchMenuCandidates}
								sourceId={lunchMenuPresetSourceId}
								usage={usage}
							/>
						</Button>
						<Button
							variant="outline"
							className="candidate-load-choice"
							disabled={disabled}
							onClick={() =>
								select(
									gatheringActivityPresetSourceId,
									"모임 활동",
									defaultActivityCandidates,
								)
							}
						>
							<Sparkles size={20} aria-hidden="true" />
							<ListDetails
								name="모임 활동"
								description={
									onEdit
										? "모임 활동으로 새 목록 만들기"
										: "회식·친구 모임 놀거리"
								}
								items={defaultActivityCandidates}
								sourceId={gatheringActivityPresetSourceId}
								usage={usage}
							/>
						</Button>
						<Button
							variant="outline"
							className="candidate-load-choice"
							disabled={disabled}
							onClick={() =>
								select(
									defaultCandidateListSourceId,
									"기본 음식점 목록",
									sampleLunchPlaces,
								)
							}
						>
							<List size={20} aria-hidden="true" />
							<ListDetails
								name="기본 음식점 목록"
								description={
									onEdit
										? "선정릉 주변 목록으로 새 목록 만들기"
										: "선정릉·선릉역 주변 음식점"
								}
								items={sampleLunchPlaces}
								sourceId={defaultCandidateListSourceId}
								usage={usage}
							/>
						</Button>
					</section>
					<section className="candidate-load-section" aria-label="저장한 목록">
						<h3>저장한 목록</h3>
						<p className="candidate-load-note">
							이 브라우저의 목록 · 최근 불러온 순
						</p>
						{error && (
							<div className="candidate-load-error">
								<p role="alert">{error}</p>
								<Button variant="outline" size="sm" onClick={refresh}>
									다시 읽기
								</Button>
							</div>
						)}
						{!error && lists.length === 0 && (
							<p className="candidate-load-empty">
								{onEdit
									? "저장한 목록이 없어요."
									: "저장한 목록이 없어요. 기본 목록을 불러오거나 취소 후 새로 작성하세요."}
							</p>
						)}
						{lists.length > 0 && (
							<ul className="candidate-load-list">
								{lists.map((list) => (
									<li key={list.id}>
										<Button
											variant="outline"
											className="candidate-load-choice"
											disabled={disabled}
											onClick={() => {
												if (onEdit) onEdit(list);
												else
													select(
														savedCandidateListSourceId(list.id),
														list.name,
														list.items,
													);
											}}
										>
											<FolderOpen size={20} aria-hidden="true" />
											<ListDetails
												name={list.name}
												items={list.items}
												sourceId={savedCandidateListSourceId(list.id)}
												savedAt={list.updatedAt}
												usage={usage}
											/>
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="candidate-load-delete"
											aria-label={`${list.name} 저장 목록 삭제`}
											disabled={disabled}
											onClick={(event) => {
												deleteTriggerRef.current = event.currentTarget;
												setDeleteError("");
												setDeleteConflict(false);
												setDeleting(list);
											}}
										>
											<Trash2 size={18} aria-hidden="true" />
										</Button>
									</li>
								))}
							</ul>
						)}
					</section>
					{disabled && (
						<p className="candidate-load-note">
							진행 중인 요청이 끝나면 목록을 불러올 수 있어요.
						</p>
					)}
					<DialogFooter>
						<DialogClose asChild>
							<Button variant="outline">{onEdit ? "닫기" : "취소"}</Button>
						</DialogClose>
						{onCreate && <Button onClick={onCreate}>새 목록 만들기</Button>}
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={Boolean(deleting)}
				onOpenChange={(next) => {
					if (!next && !deletePending) setDeleting(null);
				}}
			>
				<AlertDialogContent
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						if (deleteTriggerRef.current?.isConnected)
							deleteTriggerRef.current.focus();
						else if (baseChoiceRef.current?.isConnected)
							baseChoiceRef.current.focus();
						else if (returnFocusRef?.current?.isConnected)
							returnFocusRef.current.focus();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>저장한 목록을 삭제할까요?</AlertDialogTitle>
						<AlertDialogDescription>
							{deleting?.name} 저장본을 이 브라우저에서 삭제합니다. 현재 방의
							후보와 작성 중인 초안은 유지됩니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteError && (
						<p role="alert" className="candidate-load-delete-error">
							{deleteError}
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletePending}>
							{deleteConflict ? "닫기" : "취소"}
						</AlertDialogCancel>
						<AlertDialogAction
							data-variant="destructive"
							disabled={disabled || deletePending || deleteConflict}
							onClick={async (event) => {
								event.preventDefault();
								if (!deleting || disabled || deletePending || deleteConflict)
									return;
								setDeletePending(true);
								try {
									const result = mutateCandidateLibrary(() =>
										deleteCandidateList(
											deleting.id,
											undefined,
											deleting.revision,
										),
									);
									if (typeof result !== "boolean") await result;
									setDeleting(null);
									refresh();
								} catch (cause) {
									setDeleteConflict(cause instanceof CandidateListConflict);
									setDeleteError(
										cause instanceof Error
											? cause.message
											: "목록을 삭제하지 못했어요.",
									);
									if (cause instanceof CandidateListConflict) refresh();
								} finally {
									setDeletePending(false);
								}
							}}
						>
							{deletePending ? "삭제 중…" : "저장 목록 삭제"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
