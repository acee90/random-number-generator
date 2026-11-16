import { FolderOpen, ListPlus, Plus, RotateCcw, Trash2 } from "lucide-react";
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { useLunchRoom } from "@/hooks/useLunchRoom";
import { lunchCategories } from "@/lib/lunch";
import {
	type RoomGameFilter as GameFilter,
	getEligibleRoomCandidates,
	getRoomPhase,
	lunchRoomLimits,
	type RoomCandidate,
	type RoomSnapshot,
} from "@/lib/lunchRoom";
import CandidateListLoadDialog, {
	type CandidateListSelection,
} from "./CandidateListLoadDialog";
import CandidateListSaveDialog from "./CandidateListSaveDialog";
import RoomGameFilter from "./RoomGameFilter";
import "./room-lifecycle.css";

type Room = ReturnType<typeof useLunchRoom>;
type StartOptions = { confirmReset?: boolean; expectedRevision?: number };
type Confirmation = { kind: "start" | "reset"; revision: number };
type StageAction = "open" | "close" | "finalize";

function gameFilterFor(snapshot: RoomSnapshot | null): GameFilter {
	return {
		categories: snapshot?.gameFilter?.categories ?? null,
		excludedIds: [
			...new Set([
				...(snapshot?.gameFilter?.excludedIds ?? []),
				...(snapshot?.candidates
					.filter((candidate) => candidate.included === false)
					.map((candidate) => candidate.id) ?? []),
			]),
		],
	};
}
function filterSignature(filter: GameFilter) {
	return JSON.stringify({
		categories:
			filter.categories === null ? null : [...filter.categories].sort(),
		excludedIds: [...filter.excludedIds].sort(),
	});
}

export default function RoomLifecyclePanel({
	room,
	busy,
	showResult,
	onStart,
	onHistory,
	historyButtonRef,
	children,
}: {
	room: Room;
	busy: boolean;
	showResult: boolean;
	onStart: (options?: StartOptions) => void;
	onHistory: () => void;
	historyButtonRef?: RefObject<HTMLButtonElement | null>;
	children: (requestStart: () => void) => ReactNode;
}) {
	const id = useId();
	const snapshot = room.snapshot;
	const liveSnapshot = useRef(snapshot);
	liveSnapshot.current = snapshot;
	const phase = snapshot ? getRoomPhase(snapshot) : "waiting";
	const editPhase = ["editing", "collecting", "reviewing"].includes(phase);
	const listScreen = editPhase;
	const connected = room.connection === "connected";
	const isHost = room.self?.isHost === true;
	const [stagePending, setStagePending] = useState<StageAction | null>(null);
	const stageRequest = useRef(false);
	const pending = Boolean(room.mutationPending) || room.candidatesPending;
	const locked = busy || pending || !connected || stagePending !== null;
	const candidates = snapshot?.candidates ?? [];
	const eligible = snapshot ? getEligibleRoomCandidates(snapshot) : [];
	const eligibleIds = new Set(eligible.map((entry) => entry.id));
	const eligibleProbability = eligible.length
		? new Intl.NumberFormat("ko-KR", {
				style: "percent",
				maximumFractionDigits: 2,
			}).format(1 / eligible.length)
		: "0%";
	const excludedIds = snapshot?.excludedIds ?? [];
	const excluded = candidates.filter((entry) => excludedIds.includes(entry.id));
	const manualExcluded = candidates.filter(
		(entry) =>
			entry.included === false ||
			snapshot?.gameFilter?.excludedIds.includes(entry.id),
	);
	const revision = snapshot?.revision ?? snapshot?.listVersion ?? 1;
	const excludeDrawn = snapshot?.excludeDrawn ?? false;
	const [recommendation, setRecommendation] = useState("");
	const [recommendationCategory, setRecommendationCategory] = useState("");
	const [recommendationPending, setRecommendationPending] = useState(false);
	const recommendationAttempt = useRef(0);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [localError, setLocalError] = useState("");
	const [candidateViewOpen, setCandidateViewOpen] = useState(false);
	const candidateViewTriggerRef = useRef<HTMLButtonElement | null>(null);
	const [discardOpen, setDiscardOpen] = useState(false);
	const [draftCandidates, setDraftCandidates] = useState<RoomCandidate[]>(() =>
		candidates.map((entry) => ({ ...entry })),
	);
	const [draftBaseVersion, setDraftBaseVersion] = useState(
		snapshot?.listVersion ?? 1,
	);
	const [originalCandidates, setOriginalCandidates] = useState(
		JSON.stringify(candidates),
	);
	const [draftPhase, setDraftPhase] = useState(phase);
	const [draftIntakeId, setDraftIntakeId] = useState<string | null>(
		snapshot?.intakeId ?? null,
	);
	const [draftStageInvalid, setDraftStageInvalid] = useState(false);
	const [newName, setNewName] = useState("");
	const [newCategory, setNewCategory] = useState("");
	const [writing, setWriting] = useState(false);
	const [loadOpen, setLoadOpen] = useState(false);
	const loadButtonRef = useRef<HTMLButtonElement | null>(null);
	const newCandidateRef = useRef<HTMLInputElement | null>(null);
	const [pendingLoad, setPendingLoad] = useState<CandidateListSelection | null>(
		null,
	);
	const [sourceName, setSourceName] = useState("후보 목록");
	const [saveOpen, setSaveOpen] = useState(false);
	const saveButtonRef = useRef<HTMLButtonElement | null>(null);
	const [saveCandidates, setSaveCandidates] = useState<RoomCandidate[]>([]);
	const [removeOwn, setRemoveOwn] = useState<RoomCandidate | null>(null);
	const [editError, setEditError] = useState("");
	const [editorMode, setEditorMode] = useState<"list" | "filter">("list");
	const liveFilter = gameFilterFor(snapshot);
	const liveFilterKey = filterSignature(liveFilter);
	const [draftFilter, setDraftFilter] = useState<GameFilter>(() =>
		gameFilterFor(snapshot),
	);
	const [originalFilter, setOriginalFilter] = useState(() =>
		filterSignature(gameFilterFor(snapshot)),
	);
	const filterDirty = filterSignature(draftFilter) !== originalFilter;
	const draftIds = new Set(draftCandidates.map((candidate) => candidate.id));
	const draftFilterMatchesLive =
		liveFilterKey ===
		filterSignature({
			...draftFilter,
			excludedIds: draftFilter.excludedIds.filter((candidateId) =>
				draftIds.has(candidateId),
			),
		});
	const candidatesDirty =
		JSON.stringify(draftCandidates) !== originalCandidates;
	const dirty = candidatesDirty || filterDirty;
	const unsaved =
		dirty || Boolean(newName.trim()) || Boolean(newCategory.trim());
	const sameDraftStage =
		phase === draftPhase &&
		(snapshot?.intakeId ?? null) === draftIntakeId &&
		!draftStageInvalid;
	const editable = isHost && editPhase && sameDraftStage && !locked;
	const showSetupChoice =
		isHost &&
		phase === "editing" &&
		candidates.length === 0 &&
		draftCandidates.length === 0 &&
		!writing &&
		!unsaved;
	const categorySuggestions = [
		...new Set(
			[
				...lunchCategories,
				...candidates.map((entry) => entry.category),
				...draftCandidates.map((entry) => entry.category),
			].filter(Boolean),
		),
	];
	const liveCandidates = JSON.stringify(candidates);
	const liveKey = JSON.stringify([
		snapshot?.roomId,
		phase,
		snapshot?.intakeId,
		snapshot?.listVersion,
		liveCandidates,
		liveFilterKey,
		isHost,
	]);
	const observedLive = useRef<string | null>(null);
	const lastEditAttempt = useRef<string | null>(null);
	const phaseLabel = listScreen
		? phase === "editing"
			? candidates.length === 0
				? "후보 만들기"
				: "후보 편집 중"
			: phase === "collecting"
				? "후보 추천 접수 중"
				: "접수 종료 · 목록 확인"
		: showResult
			? "추첨 결과"
			: busy
				? "추첨 진행 중"
				: "다음 추첨 대기";
	// Inclusion is a game condition. A saved draft may predate the migration of
	// legacy included flags, so always project that condition from the live room.
	const currentById = new Map(
		candidates.map((candidate) => [candidate.id, candidate]),
	);
	const liveDraftCandidates = draftCandidates.map((candidate) => ({
		...candidate,
		category: candidate.category.trim() || "미분류",
		included: currentById.get(candidate.id)?.included ?? candidate.included,
	}));
	const previewEligible = snapshot
		? getEligibleRoomCandidates({
				...snapshot,
				candidates: filterDirty
					? liveDraftCandidates.map((candidate) => ({
							...candidate,
							included: true,
						}))
					: liveDraftCandidates,
				gameFilter: draftFilter,
			})
		: [];

	// Only real shared changes rebase clean fields. Chat, view popups and local
	// keystrokes must never replace a draft; only our own ACK completes a save.
	useEffect(() => {
		if (!snapshot || !isHost || observedLive.current === liveKey) return;
		observedLive.current = liveKey;
		if (
			unsaved &&
			(phase !== draftPhase || (snapshot.intakeId ?? null) !== draftIntakeId)
		) {
			setDraftStageInvalid(true);
			return;
		}
		if (!unsaved) {
			setDraftPhase(phase);
			setDraftIntakeId(snapshot.intakeId ?? null);
			setDraftStageInvalid(false);
		}
		if (!filterDirty) {
			setDraftFilter(gameFilterFor(snapshot));
			setOriginalFilter(liveFilterKey);
		}
		if (!candidatesDirty) {
			setDraftCandidates(candidates.map((entry) => ({ ...entry })));
			setOriginalCandidates(liveCandidates);
			setDraftBaseVersion(snapshot.listVersion);
		}
	}, [
		snapshot,
		isHost,
		liveKey,
		unsaved,
		phase,
		draftPhase,
		draftIntakeId,
		candidatesDirty,
		filterDirty,
		liveFilterKey,
		candidates,
		liveCandidates,
	]);

	function resetDraft() {
		const current = liveSnapshot.current;
		if (!current) return;
		const copy = current.candidates.map((entry) => ({ ...entry }));
		setDraftCandidates(copy);
		setDraftFilter(gameFilterFor(current));
		setOriginalFilter(filterSignature(gameFilterFor(current)));
		setOriginalCandidates(JSON.stringify(copy));
		setDraftBaseVersion(current.listVersion);
		setDraftPhase(getRoomPhase(current));
		setDraftIntakeId(current.intakeId ?? null);
		setDraftStageInvalid(false);
		setNewName("");
		setNewCategory("");
		setEditError("");
		lastEditAttempt.current = null;
	}
	function requestReset() {
		if (unsaved) setDiscardOpen(true);
		else resetDraft();
	}
	function requestStart() {
		setLocalError("");
		if (!excludeDrawn && excludedIds.length > 0) {
			setConfirmation({ kind: "start", revision });
			return;
		}
		onStart({ expectedRevision: revision });
	}
	async function recommend() {
		const name = recommendation.trim();
		if (!name || locked || recommendationPending || phase !== "collecting")
			return;
		const attempt = ++recommendationAttempt.current;
		setRecommendationPending(true);
		const category = recommendationCategory.trim() || "미분류";
		const accepted = await room.addCandidate(name, category);
		if (attempt !== recommendationAttempt.current) return;
		setRecommendationPending(false);
		if (accepted) {
			setRecommendation((value) => (value.trim() === name ? "" : value));
			setRecommendationCategory((value) =>
				(value.trim() || "미분류") === category ? "" : value,
			);
		}
	}
	async function applyEdit(): Promise<boolean> {
		if (!editable) return false;
		if (!unsaved) return true;
		if (!newName.trim() && newCategory.trim()) {
			setEditError("분류와 함께 추가할 후보 이름을 입력해 주세요.");
			return false;
		}
		let items = liveDraftCandidates;
		const pendingName = newName.trim();
		if (pendingName) {
			if (items.length >= lunchRoomLimits.maxCandidates) {
				setEditError(
					`후보는 ${lunchRoomLimits.maxCandidates}개까지 추가할 수 있습니다.`,
				);
				return false;
			}
			items = [
				...items,
				{
					id: crypto.randomUUID(),
					name: pendingName,
					category: newCategory.trim() || "미분류",
					included: true,
				},
			];
			setDraftCandidates(items);
			setNewName("");
			setNewCategory("");
		}
		if (items.some((entry) => !entry.name.trim())) {
			setEditError("모든 후보 이름을 입력해 주세요.");
			return false;
		}
		const itemIds = new Set(items.map((candidate) => candidate.id));
		const nextFilter = {
			...draftFilter,
			excludedIds: draftFilter.excludedIds.filter((candidateId) =>
				itemIds.has(candidateId),
			),
		};
		// A persisted snapshot can arrive even when the mutation ACK is lost. A
		// retry may finish the user's intended condition without writing it again.
		const filterAlreadyApplied = liveFilterKey === filterSignature(nextFilter);
		if (
			filterDirty &&
			liveFilterKey !== originalFilter &&
			!filterAlreadyApplied
		) {
			setEditError(
				"공유 필터가 바뀌었습니다. 초안을 보존했어요. 최신 조건을 확인한 뒤 다시 편집해 주세요.",
			);
			return false;
		}
		const changedCandidates = candidatesDirty || Boolean(pendingName);
		const payload = {
			baseVersion: changedCandidates
				? draftBaseVersion
				: (snapshot?.listVersion ?? 1),
			...(changedCandidates ? { candidates: items } : {}),
		};
		const signature = JSON.stringify(payload);
		if (
			changedCandidates &&
			snapshot?.listVersion !== draftBaseVersion &&
			lastEditAttempt.current !== signature
		) {
			setEditError(
				"후보 목록이 바뀌었습니다. 초안을 보존했어요. 최신 목록과 비교한 뒤 다시 편집해 주세요.",
			);
			return false;
		}
		lastEditAttempt.current = signature;
		setEditError("");
		try {
			if (changedCandidates && !(await room.editRoom(payload))) return false;
			const current = liveSnapshot.current;
			const expectedVersion = payload.baseVersion + Number(changedCandidates);
			const acknowledged =
				changedCandidates && current && current.listVersion >= expectedVersion
					? current.candidates.map((entry) => ({ ...entry }))
					: items;
			setDraftCandidates(acknowledged);
			setOriginalCandidates(JSON.stringify(acknowledged));
			setDraftBaseVersion(Math.max(current?.listVersion ?? 1, expectedVersion));
			if (changedCandidates) {
				setDraftFilter(nextFilter);
				// Candidate deletion prunes filter IDs on the server. Keep that expected
				// baseline when a later filter save fails, so the remaining draft can retry.
				setOriginalFilter(
					filterSignature({
						...liveFilter,
						excludedIds: liveFilter.excludedIds.filter((candidateId) =>
							itemIds.has(candidateId),
						),
					}),
				);
			}
			if (filterDirty) {
				// The hook reads its acknowledged snapshot ref. A React render may still
				// be queued after the candidate ACK, so don't pass a stale render revision.
				if (!filterAlreadyApplied && !(await room.updateGameFilter(nextFilter)))
					return false;
				setDraftFilter(nextFilter);
				setOriginalFilter(filterSignature(nextFilter));
				const normalized = acknowledged.map((candidate) => ({
					...candidate,
					included: true,
				}));
				setDraftCandidates(normalized);
				setOriginalCandidates(JSON.stringify(normalized));
			}
			lastEditAttempt.current = null;
			return true;
		} catch {
			setEditError(
				"변경을 저장하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.",
			);
			return false;
		}
	}
	async function changeStage(action: StageAction) {
		if (!isHost || locked || stageRequest.current) return;
		stageRequest.current = true;
		setStagePending(action);
		try {
			if (unsaved && !(await applyEdit())) return;
			if (action === "open") await room.openIntake();
			else if (action === "close") await room.closeIntake();
			else await room.finalizeIntake();
		} finally {
			stageRequest.current = false;
			setStagePending(null);
		}
	}
	async function confirm() {
		const action = confirmation;
		setConfirmation(null);
		if (!action) return;
		if (action.revision !== revision || locked || !isHost) {
			setLocalError(
				"게임 조건이 바뀌었어요. 목록을 확인한 뒤 다시 진행해 주세요.",
			);
			return;
		}
		if (action.kind === "start")
			onStart({ confirmReset: true, expectedRevision: action.revision });
		else await room.resetExclusions(action.revision);
	}
	function addDraftCandidate() {
		const name = newName.trim();
		if (
			!name ||
			!editable ||
			draftCandidates.length >= lunchRoomLimits.maxCandidates
		)
			return;
		setDraftCandidates((entries) => [
			...entries,
			{
				id: crypto.randomUUID(),
				name,
				category: newCategory.trim() || "미분류",
				included: true,
			},
		]);
		setNewName("");
		setNewCategory("");
	}
	function importList(selection: CandidateListSelection) {
		if (!editable) return false;
		setDraftCandidates(
			selection.candidates.map((candidate) => ({
				...candidate,
				included: true,
			})),
		);
		setDraftFilter({ categories: null, excludedIds: [] });
		setEditorMode("list");
		setSourceName(selection.name);
		setNewName("");
		setNewCategory("");
		setWriting(true);
		setEditError("");
		setLoadOpen(false);
		setPendingLoad(null);
		requestAnimationFrame(() => newCandidateRef.current?.focus());
		return true;
	}
	function selectList(selection: CandidateListSelection) {
		if (!editable) return false;
		if (draftCandidates.length > 0 || newName.trim() || newCategory.trim()) {
			setPendingLoad(selection);
			return false;
		}
		return importList(selection);
	}
	function openLoader(event: React.MouseEvent<HTMLButtonElement>) {
		loadButtonRef.current = event.currentTarget;
		setLoadOpen(true);
	}
	function openSave() {
		if (!editable) return;
		const items = [...draftCandidates];
		if (newName.trim())
			items.push({
				id: crypto.randomUUID(),
				name: newName.trim(),
				category: newCategory.trim() || "미분류",
				included: true,
			});
		setSaveCandidates(items);
		setSaveOpen(true);
	}
	function exclusionReason(candidate: RoomCandidate) {
		if (
			candidate.included === false ||
			snapshot?.gameFilter?.excludedIds.includes(candidate.id)
		)
			return "직접 제외";
		if (
			snapshot?.gameFilter?.categories &&
			!snapshot.gameFilter.categories.includes(candidate.category || "미분류")
		)
			return "분류 조건으로 제외";
		if (excludeDrawn && excludedIds.includes(candidate.id)) return "당첨 제외";
		return "추첨 포함";
	}
	const gameOptions = (
		<section
			className="room-game-options room-next-options"
			aria-labelledby={`${id}-game-options-title`}
		>
			<h3 id={`${id}-game-options-title`}>
				{showResult ? "다음 게임 옵션" : "이번 게임 옵션"}
			</h3>
			<label>
				<input
					type="checkbox"
					checked={excludeDrawn}
					disabled={
						!isHost ||
						locked ||
						["fetching", "drawing", "closed"].includes(phase)
					}
					onChange={(event) =>
						void room.updateRoomOptions(event.target.checked, revision)
					}
				/>
				중복 없이 추첨 · 뽑힌 후보 제외
			</label>
			<p>
				{busy || phase === "fetching" || phase === "drawing"
					? "추첨이 끝난 뒤 변경할 수 있습니다."
					: showResult
						? "다음 추첨에 적용됩니다. 이번 결과는 유지됩니다."
						: "이번 추첨에 적용됩니다. 옵션을 끄기만 하면 제외 내역은 유지됩니다."}
			</p>
		</section>
	);

	return (
		<section
			className="room-lifecycle-panel"
			data-phase={phase}
			aria-label="게임 진행"
		>
			<div className="room-lifecycle-heading">
				<div>
					<p className="room-eyebrow">같은 방에서 계속 함께</p>
					<h2>{phaseLabel}</h2>
				</div>
				<div className="room-lifecycle-tools">
					<Dialog open={candidateViewOpen} onOpenChange={setCandidateViewOpen}>
						<Button
							variant="outline"
							size="sm"
							aria-haspopup="dialog"
							onClick={(event) => {
								candidateViewTriggerRef.current = event.currentTarget;
								setCandidateViewOpen(true);
							}}
						>
							후보 보기
						</Button>
						<DialogContent
							className="room-options-dialog"
							aria-labelledby={`${id}-options-title`}
							onCloseAutoFocus={(event) => {
								event.preventDefault();
								if (candidateViewTriggerRef.current?.isConnected)
									candidateViewTriggerRef.current.focus();
							}}
							onOpenAutoFocus={(event) => {
								event.preventDefault();
								document.getElementById(`${id}-options-title`)?.focus();
							}}
						>
							<DialogHeader>
								<DialogTitle id={`${id}-options-title`} tabIndex={-1}>
									후보 보기
								</DialogTitle>
								<DialogDescription>
									다음 추첨의 후보, 등록자와 적용 확률을 확인하는 조회
									화면입니다.
								</DialogDescription>
							</DialogHeader>
							<ul className="room-options-readonly">
								{candidates.map((candidate) => (
									<li key={candidate.id}>
										<strong>{candidate.name}</strong>
										<span>{exclusionReason(candidate)}</span>
										<small>
											{candidate.ownerName
												? `${candidate.ownerName} 추천`
												: candidate.category}
										</small>
										<small>
											추첨 확률{" "}
											{eligibleIds.has(candidate.id)
												? eligibleProbability
												: "0%"}
										</small>
									</li>
								))}
							</ul>
							<DialogFooter>
								<Button
									variant="outline"
									onClick={() => setCandidateViewOpen(false)}
								>
									닫기
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
					<Button
						variant="ghost"
						size="sm"
						onClick={onHistory}
						ref={historyButtonRef}
					>
						지난 기록
					</Button>
				</div>
			</div>

			<datalist id={`${id}-categories`}>
				{categorySuggestions.map((category) => (
					<option key={category} value={category} />
				))}
			</datalist>
			{localError && (
				<p role="alert" className="room-error">
					{localError}
				</p>
			)}
			{!listScreen && unsaved && (
				<output className="room-draft-notice">
					적용하지 않은 편집 내용을 보관하고 있어요. 편집 단계에서 확인할 수
					있습니다.
				</output>
			)}
			{listScreen ? (
				<div className="room-intake-screen">
					<p className="room-intake-description">
						{phase === "editing"
							? isHost
								? showSetupChoice
									? "추첨할 후보를 직접 작성하거나 목록을 불러와 주세요."
									: "후보를 편집하고 이번 추첨에 넣을 후보를 선택하세요. 마감하면 룰렛 대기로 이동합니다."
								: "방장이 후보 목록을 편집하고 있습니다. 편집을 마치거나 추천 접수를 열 때까지 기다려 주세요."
							: phase === "collecting"
								? "추천할 후보를 추가해 주세요. 방장이 마감하면 룰렛으로 돌아갑니다."
								: "접수가 종료되었습니다. 방장이 목록을 확인하고 있습니다. 다시 열리면 추천을 이어갈 수 있어요."}
					</p>
					{showSetupChoice && (
						<section className="room-setup-choice" aria-label="후보 만들기">
							<div className="room-setup-empty">
								<ListPlus size={30} aria-hidden="true" />
								<h3>아직 후보가 없어요.</h3>
								<p>후보 0개 · 준비할 방법을 선택하세요.</p>
							</div>
							<div className="room-setup-paths">
								<Button
									variant="outline"
									disabled={!editable}
									onClick={() => {
										setSourceName("직접 작성");
										setWriting(true);
										requestAnimationFrame(() =>
											newCandidateRef.current?.focus(),
										);
									}}
								>
									<Plus size={24} aria-hidden="true" />
									<strong>새로 작성</strong>
									<span>원하는 후보를 직접 입력해요.</span>
								</Button>
								<Button
									variant="outline"
									disabled={!editable}
									onClick={openLoader}
									aria-haspopup="dialog"
								>
									<FolderOpen size={24} aria-hidden="true" />
									<strong>목록 불러오기</strong>
									<span>기본 목록이나 저장한 목록을 가져와요.</span>
								</Button>
							</div>
						</section>
					)}
					{isHost && !showSetupChoice && (
						<div className="room-intake-actions">
							<Button
								variant="outline"
								disabled={locked}
								onClick={() =>
									void changeStage(phase === "collecting" ? "close" : "open")
								}
							>
								{phase === "editing"
									? "후보 추천받기"
									: phase === "collecting"
										? "접수 종료"
										: "다시 접수받기"}
							</Button>
							<Button
								disabled={
									locked ||
									((unsaved ? previewEligible.length : eligible.length) === 0 &&
										!newName.trim())
								}
								onClick={() => void changeStage("finalize")}
							>
								{stagePending === "finalize" ? "마감 중…" : "마감"}
							</Button>
							<p>
								{phase === "collecting"
									? "접수 종료: 목록에서 계속 확인 · 마감: 룰렛 대기로 이동"
									: "마감하면 변경사항을 적용하고 룰렛 대기로 이동합니다."}
							</p>
						</div>
					)}
					{!showSetupChoice && gameOptions}
					{isHost ? (
						!showSetupChoice && (
							<section className="room-inline-editor" aria-label="후보 편집">
								<div className="room-inline-source">
									<p>{sourceName}</p>
									<Button
										variant="outline"
										size="sm"
										disabled={!editable}
										onClick={openLoader}
										aria-haspopup="dialog"
									>
										목록 불러오기
									</Button>
								</div>

								<fieldset className="room-editor-modes">
									<legend className="sr-only">후보 편집 방식</legend>
									<Button
										variant="ghost"
										size="sm"
										aria-pressed={editorMode === "list"}
										onClick={() => setEditorMode("list")}
									>
										목록 편집
									</Button>
									<Button
										variant="ghost"
										size="sm"
										aria-pressed={editorMode === "filter"}
										onClick={() => setEditorMode("filter")}
									>
										게임 필터
									</Button>
								</fieldset>
								{editorMode === "list" && (
									<div className="room-candidate-add room-inline-add">
										<label
											className="room-candidate-field"
											htmlFor={`${id}-new-name`}
										>
											<span>후보 이름</span>
											<Input
												ref={newCandidateRef}
												id={`${id}-new-name`}
												aria-label="새 후보 이름"
												value={newName}
												maxLength={80}
												disabled={!editable}
												onChange={(event) => setNewName(event.target.value)}
												onKeyDown={(event) => {
													if (
														event.key === "Enter" &&
														!event.nativeEvent.isComposing
													) {
														event.preventDefault();
														addDraftCandidate();
													}
												}}
											/>
										</label>
										<label
											className="room-candidate-field"
											htmlFor={`${id}-new-category`}
										>
											<span>분류 (선택)</span>
											<Input
												id={`${id}-new-category`}
												aria-label="새 후보 분류"
												list={`${id}-categories`}
												value={newCategory}
												maxLength={24}
												disabled={!editable}
												onChange={(event) => setNewCategory(event.target.value)}
											/>
										</label>
										<Button
											variant="outline"
											disabled={
												!editable ||
												!newName.trim() ||
												draftCandidates.length >= lunchRoomLimits.maxCandidates
											}
											onClick={addDraftCandidate}
										>
											<Plus size={16} aria-hidden="true" />
											후보 추가
										</Button>
									</div>
								)}

								<div className="room-inline-toolbar">
									<p className="room-intake-count">
										전체 {draftCandidates.length}개 · 이번 추첨{" "}
										{previewEligible.length}개
										{unsaved ? " · 미적용 변경 있음" : ""}
									</p>
									<Button
										variant="outline"
										size="sm"
										disabled={!editable || !unsaved}
										onClick={() => void applyEdit()}
									>
										{["edit", "filter"].includes(room.mutationPending ?? "")
											? "적용 중…"
											: "변경 적용"}
									</Button>
									<Button
										variant="ghost"
										size="sm"
										disabled={locked || !unsaved}
										onClick={requestReset}
									>
										변경 취소
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={
											!editable ||
											(draftCandidates.length === 0 && !newName.trim())
										}
										ref={saveButtonRef}
										onClick={openSave}
									>
										내 목록에 저장
									</Button>
								</div>
								{editorMode === "list" &&
									previewEligible.length === 0 &&
									draftCandidates.length > 0 && (
										<div className="room-edit-conflict">
											<p>
												현재 게임 조건에 맞는 후보가 없습니다. 후보 원본을
												유지하고 필터를 초기화할 수 있어요.
											</p>
											<Button
												variant="outline"
												size="sm"
												disabled={locked}
												onClick={() =>
													setDraftFilter({ categories: null, excludedIds: [] })
												}
											>
												필터 초기화
											</Button>
										</div>
									)}
								{candidatesDirty &&
									snapshot?.listVersion !== draftBaseVersion && (
										<div className="room-edit-conflict">
											<p>
												편집하는 동안 공유 후보가 바뀌었습니다. 현재 초안은
												유지됩니다.
											</p>
											<Button
												variant="outline"
												size="sm"
												disabled={locked}
												onClick={requestReset}
											>
												최신 후보 불러오기
											</Button>
										</div>
									)}
								{filterDirty &&
									liveFilterKey !== originalFilter &&
									!draftFilterMatchesLive && (
										<div className="room-edit-conflict">
											<p>
												편집하는 동안 공유 필터가 바뀌었습니다. 현재 초안은
												유지됩니다.
											</p>
											<Button
												variant="outline"
												size="sm"
												disabled={locked}
												onClick={requestReset}
											>
												최신 조건 불러오기
											</Button>
										</div>
									)}
								{!sameDraftStage && (
									<div className="room-edit-conflict">
										<p>
											게임 단계가 바뀌어 적용을 잠갔습니다. 초안은 보관됩니다.
											최신 목록을 확인한 뒤 다시 편집해 주세요.
										</p>
										<Button
											variant="outline"
											size="sm"
											disabled={locked}
											onClick={requestReset}
										>
											최신 목록으로 다시 편집
										</Button>
									</div>
								)}
								{editError && (
									<p role="alert" className="room-error">
										{editError}
									</p>
								)}
								{room.error && (
									<p role="alert" className="room-error">
										{room.error}
									</p>
								)}
								{editorMode === "filter" ? (
									<RoomGameFilter
										candidates={liveDraftCandidates}
										filter={draftFilter}
										eligibleIds={
											new Set(previewEligible.map((candidate) => candidate.id))
										}
										excludedIds={excludedIds}
										excludeDrawn={excludeDrawn}
										disabled={!editable}
										onChange={setDraftFilter}
									/>
								) : (
									<ul className="room-intake-list room-inline-candidates">
										{draftCandidates.map((candidate, index) => (
											<li className="room-options-candidate" key={candidate.id}>
												<label
													className="room-candidate-field"
													htmlFor={`${id}-${candidate.id}-name`}
												>
													<span>{index + 1}번 후보 이름</span>
													<Input
														id={`${id}-${candidate.id}-name`}
														aria-label={`${index + 1}번 후보 이름`}
														value={candidate.name}
														maxLength={80}
														disabled={!editable}
														onChange={(event) =>
															setDraftCandidates((entries) =>
																entries.map((entry) =>
																	entry.id === candidate.id
																		? { ...entry, name: event.target.value }
																		: entry,
																),
															)
														}
													/>
												</label>
												<label
													className="room-candidate-field"
													htmlFor={`${id}-${candidate.id}-category`}
												>
													<span>분류 (선택)</span>
													<Input
														id={`${id}-${candidate.id}-category`}
														aria-label={`${index + 1}번 후보 분류`}
														list={`${id}-categories`}
														value={
															candidate.category === "미분류"
																? ""
																: candidate.category
														}
														maxLength={24}
														disabled={!editable}
														onChange={(event) =>
															setDraftCandidates((entries) =>
																entries.map((entry) =>
																	entry.id === candidate.id
																		? { ...entry, category: event.target.value }
																		: entry,
																),
															)
														}
													/>
												</label>
												<Button
													variant="ghost"
													size="icon"
													className="room-candidate-delete"
													aria-label={`${candidate.name} 후보 삭제`}
													disabled={!editable}
													onClick={() =>
														setDraftCandidates((entries) =>
															entries.filter(
																(entry) => entry.id !== candidate.id,
															),
														)
													}
												>
													<Trash2 size={16} aria-hidden="true" />
												</Button>
												<small>
													{candidate.ownerName
														? `${candidate.ownerName} 추천`
														: "방장 후보"}
													{excludedIds.includes(candidate.id)
														? " · 당첨 제외 내역 있음"
														: ""}
												</small>
											</li>
										))}
									</ul>
								)}

								{draftCandidates.length === 0 && (
									<p className="room-candidate-empty">
										첫 후보를 추가해 주세요.
									</p>
								)}
							</section>
						)
					) : (
						<>
							{phase !== "editing" && (
								<form
									className="room-recommend-form"
									onSubmit={(event) => {
										event.preventDefault();
										void recommend();
									}}
								>
									<Label htmlFor={`${id}-recommend`}>후보 추천</Label>
									<div className="room-candidate-add">
										<Input
											id={`${id}-recommend`}
											value={recommendation}
											maxLength={80}
											placeholder="추천할 후보 이름"
											disabled={
												phase !== "collecting" ||
												locked ||
												recommendationPending
											}
											onChange={(event) =>
												setRecommendation(event.target.value)
											}
										/>
										<label
											className="room-candidate-field"
											htmlFor={`${id}-recommend-category`}
										>
											<span>분류 (선택)</span>
											<Input
												id={`${id}-recommend-category`}
												aria-label="추천 후보 분류"
												list={`${id}-categories`}
												value={recommendationCategory}
												maxLength={24}
												disabled={
													phase !== "collecting" ||
													locked ||
													recommendationPending
												}
												onChange={(event) =>
													setRecommendationCategory(event.target.value)
												}
											/>
										</label>
										<Button
											type="submit"
											disabled={
												phase !== "collecting" ||
												locked ||
												recommendationPending ||
												!recommendation.trim()
											}
										>
											{recommendationPending ? "추천 보내는 중…" : "추천하기"}
										</Button>
									</div>
									{phase === "reviewing" && (
										<p className="room-panel-note">
											접수가 다시 열릴 때까지 입력한 내용은 보관합니다.
										</p>
									)}
								</form>
							)}
							<div className="room-intake-count">
								전체 {candidates.length}개 · 이번 추첨 {eligible.length}개
							</div>
							<ul className="room-intake-list">
								{candidates.map((candidate) => (
									<li key={candidate.id}>
										<div>
											<strong>{candidate.name}</strong>
											<small>
												{candidate.ownerName
													? `${candidate.ownerName} 추천`
													: "방장 후보"}
												{candidate.included === false
													? " · 직접 제외"
													: excludeDrawn && excludedIds.includes(candidate.id)
														? " · 당첨 제외"
														: ""}
											</small>
										</div>
										{phase === "collecting" &&
											candidate.ownerId === room.self?.id && (
												<Button
													variant="ghost"
													size="sm"
													disabled={locked}
													onClick={() => setRemoveOwn(candidate)}
													aria-label={`${candidate.name} 내 추천 삭제`}
												>
													삭제
												</Button>
											)}
									</li>
								))}
							</ul>
							{candidates.length === 0 && (
								<p className="room-candidate-empty">
									{phase === "collecting"
										? "첫 후보를 추천해 주세요."
										: phase === "editing"
											? "방장이 후보를 준비하고 있어요. 추천 접수가 열리면 추가할 수 있습니다."
											: "현재 후보가 없습니다. 방장이 접수를 다시 열거나 후보를 추가할 때까지 기다려 주세요."}
								</p>
							)}
						</>
					)}
				</div>
			) : (
				<>
					<div className="room-roulette-and-exclusions">
						<div className="room-lifecycle-main">{children(requestStart)}</div>
						<aside className="room-exclusion-panel" aria-label="후보 제외 목록">
							<h3>
								{excludeDrawn ? "제외된 후보" : "저장된 제외 후보"}{" "}
								<span>{excluded.length}</span>
							</h3>
							{!excludeDrawn && <p>중복 제외 꺼짐 · 지금은 추첨에 포함돼요.</p>}
							<ul>
								{excluded.map((candidate) => (
									<li key={candidate.id}>{candidate.name}</li>
								))}
							</ul>
							{excluded.length === 0 && <p>제외 내역이 없습니다.</p>}
							{manualExcluded.length > 0 && (
								<>
									<h4>직접 제외 {manualExcluded.length}개</h4>
									<ul>
										{manualExcluded.map((candidate) => (
											<li key={candidate.id}>{candidate.name}</li>
										))}
									</ul>
								</>
							)}
							{isHost && (
								<Button
									variant="outline"
									size="sm"
									disabled={locked || excludedIds.length === 0}
									onClick={() => {
										setLocalError("");
										setConfirmation({ kind: "reset", revision });
									}}
								>
									<RotateCcw size={14} aria-hidden="true" />
									제외 목록 초기화
								</Button>
							)}
						</aside>
					</div>
					{gameOptions}
					{!showResult && !busy && (
						<>
							<div className="room-current-candidates">
								<h3>이번 추첨 후보 {eligible.length}개</h3>
								<ul>
									{eligible.map((candidate) => (
										<li key={candidate.id}>{candidate.name}</li>
									))}
								</ul>
								{eligible.length === 0 && (
									<p>
										추첨할 후보가 없습니다. 후보 편집에서 필터를 변경하거나,
										당첨 제외 목록을 초기화해 주세요.
									</p>
								)}
							</div>
							{isHost && (
								<div className="room-waiting-actions">
									<Button
										variant="outline"
										disabled={locked}
										onClick={() => void room.enterEditing()}
									>
										후보 편집
									</Button>
									<Button
										variant="outline"
										disabled={locked}
										onClick={() => void room.openIntake()}
									>
										후보 추천받기
									</Button>
								</div>
							)}
						</>
					)}
				</>
			)}
			<CandidateListLoadDialog
				open={loadOpen}
				onOpenChange={setLoadOpen}
				onSelect={selectList}
				disabled={!editable}
				returnFocusRef={loadButtonRef}
			/>
			<CandidateListSaveDialog
				open={saveOpen}
				onOpenChange={setSaveOpen}
				name={sourceName === "직접 작성" ? "내 후보 목록" : sourceName}
				candidates={saveCandidates}
				disabled={!editable}
				returnFocusRef={saveButtonRef}
			/>
			<AlertDialog
				open={Boolean(pendingLoad)}
				onOpenChange={(open) => {
					if (!open) setPendingLoad(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>현재 후보 목록을 바꿀까요?</AlertDialogTitle>
						<AlertDialogDescription>
							작성 중인 후보가 선택한 목록의 사본으로 바뀝니다. 기존 저장본과
							적용된 방 목록은 마감 또는 변경 적용 전까지 유지됩니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>목록 선택으로 돌아가기</AlertDialogCancel>
						<AlertDialogAction
							disabled={!editable}
							onClick={(event) => {
								if (!pendingLoad || !importList(pendingLoad))
									event.preventDefault();
							}}
						>
							목록 바꾸기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog
				open={Boolean(removeOwn)}
				onOpenChange={(open) => {
					if (!open) setRemoveOwn(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>내 추천을 삭제할까요?</AlertDialogTitle>
						<AlertDialogDescription>
							{removeOwn?.name} 후보가 공유 목록에서 삭제됩니다. 기존 당첨 제외
							내역도 함께 삭제됩니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>취소</AlertDialogCancel>
						<AlertDialogAction
							disabled={
								locked ||
								phase !== "collecting" ||
								!candidates.some(
									(candidate) =>
										candidate.id === removeOwn?.id &&
										candidate.ownerId === room.self?.id,
								)
							}
							onClick={() => {
								if (removeOwn && !locked && phase === "collecting") {
									void room.removeCandidate(removeOwn.id);
									setRemoveOwn(null);
								}
							}}
						>
							추천 삭제
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog
				open={Boolean(confirmation)}
				onOpenChange={(open) => {
					if (!open) setConfirmation(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{confirmation?.kind === "start"
								? "제외 목록을 초기화하고 돌릴까요?"
								: "제외 목록을 초기화할까요?"}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmation?.kind === "start"
								? "이전 당첨 제외 내역을 지우고 모든 포함 후보에서 추첨합니다. 이번 당첨 후보만 새 제외 내역에 저장됩니다."
								: "당첨 제외 내역만 비웁니다. 후보 원본, 직접 제외, 지난 기록과 현재 결과는 유지됩니다."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>취소</AlertDialogCancel>
						<AlertDialogAction onClick={() => void confirm()}>
							{confirmation?.kind === "start" ? "초기화하고 돌리기" : "초기화"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			<AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>편집한 내용을 버릴까요?</AlertDialogTitle>
						<AlertDialogDescription>
							아직 적용하지 않은 변경사항이 있습니다.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>계속 편집</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setDiscardOpen(false);
								resetDraft();
							}}
						>
							변경 버리기
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</section>
	);
}
