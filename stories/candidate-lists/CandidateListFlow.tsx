import {
	ArrowLeft,
	Check,
	FileSpreadsheet,
	FolderOpen,
	LayoutTemplate,
	Plus,
	RotateCcw,
	Trash2,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import CandidateListEditor from "@/components/features/CandidateListEditor";
import {
	type CandidateListDraft,
	type CandidateListItem,
	candidateDraftLimits,
	type SavedCandidateList,
} from "@/lib/candidateListDraft";
import { sampleLunchPlaces } from "@/lib/lunch";
import {
	type CandidateLibrary,
	previewLibraryKey,
	readCandidateLibrary,
	writeCandidateLibrary,
} from "./list-library";
import "./candidate-list-flow.css";

type View = "current" | "choose" | "templates" | "excel" | "editor";
export type CandidateListFlowArgs = {
	initialStage: "current" | "choose" | "editor" | "excel";
	storageMode: "normal" | "fail";
};
export type RoomCandidateSession = {
	list: SavedCandidateList;
	version: number;
	isHost: boolean;
	lockedReason: string;
	onApply: (draft: CandidateListDraft) => Promise<void>;
};
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const newId = () => crypto.randomUUID();
const defaultList: SavedCandidateList = {
	id: "preview-company-list",
	name: "회사 주변 음식점",
	items: sampleLunchPlaces.map((place) => ({ ...place, included: true })),
	updatedAt: 0,
};
const templates = [
	{ id: "company", name: "회사 주변 음식점", items: defaultList.items },
	{
		id: "salad",
		name: "샐러드",
		items: defaultList.items.filter((item) => item.category === "샐러드"),
	},
];
const excelRows = [
	{ name: "비빔밥", category: "한식" },
	{ name: "돈까스", category: "양식" },
	{ name: "쌀국수", category: "아시안푸드" },
	{ name: "", category: "한식" },
	{ name: "비빔밥", category: "한식" },
];

function initialLibrary() {
	try {
		const raw = window.localStorage.getItem(previewLibraryKey);
		return { ...readCandidateLibrary({ getItem: () => raw }), raw };
	} catch {
		return {
			library: { version: 1 as const, lists: [], lastUsedId: null },
			error: "브라우저 저장소에 접근할 수 없습니다.",
			raw: null,
		};
	}
}

function Confirmation({
	title,
	description,
	action,
	onKeep,
	onConfirm,
}: {
	title: string;
	description: string;
	action: string;
	onKeep: () => void;
	onConfirm: () => void;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const id = useId();
	useEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);
	return (
		<dialog
			ref={ref}
			className="cl-confirm"
			aria-labelledby={`${id}-title`}
			aria-describedby={`${id}-description`}
			onCancel={(event) => {
				event.preventDefault();
				onKeep();
			}}
		>
			<h2 id={`${id}-title`}>{title}</h2>
			<p id={`${id}-description`}>{description}</p>
			<div className="cl-actionbar">
				<button type="button" className="cl-button" onClick={onKeep}>
					돌아가기
				</button>
				<button
					type="button"
					className="cl-button cl-primary"
					onClick={onConfirm}
				>
					{action}
				</button>
			</div>
		</dialog>
	);
}

/** A flow study with its own browser library; it never changes a live room. */
export function CandidateListFlow({
	initialStage,
	storageMode,
	room,
}: CandidateListFlowArgs & { room?: RoomCandidateSession }) {
	const [loaded] = useState(initialLibrary);
	const storedRaw = useRef(loaded.raw);
	const [library, setLibrary] = useState<CandidateLibrary>(loaded.library);
	const [personalApplied, setApplied] = useState<SavedCandidateList>(() =>
		copy(
			loaded.library.lists.find(
				(list) => list.id === loaded.library.lastUsedId,
			) ?? defaultList,
		),
	);
	const applied = room?.list ?? personalApplied;
	const [pending, setPending] = useState(false);
	const applying = useRef(false);
	const [savedRoomCopy, setSavedRoomCopy] = useState<{
		version: number;
		id: string;
	} | null>(null);
	const [view, setView] = useState<View>(initialStage);
	const [draft, setDraft] = useState<CandidateListDraft | null>(() =>
		initialStage === "editor" ? copy(applied) : null,
	);
	const baseline = useRef(draft ? JSON.stringify(draft) : "");
	const [importMode, setImportMode] = useState<"replace" | "append">("replace");
	const [excelReady, setExcelReady] = useState(initialStage === "excel");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [confirm, setConfirm] = useState<
		{ kind: "discard" } | { kind: "delete"; list: SavedCandidateList } | null
	>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const focusAfterConfirm = useRef(false);
	useEffect(() => {
		if (!confirm && focusAfterConfirm.current) {
			focusAfterConfirm.current = false;
			heading.current?.focus();
		}
	}, [confirm]);
	const previousView = useRef(view);
	useEffect(() => {
		if (previousView.current !== view) {
			heading.current?.focus();
			previousView.current = view;
		}
	}, [view]);
	const count = applied.items.filter((item) => item.included).length;
	const titles: Record<View, string> = {
		current: room ? "방 후보" : "후보 목록",
		choose: "새 목록 준비",
		templates: "템플릿에서 가져오기",
		excel: "엑셀에서 가져오기",
		editor: "목록 편집",
	};
	const canEdit = !room || (room.isHost && !room.lockedReason && !pending);
	const roomCopySaved = Boolean(
		room &&
			savedRoomCopy?.version === room.version &&
			library.lists.some((list) => list.id === savedRoomCopy.id),
	);

	function hasSaveSlot(listId?: string) {
		if (
			library.lists.length < candidateDraftLimits.savedLists ||
			library.lists.some((list) => list.id === listId)
		)
			return true;
		setError(
			`저장 목록은 ${candidateDraftLimits.savedLists}개까지입니다. 내 목록에서 하나를 삭제한 뒤 새 목록을 만들어 주세요.`,
		);
		setView("current");
		return false;
	}
	function edit(list: CandidateListDraft) {
		if (!canEdit || (!room && !hasSaveSlot(list.id))) return;
		const next = copy(list);
		setDraft(next);
		baseline.current = JSON.stringify(next);
		setError("");
		setNotice("");
		setView("editor");
	}
	function choose() {
		if (!canEdit || (!room && !hasSaveSlot())) return;
		setDraft(null);
		setImportMode("replace");
		setError("");
		setNotice("");
		setView("choose");
	}
	function newList() {
		if (!canEdit || (!room && !hasSaveSlot())) return;
		edit({
			id: newId(),
			name: "새 후보 목록",
			items: Array.from({ length: 2 }, () => ({
				id: newId(),
				name: "",
				category: "",
				included: true,
			})),
		});
	}
	function openImport(kind: "templates" | "excel", mode: "replace" | "append") {
		if (!canEdit) return;
		setImportMode(mode);
		setExcelReady(false);
		setError("");
		setView(kind);
	}
	function importItems(name: string, items: CandidateListItem[]) {
		if (!canEdit) return;
		if (!room && importMode === "replace" && !hasSaveSlot()) return;
		const incoming = items.map((item) => ({ ...item, id: newId() }));
		const next =
			importMode === "append" && draft
				? { ...draft, items: [...draft.items, ...incoming] }
				: { id: newId(), name, items: incoming };
		if (next.items.length > candidateDraftLimits.items) {
			setError(
				`후보는 ${candidateDraftLimits.items}개까지 편집할 수 있습니다.`,
			);
			return;
		}
		setError("");
		if (importMode === "append" && draft) {
			setDraft(next);
			setView("editor");
		} else edit(next);
	}
	function back() {
		if (pending) return;
		setError("");
		if (view === "editor") {
			if (draft && JSON.stringify(draft) !== baseline.current)
				setConfirm({ kind: "discard" });
			else setView("current");
		} else if (view === "templates" || view === "excel") {
			setView(importMode === "append" ? "editor" : "choose");
		} else setView("current");
	}
	function persist(next: CandidateLibrary) {
		if (loaded.error)
			throw new Error(
				"저장된 목록을 읽지 못해 덮어쓰지 않았습니다. 브라우저 저장 설정을 확인해 주세요.",
			);
		if (storageMode === "fail")
			throw new Error("저장 실패 예제입니다. 편집 내용은 유지됩니다.");
		const storage = window.localStorage;
		if (storage.getItem(previewLibraryKey) !== storedRaw.current)
			throw new Error(
				"다른 화면에서 저장 목록이 바뀌었습니다. 새로고침 후 다시 확인해 주세요. 현재 초안은 유지됩니다.",
			);
		writeCandidateLibrary(
			{
				setItem(key, value) {
					storage.setItem(key, value);
					storedRaw.current = value;
				},
			},
			next,
		);
		setLibrary(next);
	}
	async function save(value: CandidateListDraft) {
		if (applying.current || !canEdit) return;
		if (room) {
			applying.current = true;
			setPending(true);
			setError("");
			try {
				await room.onApply(copy(value));
				setDraft(null);
				setNotice("방 후보를 적용했습니다.");
				setView("current");
			} catch (failure) {
				setError(
					failure instanceof Error
						? failure.message
						: "적용하지 못했습니다. 초안은 유지됩니다.",
				);
			} finally {
				applying.current = false;
				setPending(false);
			}
			return;
		}
		const saved: SavedCandidateList = { ...copy(value), updatedAt: Date.now() };
		const lists = [
			saved,
			...library.lists.filter((list) => list.id !== saved.id),
		];
		if (lists.length > candidateDraftLimits.savedLists) {
			setError(
				`저장 목록은 ${candidateDraftLimits.savedLists}개까지입니다. 사용하지 않는 저장 목록을 삭제해 주세요.`,
			);
			return;
		}
		try {
			persist({ version: 1, lists, lastUsedId: saved.id });
			setApplied(copy(saved));
			setDraft(null);
			setError("");
			setNotice("목록을 저장하고 사용합니다.");
			setView("current");
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "목록을 저장하지 못했습니다. 편집 내용은 유지됩니다.",
			);
		}
	}
	function saveRoomCopy() {
		if (!room || roomCopySaved) return;
		if (!hasSaveSlot()) return;
		try {
			const saved = { ...copy(applied), id: newId(), updatedAt: Date.now() };
			persist({
				version: 1,
				lists: [saved, ...library.lists],
				lastUsedId: saved.id,
			});
			setSavedRoomCopy({ version: room.version, id: saved.id });
			setError("");
			setNotice("내 목록에 사본을 저장했습니다.");
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "내 목록에 저장하지 못했습니다.",
			);
		}
	}
	function deleteSaved(list: SavedCandidateList) {
		try {
			persist({
				...library,
				lists: library.lists.filter((entry) => entry.id !== list.id),
				lastUsedId: library.lastUsedId === list.id ? null : library.lastUsedId,
			});
			setNotice("저장 목록에서 삭제했습니다.");
			setError("");
		} catch (failure) {
			setError(
				failure instanceof Error ? failure.message : "삭제하지 못했습니다.",
			);
		}
		focusAfterConfirm.current = true;
		setConfirm(null);
	}
	return (
		<div className="sb-candidate-flow">
			<aside className="sb-list-tools" aria-label="미리보기 안내">
				<p>
					{room
						? "방 생성 후 편집 미리보기 · 방 적용은 모의 응답 · 저장은 예제 전용"
						: "흐름 미리보기 · 실제 방 변경 없음 · 저장은 예제 전용 브라우저 공간"}
				</p>
			</aside>
			<main className="cl-manager">
				<header className="cl-heading">
					{view !== "current" && (
						<button
							type="button"
							className="cl-button"
							onClick={back}
							aria-label="뒤로"
							disabled={pending}
						>
							<ArrowLeft size={20} aria-hidden="true" />
						</button>
					)}
					<h1 ref={heading} tabIndex={-1}>
						{titles[view]}
					</h1>
				</header>
				{view !== "current" && (
					<nav className="cl-steps" aria-label="목록 관리 단계">
						<ol>
							<li aria-current={view !== "editor" ? "step" : undefined}>
								1 준비 방법
							</li>
							<li aria-current={view === "editor" ? "step" : undefined}>
								2 편집
							</li>
							<li>{room ? "3 방에 적용" : "3 저장하고 사용"}</li>
						</ol>
					</nav>
				)}
				{loaded.error && (
					<p className="cl-inline-message" role="alert">
						{loaded.error} 저장된 원본은 변경하지 않았습니다.
					</p>
				)}
				<output className="cl-inline-message">{notice}</output>
				{room?.lockedReason && (
					<output className="cl-inline-message">{room.lockedReason}</output>
				)}
				{view !== "editor" && (
					<p className="cl-inline-message" role="alert">
						{error}
					</p>
				)}
				{view === "editor" && draft ? (
					<CandidateListEditor
						draft={draft}
						onChange={(value) => {
							setDraft(value);
							setError("");
						}}
						onCancel={back}
						onSave={save}
						onImportTemplate={() => openImport("templates", "append")}
						onImportExcel={() => openImport("excel", "append")}
						error={error}
						submitLabel={room ? "방에 적용" : undefined}
						pending={pending}
						disabled={!canEdit && !pending}
					/>
				) : (
					<div className="cl-stage">
						{view === "current" && (
							<>
								<section aria-labelledby="cl-current-title">
									<div className="cl-current">
										<div>
											<p className="cl-summary">
												{room
													? `방에 적용된 목록 · v${room.version}`
													: "지금 사용하는 목록"}
											</p>
											<h2 id="cl-current-title">{applied.name}</h2>
											<span>
												{count}개 포함 · 전체 {applied.items.length}개
											</span>
										</div>
										{(!room || room.isHost) && (
											<div className="cl-actionbar">
												<button
													type="button"
													className="cl-button"
													onClick={() => edit(applied)}
													disabled={!canEdit}
												>
													목록 편집
												</button>
												<button
													type="button"
													className="cl-button cl-primary"
													onClick={choose}
													disabled={!canEdit}
												>
													<RotateCcw size={18} aria-hidden="true" />
													목록 리셋
												</button>
											</div>
										)}
									</div>
									<ol className="cl-current-items" aria-label="현재 후보 목록">
										{applied.items.map((item, index) => (
											<li key={item.id} data-included={item.included}>
												<span>{index + 1}</span>
												<div>
													<strong>{item.name}</strong>
													<small>{item.category || "분류 없음"}</small>
												</div>
												{!item.included && <span>제외</span>}
											</li>
										))}
									</ol>
								</section>
								{room?.isHost && (
									<div className="cl-room-save">
										<button
											type="button"
											className="cl-button"
											disabled={roomCopySaved}
											onClick={saveRoomCopy}
										>
											{roomCopySaved ? "내 목록에 저장됨" : "내 목록에 저장"}
										</button>
									</div>
								)}
								{(!room || room.isHost) && (
									<section
										className="cl-saved"
										aria-labelledby="cl-saved-title"
									>
										<h2 id="cl-saved-title">
											<FolderOpen size={21} aria-hidden="true" />내 목록{" "}
											<span>{library.lists.length}</span>
										</h2>
										{library.lists.length ? (
											<ul>
												{library.lists.map((list) => (
													<li className="cl-saved-row" key={list.id}>
														<div>
															<strong>{list.name}</strong>
															<span>
																{
																	list.items.filter((item) => item.included)
																		.length
																}
																개 포함
																{!room && list.id === applied.id && (
																	<>
																		{" "}
																		· <Check size={14} aria-hidden="true" />{" "}
																		사용 중
																	</>
																)}
															</span>
														</div>
														<button
															type="button"
															className="cl-button"
															onClick={() => edit(list)}
															disabled={!canEdit}
															aria-label={`${list.name} 불러와 편집`}
														>
															불러와 편집
														</button>
														<button
															type="button"
															className="cl-button"
															onClick={() =>
																setConfirm({ kind: "delete", list })
															}
															aria-label={`${list.name} 저장 목록 삭제`}
														>
															<Trash2 size={18} aria-hidden="true" />
														</button>
													</li>
												))}
											</ul>
										) : (
											<p>저장하고 사용한 목록이 여기에 남습니다.</p>
										)}
									</section>
								)}
							</>
						)}
						{view === "choose" && (
							<>
								<p className="cl-summary">
									기존 목록은 새 목록을 적용할 때 바뀝니다.
								</p>
								<div className="cl-source-options">
									<button
										type="button"
										className="cl-source-option"
										onClick={newList}
										disabled={!canEdit}
									>
										<Plus size={28} aria-hidden="true" />
										<strong>새로 만들기</strong>
										<small>직접 하나씩 추가</small>
									</button>
									<button
										type="button"
										className="cl-source-option"
										onClick={() => openImport("templates", "replace")}
										disabled={!canEdit}
									>
										<LayoutTemplate size={28} aria-hidden="true" />
										<strong>템플릿에서 가져오기</strong>
										<small>준비된 목록으로 시작</small>
									</button>
									<button
										type="button"
										className="cl-source-option"
										onClick={() => openImport("excel", "replace")}
										disabled={!canEdit}
									>
										<FileSpreadsheet size={28} aria-hidden="true" />
										<strong>엑셀에서 가져오기</strong>
										<small>예제 파일로 흐름 확인</small>
									</button>
								</div>
							</>
						)}
						{view === "templates" && (
							<>
								<p className="cl-summary">
									가져온 뒤 자유롭게 편집할 수 있습니다.
								</p>
								<div className="cl-template-options">
									{templates.map((template) => (
										<button
											type="button"
											className="cl-button"
											key={template.id}
											onClick={() => importItems(template.name, template.items)}
											disabled={!canEdit}
										>
											<LayoutTemplate size={22} aria-hidden="true" />
											<strong>{template.name}</strong>
											<span>{template.items.length}개</span>
										</button>
									))}
								</div>
							</>
						)}
						{view === "excel" && (
							<>
								<p className="cl-summary">
									예제 파일로 가져오기 흐름을 확인합니다. 실제 .xlsx 읽기는 후속
									단계입니다.
								</p>
								{!excelReady ? (
									<button
										type="button"
										className="cl-source-option"
										onClick={() => setExcelReady(true)}
										disabled={!canEdit}
									>
										<FileSpreadsheet size={30} aria-hidden="true" />
										<strong>예제 엑셀 선택</strong>
										<small>점심후보_예제.xlsx</small>
									</button>
								) : (
									<>
										<div className="cl-current">
											<h2>점심후보_예제.xlsx</h2>
											<button
												type="button"
												className="cl-button"
												onClick={() => setExcelReady(false)}
												disabled={!canEdit}
											>
												다시 선택
											</button>
										</div>
										<p className="cl-summary">
											5개 후보 · 이름 확인 1개 · 같은 이름도 별도 후보로
											가져옵니다.
										</p>
										<table className="cl-import-preview">
											<caption>엑셀 후보 미리보기</caption>
											<thead>
												<tr>
													<th scope="col">행</th>
													<th scope="col">후보 이름</th>
													<th scope="col">분류</th>
												</tr>
											</thead>
											<tbody>
												{excelRows.map((row, index) => (
													<tr
														key={`excel-${index + 2}`}
														className={
															!row.name ? "cl-import-error" : undefined
														}
													>
														<th scope="row">{index + 2}</th>
														<td>{row.name || "이름 필요"}</td>
														<td>{row.category}</td>
													</tr>
												))}
											</tbody>
										</table>
										<div className="cl-actionbar">
											<button
												type="button"
												className="cl-button cl-primary"
												disabled={!canEdit}
												onClick={() =>
													importItems(
														"엑셀에서 가져온 목록",
														excelRows.map((row) => ({
															...row,
															id: newId(),
															included: true,
														})),
													)
												}
											>
												편집기로 가져오기
											</button>
										</div>
									</>
								)}
							</>
						)}
					</div>
				)}
			</main>
			{confirm && (
				<Confirmation
					title={
						confirm.kind === "discard"
							? "편집 내용을 버릴까요?"
							: "저장 목록에서 삭제할까요?"
					}
					description={
						confirm.kind === "discard"
							? "현재 사용하는 목록과 저장된 목록은 유지됩니다."
							: `${confirm.list.name} 저장본을 삭제합니다. 현재 사용 중인 후보는 그대로입니다.`
					}
					action={confirm.kind === "discard" ? "편집 취소" : "삭제"}
					onKeep={() => setConfirm(null)}
					onConfirm={() => {
						if (confirm.kind === "delete") deleteSaved(confirm.list);
						else {
							setConfirm(null);
							setDraft(null);
							setError("");
							setView("current");
						}
					}}
				/>
			)}
		</div>
	);
}
