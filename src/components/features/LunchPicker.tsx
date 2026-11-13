import { Check, Copy, RotateCcw, Shuffle } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import CopyFallback from "@/components/features/CopyFallback";
import CreateLunchRoom from "@/components/features/CreateLunchRoom";
import LunchHistoryPanel from "@/components/features/LunchHistoryPanel";
import { LunchWheel } from "@/components/features/LunchWheel";
import SiteHeader from "@/components/layout/SiteHeader";
import {
	getWheelRotation,
	type LunchCategory,
	type LunchPlace,
	lunchCategories,
	lunchSource,
	resolveLunchWinner,
	sampleLunchPlaces,
} from "@/lib/lunch";
import {
	appendLunchHistory,
	type LunchHistoryRecord,
	readLunchHistory,
	writeLunchHistory,
} from "@/lib/lunchHistory";
import {
	generateRandomNumbers,
	getSourceDisplayName,
} from "@/services/randomService";
import "./lunch-picker.css";

type Phase = "idle" | "fetching" | "spinning" | "done";
type LunchResult = LunchHistoryRecord;
type ActivePanel = "wheel" | "candidates" | "history";
const spinDurationMs = 7200;

export default function LunchPicker({
	places = sampleLunchPlaces,
}: {
	places?: readonly LunchPlace[];
} = {}) {
	const id = useId();
	const [selectedCategories, setSelectedCategories] =
		useState<readonly LunchCategory[]>(lunchCategories);
	const [activePanel, setActivePanel] = useState<ActivePanel>("wheel");
	const [showResult, setShowResult] = useState(false);
	const [history, setHistory] = useState<LunchHistoryRecord[]>([]);
	const [historyStorageFailed, setHistoryStorageFailed] = useState(false);
	const historyRef = useRef<LunchHistoryRecord[]>([]);
	const drawButtonRef = useRef<HTMLButtonElement>(null);
	const focusWheelRef = useRef(false);
	const [excludedIds, setExcludedIds] = useState<string[]>([]);
	const [phase, setPhase] = useState<Phase>("idle");
	const [rotation, setRotation] = useState(0);
	const [result, setResult] = useState<LunchResult | null>(null);
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);
	const [copyFailure, setCopyFailure] = useState(false);
	const attemptRef = useRef(0);
	const busyRef = useRef(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const pendingRef = useRef<LunchResult | null>(null);
	const selectionTitleRef = useRef<HTMLHeadingElement>(null);
	const resultTitleRef = useRef<HTMLHeadingElement>(null);
	const copyButtonRef = useRef<HTMLButtonElement>(null);
	const copyAttemptRef = useRef(0);
	const busy = phase === "fetching" || phase === "spinning";
	const sourceNumbers = new Map(
		places.map((place, index) => [place.id, index + 1]),
	);
	const visible = places.filter((place) =>
		selectedCategories.includes(place.category),
	);
	const allCategoriesSelected = lunchCategories.every((item) =>
		selectedCategories.includes(item),
	);
	const candidates = visible.filter((place) => !excludedIds.includes(place.id));
	const copyValue = result
		? `음식점: ${result.place.name}\n분류: ${result.place.category}`
		: "";

	useEffect(() => {
		const saved = readLunchHistory();
		historyRef.current = saved;
		setHistory(saved);
	}, []);

	useEffect(() => {
		if (activePanel === "candidates") selectionTitleRef.current?.focus();
		else if (activePanel === "wheel" && showResult && result)
			resultTitleRef.current?.focus();
		else if (activePanel === "wheel" && focusWheelRef.current) {
			focusWheelRef.current = false;
			drawButtonRef.current?.focus();
		}
	}, [activePanel, showResult, result]);

	useEffect(
		() => () => {
			attemptRef.current++;
			copyAttemptRef.current++;
			clearTimeout(timerRef.current);
		},
		[],
	);

	function clearFeedback() {
		copyAttemptRef.current++;
		setCopied(false);
		setCopyFailure(false);
		setError("");
		setResult(null);
		setShowResult(false);
		setPhase("idle");
		setRotation(0);
	}
	function finishSpin() {
		const next = pendingRef.current;
		if (!next) return;
		clearTimeout(timerRef.current);
		pendingRef.current = null;
		busyRef.current = false;
		setResult(next);
		setShowResult(true);
		setActivePanel("wheel");
		const records = appendLunchHistory(historyRef.current, next);
		historyRef.current = records;
		setHistory(records);
		setHistoryStorageFailed(!writeLunchHistory(undefined, records));
		setPhase("done");
	}
	async function draw() {
		if (busyRef.current) return;
		setError("");
		if (candidates.length < 2) {
			setError("음식점을 2곳 이상 선택해 주세요.");
			setActivePanel("candidates");
			selectionTitleRef.current?.focus();
			return;
		}
		setActivePanel("wheel");
		const snapshot = [...candidates];
		const attempt = ++attemptRef.current;
		busyRef.current = true;
		copyAttemptRef.current++;
		setCopied(false);
		setCopyFailure(false);
		setResult(null);
		setShowResult(false);
		setPhase("fetching");
		try {
			const response = await generateRandomNumbers({
				data: { min: 0, max: snapshot.length - 1, count: 1, unique: false },
			});
			if (attempt !== attemptRef.current) return;
			if (
				!Array.isArray(response.numbers) ||
				response.numbers.length !== 1 ||
				!["quantum", "atmospheric", "csprng", "mixed"].includes(response.source)
			)
				throw new Error("Invalid lunch draw response");
			const place = resolveLunchWinner(snapshot, response.numbers[0]);
			const timestamp = Date.now();
			pendingRef.current = {
				id: `${id}:${timestamp}:${attempt}`,
				place,
				source: response.source,
				candidateCount: snapshot.length,
				timestamp,
			};
			setRotation((previous) =>
				getWheelRotation(previous, response.numbers[0], snapshot.length),
			);
			if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
				finishSpin();
			} else {
				setPhase("spinning");
				timerRef.current = setTimeout(finishSpin, spinDurationMs + 300);
			}
		} catch {
			if (attempt !== attemptRef.current) return;
			pendingRef.current = null;
			busyRef.current = false;
			setPhase("idle");
			setError("추첨 결과를 가져오지 못했습니다. 다시 시도해 주세요.");
		}
	}
	async function copyResult() {
		const attempt = ++copyAttemptRef.current;
		setCopyFailure(false);
		setCopied(false);
		try {
			await navigator.clipboard.writeText(copyValue);
			if (attempt !== copyAttemptRef.current) return;
			setCopied(true);
			copyButtonRef.current?.focus();
		} catch {
			if (attempt === copyAttemptRef.current) setCopyFailure(true);
		}
	}

	function openPanel(panel: ActivePanel) {
		if (busyRef.current) return;
		copyAttemptRef.current++;
		setCopied(false);
		setCopyFailure(false);
		focusWheelRef.current = panel === "wheel";
		setActivePanel(panel);
	}
	function dismissResult() {
		copyAttemptRef.current++;
		setCopyFailure(false);
		setCopied(false);
		focusWheelRef.current = true;
		setShowResult(false);
	}

	return (
		<div
			className="random-lab lunch-prototype"
			style={
				{ "--lunch-spin-duration": `${spinDurationMs}ms` } as CSSProperties
			}
		>
			<SiteHeader active="lunch" />
			<main id="main-content">
				<section className="page-heading" aria-labelledby={`${id}-title`}>
					<div className="lunch-title-row">
						<h1 id={`${id}-title`}>점심 메뉴 추첨</h1>
						<CreateLunchRoom
							candidateIds={candidates.map((place) => place.id)}
							disabled={busy}
						/>
					</div>
					<p>음식점을 고르고 룰렛을 돌려 점심 메뉴를 정하세요.</p>
					<details className="lunch-source-details">
						<summary>
							회사 주변 음식점 {places.length}곳 · 목록 출처·거리 기준
						</summary>
						<p className="lunch-sample-notice">
							{lunchSource.label} {places.length}곳을 불러왔습니다. 거리는
							제공한 엑셀의 기준이며, 현재 위치에서 측정한 거리가 아닙니다.
						</p>
					</details>
				</section>
				<p
					id={`${id}-error`}
					role="alert"
					className={error ? "inline-error lunch-error" : "lunch-empty-message"}
				>
					{error}
				</p>
				<nav className="lunch-view-switch" aria-label="점심 추첨 화면">
					<button
						type="button"
						aria-pressed={activePanel === "wheel"}
						disabled={busy}
						onClick={() => openPanel("wheel")}
					>
						룰렛·결과
					</button>
					<button
						type="button"
						aria-pressed={activePanel === "candidates"}
						aria-expanded={activePanel === "candidates"}
						aria-controls={`${id}-candidates-panel`}
						disabled={busy}
						onClick={() =>
							openPanel(activePanel === "candidates" ? "wheel" : "candidates")
						}
					>
						후보 {candidates.length}곳
					</button>
					<button
						type="button"
						aria-pressed={activePanel === "history"}
						aria-expanded={activePanel === "history"}
						disabled={busy}
						onClick={() =>
							openPanel(activePanel === "history" ? "wheel" : "history")
						}
					>
						추첨 기록 {history.length}
					</button>
				</nav>
				<div className="lunch-layout">
					<section
						className="lunch-draw-panel"
						hidden={activePanel !== "wheel"}
						aria-labelledby={`${id}-draw`}
					>
						<div className="lunch-panel-heading">
							<h2 id={`${id}-draw`}>점심 룰렛</h2>
							<span>{candidates.length}곳 참여</span>
						</div>
						<div className="lunch-draw-stage">
							<div
								className={`lunch-wheel-area ${showResult ? "is-covered" : ""}`}
								aria-hidden={showResult}
							>
								<LunchWheel
									candidates={candidates}
									candidateNumbers={candidates.map(
										(place) => sourceNumbers.get(place.id) ?? 0,
									)}
									rotation={rotation}
									phase={phase}
									onComplete={finishSpin}
									onDraw={() => void draw()}
									buttonId={`${id}-draw-button`}
									buttonRef={drawButtonRef}
									covered={showResult}
									errorId={error ? `${id}-error` : undefined}
								/>
							</div>
							<div className="lunch-stage-footer">
								<output
									className={result ? "sr-only" : "lunch-status"}
									aria-live="polite"
								>
									{phase === "fetching"
										? "난수 출처에서 추첨 결과를 가져오고 있습니다."
										: phase === "spinning"
											? "룰렛이 멈추면 결과를 공개합니다."
											: result
												? `추첨 결과: ${result.place.name}`
												: ""}
								</output>
								{phase === "spinning" ? (
									<button
										type="button"
										className="lunch-secondary-button"
										onClick={finishSpin}
									>
										결과 바로 보기
									</button>
								) : (
									!busy && (
										<p className="lunch-wheel-help">
											번호와 식당명이 함께 표시됩니다. 전체 이름은 후보에서
											확인하세요.
										</p>
									)
								)}
							</div>
							{showResult && result && (
								<div className="lunch-result-overlay">
									<section
										className="lunch-result"
										aria-labelledby={`${id}-result`}
									>
										<div className="lunch-result-heading">
											<span className="lunch-stage-label">이번 추첨 결과</span>
											<button
												type="button"
												className="result-copy"
												ref={copyButtonRef}
												onClick={() => void copyResult()}
											>
												{copied ? (
													<Check size={17} aria-hidden="true" />
												) : (
													<Copy size={17} aria-hidden="true" />
												)}
												{copied ? "복사됨" : "결과 복사"}
											</button>
										</div>
										<h3 id={`${id}-result`} ref={resultTitleRef} tabIndex={-1}>
											{result.place.name}
										</h3>
										<p>
											{result.place.category}
											{result.place.distanceMeters !== undefined &&
												` · ${lunchSource.distanceLabel} ${result.place.distanceMeters}m`}
										</p>
										<details className="lunch-result-meta">
											<summary className="lunch-result-source">
												{result.candidateCount}곳 중 추첨 ·{" "}
												{getSourceDisplayName(result.source)}
											</summary>
											<time
												className="lunch-result-time"
												dateTime={new Date(result.timestamp).toISOString()}
											>
												{new Date(result.timestamp).toLocaleString("ko-KR", {
													year: "numeric",
													month: "2-digit",
													day: "2-digit",
													hour: "2-digit",
													minute: "2-digit",
												})}{" "}
												생성
											</time>
										</details>

										{copyFailure && (
											<CopyFallback
												text={copyValue}
												onRetry={() => void copyResult()}
												onClose={() => {
													copyAttemptRef.current++;
													setCopyFailure(false);
													copyButtonRef.current?.focus();
												}}
											/>
										)}
										<div className="lunch-result-actions">
											<button
												type="button"
												className="generate-button"
												onClick={() => void draw()}
											>
												<Shuffle size={20} aria-hidden="true" />한 번 더
												추첨하기
											</button>
											<button
												type="button"
												className="lunch-secondary-button"
												onClick={dismissResult}
											>
												룰렛 다시 보기
											</button>
										</div>
									</section>
								</div>
							)}
						</div>
					</section>

					<section
						id={`${id}-candidates-panel`}
						className="lunch-candidate-panel"
						hidden={activePanel !== "candidates"}
						aria-labelledby={`${id}-candidates`}
					>
						<div className="lunch-panel-heading">
							<h2
								id={`${id}-candidates`}
								ref={selectionTitleRef}
								tabIndex={-1}
								aria-describedby={error ? `${id}-error` : undefined}
							>
								추첨 후보
							</h2>
							<span>
								{candidates.length} / {visible.length}곳 선택
							</span>
						</div>
						<fieldset disabled={busy} className="lunch-options">
							<legend className="sr-only">추첨 후보 설정</legend>
							<fieldset className="lunch-categories">
								<legend className="sr-only">음식 분류</legend>
								{(["전체", ...lunchCategories] as const).map((item) => (
									<button
										type="button"
										key={item}
										aria-pressed={
											item === "전체"
												? allCategoriesSelected
												: selectedCategories.includes(item)
										}
										onClick={() => {
											setSelectedCategories((previous) =>
												item === "전체"
													? lunchCategories
													: previous.includes(item)
														? previous.filter((selected) => selected !== item)
														: [...previous, item],
											);
											clearFeedback();
										}}
									>
										{item}
									</button>
								))}
							</fieldset>
							<div className="lunch-selection-actions">
								<button
									type="button"
									className="text-button"
									onClick={() => {
										setExcludedIds((previous) =>
											previous.filter(
												(placeId) =>
													!visible.some((place) => place.id === placeId),
											),
										);
										clearFeedback();
									}}
								>
									<RotateCcw size={14} aria-hidden="true" />
									모두 선택
								</button>
								<button
									type="button"
									className="text-button"
									onClick={() => {
										setExcludedIds((previous) => [
											...new Set([
												...previous,
												...visible.map((place) => place.id),
											]),
										]);
										clearFeedback();
									}}
								>
									선택 해제
								</button>
							</div>
							<p className="lunch-list-cue">
								음식점 목록 · 스크롤해서 후보 확인
							</p>
							<section
								className="lunch-place-list"
								aria-label="음식점 목록"
								// biome-ignore lint/a11y/noNoninteractiveTabindex: The named scroll region needs keyboard scrolling.
								tabIndex={0}
							>
								{visible.map((place) => (
									<label
										className={`lunch-place ${excludedIds.includes(place.id) ? "is-excluded" : ""}`}
										key={place.id}
									>
										<input
											type="checkbox"
											checked={!excludedIds.includes(place.id)}
											aria-label={`${place.name} 추첨 포함`}
											onChange={(event) => {
												setExcludedIds((previous) =>
													event.target.checked
														? previous.filter((placeId) => placeId !== place.id)
														: [...previous, place.id],
												);
												clearFeedback();
											}}
										/>
										<span className="lunch-place-number" aria-hidden="true">
											{sourceNumbers.get(place.id)}
										</span>
										<span className="lunch-place-text">
											<strong>{place.name}</strong>
											<span>{place.category}</span>
										</span>
										{place.distanceMeters !== undefined && (
											<span className="lunch-place-distance">
												{place.distanceMeters}m
											</span>
										)}
									</label>
								))}
							</section>
							{candidates.length === 0 && (
								<p className="lunch-no-candidates">
									선택한 음식점이 없습니다. 2곳 이상 골라 주세요.
								</p>
							)}
						</fieldset>
						<p className="lunch-candidate-help">
							분류를 다시 켜도 개별 제외는 유지됩니다.
						</p>
					</section>
					{activePanel === "history" && (
						<LunchHistoryPanel
							records={history}
							storageFailed={historyStorageFailed}
							onClose={() => openPanel("wheel")}
						/>
					)}
				</div>
			</main>
		</div>
	);
}
