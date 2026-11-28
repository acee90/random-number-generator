import { useRouter } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
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
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordCandidateListUse } from "@/lib/candidateListUsage";
import { lunchCategories } from "@/lib/lunch";
import {
	type CreateRoomInput,
	clampLunchRoomNickname,
	getEligibleRoomCandidates,
	isLunchRoomId,
	lunchRoomLimits,
	normalizeLunchRoomNickname,
	type RoomCandidate,
	type RoomGameFilter,
	validateCreateRoomInput,
} from "@/lib/lunchRoom";
import {
	prepareLunchRoomEntry,
	readLunchRoomName,
	saveLunchRoomHost,
	saveLunchRoomName,
} from "@/lib/lunchRoomClient";
import { beginRoomTiming } from "@/lib/roomTimings";
import { createSoloRoom } from "@/lib/soloRoom";
import { cn } from "@/lib/utils";
import CandidateListLoadDialog, {
	type CandidateListSelection,
} from "./CandidateListLoadDialog";
import CandidateListSaveDialog from "./CandidateListSaveDialog";
import RoomCandidateEditor from "./RoomCandidateEditor";
import "./create-lunch-room.css";

const emptyFilter: RoomGameFilter = { categories: null, excludedIds: [] };

function newCandidate(name: string): RoomCandidate {
	return {
		id: crypto.randomUUID(),
		name: name.normalize("NFC").trim(),
		category: "미분류",
		included: true,
	};
}

async function requestRoom(body: string, signal: AbortSignal) {
	const finishHttp = beginRoomTiming("create_http");
	let response: Response;
	try {
		response = await fetch("/api/lunch/rooms", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body,
			signal,
		});
	} finally {
		finishHttp();
	}
	const finishDecode = beginRoomTiming("create_decode");
	let decoded: unknown;
	try {
		decoded = await response.json();
	} finally {
		finishDecode();
	}
	const value =
		decoded && typeof decoded === "object"
			? (decoded as Record<string, unknown>)
			: {};
	if (!response.ok) {
		throw new Error(
			typeof value.error === "string"
				? value.error
				: "방을 만들지 못했습니다. 다시 시도해 주세요.",
		);
	}
	if (
		!isLunchRoomId(value.roomId) ||
		typeof value.hostToken !== "string" ||
		!/^[a-f0-9]{64}$/.test(value.hostToken)
	) {
		throw new Error("방 정보를 확인할 수 없습니다. 다시 시도해 주세요.");
	}
	return { roomId: value.roomId, hostToken: value.hostToken };
}

export default function CreateLunchRoom({ solo = false }: { solo?: boolean }) {
	const id = useId();
	const router = useRouter({ warn: false });
	const [step, setStep] = useState<1 | 2>(solo ? 2 : 1);
	const [title, setTitle] = useState(
		solo ? "혼자 점심 추첨" : "오늘 점심 추첨",
	);
	const [name, setName] = useState(solo ? "나" : "방장");
	const [detailsChecked, setDetailsChecked] = useState(false);
	const [candidates, setCandidates] = useState<RoomCandidate[]>([]);
	const [gameFilter, setGameFilter] = useState(emptyFilter);
	const quickAddDraft = useState("");
	const [sourceName, setSourceName] = useState<string>();
	const [editorGeneration, setEditorGeneration] = useState(0);
	const [loadOpen, setLoadOpen] = useState(false);
	const [pendingLoad, setPendingLoad] = useState<CandidateListSelection | null>(
		null,
	);
	const [saveCandidates, setSaveCandidates] = useState<RoomCandidate[] | null>(
		null,
	);
	const [createdRoomId, setCreatedRoomId] = useState<string>();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState("");
	const headingRef = useRef<HTMLHeadingElement>(null);
	const focusedStep = useRef(step);
	const titleRef = useRef<HTMLInputElement>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const loadButtonRef = useRef<HTMLButtonElement | null>(null);
	const saveButtonRef = useRef<HTMLButtonElement | null>(null);
	const requestRef = useRef<AbortController | null>(null);
	const requestTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const hostName = normalizeLunchRoomNickname(name);
	const validTitle = Boolean(
		title.trim() && title.trim().length <= lunchRoomLimits.maxTitleLength,
	);
	const titleError = detailsChecked && !validTitle;
	const nameError = detailsChecked && !hostName;
	const eligibleCount = getEligibleRoomCandidates({
		candidates,
		gameFilter,
	}).length;
	const locked = pending || Boolean(createdRoomId);
	const pendingLabel = solo
		? createdRoomId
			? "추첨 화면으로 이동하는 중…"
			: "추첨 준비 중…"
		: createdRoomId
			? "방에 입장하는 중…"
			: "방 만드는 중…";

	useEffect(() => {
		if (!solo) {
			// The server-rendered form can accept typing before React attaches its handlers.
			if (titleRef.current) setTitle(titleRef.current.value);
			const typedName = nameRef.current?.value;
			setName(
				typedName !== undefined && typedName !== "방장"
					? typedName
					: clampLunchRoomNickname(readLunchRoomName() ?? "") || "방장",
			);
		}
		return () => {
			clearTimeout(requestTimeoutRef.current);
			requestRef.current?.abort();
		};
	}, [solo]);

	useEffect(() => {
		if (step === focusedStep.current) return;
		focusedStep.current = step;
		headingRef.current?.focus();
	}, [step]);

	function next(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setDetailsChecked(true);
		if (!validTitle || !hostName) {
			(validTitle ? nameRef : titleRef).current?.focus();
			return;
		}
		setStep(2);
	}

	function addCandidate(name: string) {
		if (locked) return false;
		const candidate = newCandidate(name);
		setCandidates((current) => [...current, candidate]);
		setError("");
		return true;
	}

	function openList(trigger: HTMLButtonElement | null) {
		loadButtonRef.current = trigger;
		setLoadOpen(true);
	}

	function importList(selection: CandidateListSelection) {
		setCandidates(selection.candidates);
		setGameFilter(emptyFilter);
		setSourceName(selection.name);
		setEditorGeneration((generation) => generation + 1);
		setError("");
		setLoadOpen(false);
		setPendingLoad(null);
		recordCandidateListUse(selection.sourceId);
	}

	async function create() {
		if (requestRef.current || !hostName) return;
		let input: CreateRoomInput | null = null;
		let body = "";
		if (!createdRoomId) {
			const ids = new Set(candidates.map(({ id: candidateId }) => candidateId));
			input = validateCreateRoomInput({
				title,
				hostName,
				candidates,
				gameFilter: {
					...gameFilter,
					excludedIds: gameFilter.excludedIds.filter((candidateId) =>
						ids.has(candidateId),
					),
				},
				startInWaiting: true,
			});
			if (!input) {
				setError(
					"후보 이름과 필터를 확인해 주세요. 추첨에 포함할 후보가 한 개 이상 필요합니다.",
				);
				return;
			}
			body = JSON.stringify(input);
			if (
				new TextEncoder().encode(body).byteLength >
				lunchRoomLimits.maxEditMessageBytes
			) {
				setError(
					"후보 목록이 너무 큽니다. 일부 후보를 줄인 뒤 다시 시도해 주세요.",
				);
				return;
			}
		}
		const controller = new AbortController();
		requestRef.current = controller;
		setPending(true);
		setError("");
		try {
			let roomId = createdRoomId;
			if (input) {
				if (solo) {
					roomId = createSoloRoom(input).roomId;
				} else {
					requestTimeoutRef.current = setTimeout(() => {
						if (requestRef.current !== controller) return;
						controller.abort();
						requestRef.current = null;
						setPending(false);
						setError(
							"방 생성 응답이 늦어지고 있습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
						);
					}, 15000);
					const created = await requestRoom(body, controller.signal);
					if (controller.signal.aborted) return;
					clearTimeout(requestTimeoutRef.current);
					roomId = created.roomId;
					saveLunchRoomHost(roomId, created.hostToken);
				}
				if (!solo) saveLunchRoomName(hostName);
				setCreatedRoomId(roomId);
			}
			if (!roomId) return;
			if (!solo) prepareLunchRoomEntry(roomId, hostName);
			const finishNavigation = beginRoomTiming("room_navigation");
			try {
				await router.navigate({
					to: solo ? "/solo/$roomId" : "/lunch-room/$roomId",
					params: { roomId },
				});
			} catch {
				setError("방을 만들었습니다. 다시 입장해 주세요.");
			} finally {
				finishNavigation();
			}
		} catch (cause) {
			if (!controller.signal.aborted) {
				setError(
					cause instanceof Error && cause.name === "Error"
						? cause.message
						: "연결을 확인한 뒤 다시 시도해 주세요.",
				);
			}
		} finally {
			if (requestRef.current === controller) {
				clearTimeout(requestTimeoutRef.current);
				requestRef.current = null;
				setPending(false);
			}
		}
	}

	return (
		<>
			<Card
				className={cn("min-h-0 border-border", step === 2 && "gap-4")}
				role="region"
				aria-labelledby={`${id}-heading`}
				aria-busy={pending}
			>
				<CardHeader className="flex shrink-0 items-baseline">
					<CardTitle>
						<h1
							id={`${id}-heading`}
							ref={headingRef}
							tabIndex={-1}
							aria-describedby={solo ? undefined : `${id}-step`}
						>
							{solo ? "혼자 추첨 준비" : step === 1 ? "방 만들기" : "후보 준비"}
						</h1>
					</CardTitle>
					{!solo && (
						<p
							id={`${id}-step`}
							className="text-sm text-muted-foreground tabular-nums"
						>
							<span aria-hidden="true">{step} / 2</span>
							<span className="sr-only">전체 2단계 중 {step}단계</span>
						</p>
					)}
				</CardHeader>
				{step === 1 ? (
					<form
						id={`${id}-details`}
						aria-labelledby={`${id}-heading`}
						className="shrink-0"
						noValidate
						onSubmit={next}
						onKeyDown={(event) => {
							if (event.key === "Enter" && event.nativeEvent.isComposing)
								event.preventDefault();
						}}
					>
						<CardContent className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor={`${id}-title`}>방 이름</Label>
								<Input
									id={`${id}-title`}
									ref={titleRef}
									value={title}
									onChange={(event) => setTitle(event.currentTarget.value)}
									required
									maxLength={lunchRoomLimits.maxTitleLength}
									aria-invalid={titleError || undefined}
									aria-describedby={
										titleError ? `${id}-title-error` : undefined
									}
								/>
								{titleError && (
									<p
										id={`${id}-title-error`}
										role="alert"
										className="text-sm text-destructive"
									>
										방 이름은 1~{lunchRoomLimits.maxTitleLength}자로 입력해
										주세요.
									</p>
								)}
							</div>
							<div className="grid gap-2">
								<Label htmlFor={`${id}-name`}>닉네임</Label>
								<Input
									id={`${id}-name`}
									ref={nameRef}
									value={name}
									onChange={(event) => setName(event.currentTarget.value)}
									required
									maxLength={lunchRoomLimits.maxNicknameLength}
									autoComplete="nickname"
									aria-invalid={nameError || undefined}
									aria-describedby={`${id}-name-help`}
								/>
								<p
									id={`${id}-name-help`}
									role={nameError ? "alert" : undefined}
									className={cn(
										"text-sm",
										nameError ? "text-destructive" : "text-muted-foreground",
									)}
								>
									{nameError
										? `닉네임은 1~${lunchRoomLimits.maxNicknameLength}자로 입력해 주세요.`
										: `최대 ${lunchRoomLimits.maxNicknameLength}자`}
								</p>
							</div>
						</CardContent>
					</form>
				) : (
					<CardContent className="flex min-h-[min(9rem,35dvh)] min-w-0 flex-col overflow-y-auto overscroll-y-contain py-1">
						<RoomCandidateEditor
							candidates={candidates}
							filter={gameFilter}
							onCandidatesChange={(next) => {
								setCandidates(next);
								setError("");
							}}
							onFilterChange={(next) => {
								setGameFilter(next);
								setError("");
							}}
							onAdd={addCandidate}
							onAddNearby={(items) => {
								if (locked) return false;
								setCandidates((current) => [...current, ...items]);
								setError("");
								return true;
							}}
							onLoad={openList}
							onSave={(trigger) => {
								saveButtonRef.current = trigger;
								setSaveCandidates(candidates);
							}}
							disabled={locked}
							rowLayout="setup"
							scrollableList
							showSaveStatus={false}
							categorySuggestions={lunchCategories}
							preparedCount={eligibleCount}
							eligibleCount={eligibleCount}
							excludedIds={[]}
							excludeDrawn={false}
							contextKey={String(editorGeneration)}
							sourceName={sourceName}
							quickAddDraft={quickAddDraft}
						/>
					</CardContent>
				)}
				{step === 2 && error && (
					<CardContent className="shrink-0">
						<p role="alert" className="text-sm text-destructive wrap-anywhere">
							{error}
						</p>
					</CardContent>
				)}
				<CardFooter
					key={step}
					role="group"
					aria-label={solo ? "혼자 추첨 시작 동작" : "방 만들기 동작"}
					className="create-room-actions shrink-0 flex-wrap justify-end gap-2"
				>
					{step === 1 ? (
						<Button type="submit" form={`${id}-details`}>
							다음 <ArrowRight size={16} aria-hidden="true" />
						</Button>
					) : (
						<>
							{!solo && (
								<Button
									className="me-auto"
									variant="ghost"
									disabled={locked}
									onClick={() => {
										setError("");
										setStep(1);
									}}
								>
									<ArrowLeft size={16} aria-hidden="true" /> 이전
								</Button>
							)}
							<Button
								disabled={pending || eligibleCount === 0}
								onClick={() => void create()}
							>
								{pending && (
									<LoaderCircle
										size={16}
										className="motion-safe:animate-spin"
										aria-hidden="true"
									/>
								)}
								{pending
									? pendingLabel
									: solo
										? createdRoomId
											? "추첨 화면으로 이동"
											: "추첨 시작"
										: createdRoomId
											? "방에 다시 입장"
											: "방 만들기"}
							</Button>
						</>
					)}
				</CardFooter>
			</Card>
			<output className="sr-only">{pending ? pendingLabel : ""}</output>
			{step === 2 && (
				<>
					<CandidateListLoadDialog
						open={loadOpen}
						onOpenChange={setLoadOpen}
						returnFocusRef={loadButtonRef}
						onSelect={(selection) => {
							if (candidates.length > 0) {
								setPendingLoad(selection);
								return false;
							}
							importList(selection);
						}}
						disabled={locked}
					/>
					<CandidateListSaveDialog
						open={saveCandidates !== null}
						onOpenChange={(open) => {
							if (!open) setSaveCandidates(null);
						}}
						name={sourceName ?? "내 후보 목록"}
						candidates={saveCandidates ?? []}
						disabled={locked}
						returnFocusRef={saveButtonRef}
					/>
					<AlertDialog
						open={pendingLoad !== null}
						onOpenChange={(open) => {
							if (!open) setPendingLoad(null);
						}}
					>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>현재 후보 목록을 바꿀까요?</AlertDialogTitle>
								<AlertDialogDescription>
									편집 중인 후보가 선택한 목록으로 바뀝니다. 저장한 목록은
									유지됩니다.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>목록 선택으로 돌아가기</AlertDialogCancel>
								<AlertDialogAction
									disabled={locked}
									onClick={() => {
										if (pendingLoad) importList(pendingLoad);
									}}
								>
									목록 바꾸기
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</>
			)}
		</>
	);
}
