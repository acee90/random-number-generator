import { FolderOpen, List, Trash2 } from "lucide-react";
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
	candidateLibraryKey,
	deleteCandidateList,
	readCandidateLibrary,
} from "@/lib/candidateLibrary";
import type { SavedCandidateList } from "@/lib/candidateListDraft";
import {
	type CandidateListUsage,
	candidateListUsageKey,
	defaultCandidateListSourceId,
	readCandidateListUsage,
	savedCandidateListSourceId,
} from "@/lib/candidateListUsage";
import { sampleLunchPlaces } from "@/lib/lunch";
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
	disabled = false,
	returnFocusRef,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// biome-ignore lint/suspicious/noConfusingVoidType: controlled consumers may return nothing; only false keeps the picker open.
	onSelect: (selection: CandidateListSelection) => boolean | void;
	disabled?: boolean;
	returnFocusRef?: RefObject<HTMLButtonElement | null>;
}) {
	const [lists, setLists] = useState<SavedCandidateList[]>([]);
	const [usage, setUsage] = useState<CandidateListUsage>({
		recentId: null,
		loadedAt: {},
	});
	const [error, setError] = useState("");
	const [deleting, setDeleting] = useState<SavedCandidateList | null>(null);
	const [deleteError, setDeleteError] = useState("");
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
					included: true,
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
						}
					}}
				>
					<DialogHeader>
						<DialogTitle>목록 불러오기</DialogTitle>
						<DialogDescription>
							목록을 선택하면 사본을 가져와 편집할 수 있어요.
						</DialogDescription>
					</DialogHeader>
					<section className="candidate-load-section" aria-label="기본 목록">
						<h3>기본 목록</h3>
						<Button
							ref={baseChoiceRef}
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
								description="회사 주변 음식점"
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
								저장한 목록이 없어요. 기본 목록을 불러오거나 취소 후 새로
								작성하세요.
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
											onClick={() =>
												select(
													savedCandidateListSourceId(list.id),
													list.name,
													list.items,
												)
											}
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
							<Button variant="outline">취소</Button>
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={Boolean(deleting)}
				onOpenChange={(next) => {
					if (!next) setDeleting(null);
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
						<AlertDialogCancel>취소</AlertDialogCancel>
						<AlertDialogAction
							data-variant="destructive"
							disabled={disabled}
							onClick={(event) => {
								if (!deleting || disabled) {
									event.preventDefault();
									return;
								}
								try {
									deleteCandidateList(deleting.id);
									setDeleting(null);
									refresh();
								} catch (cause) {
									event.preventDefault();
									setDeleteError(
										cause instanceof Error
											? cause.message
											: "목록을 삭제하지 못했어요. 다시 시도해 주세요.",
									);
								}
							}}
						>
							저장 목록 삭제
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
