import Cookies from "js-cookie";
import {
	ArrowRight,
	ArrowUpRight,
	Atom,
	Check,
	ChevronDown,
	Copy,
	Dices,
	Hash,
	History,
	Layers3,
	LoaderCircle,
	Plus,
	RotateCcw,
	ShieldCheck,
	Shuffle,
	Ticket,
	Trash2,
	Wind,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import DrawingAnimation from "@/components/features/DrawingAnimation";
import LotteryGuide from "@/components/features/LotteryGuide";
import LottoStrategyControls, {
	type LottoMode,
} from "@/components/features/LottoStrategyControls";
import { Switch } from "@/components/ui/switch";
import { validateLotteryRequest } from "@/services/randomCore";
import {
	generateLotteryNumbers,
	generateRandomNumbers,
	getSourceDisplayName,
	type RandomSource,
} from "@/services/randomService";

type Mode = "number" | "lotto" | "pension";
type Row = { numbers: number[]; group?: number };
type LottoOptions = {
	mode: LottoMode;
	fixedNumbers: number[];
	excludedNumbers?: number[];
	spreadRemainder: boolean;
};
type Draw = {
	id: string;
	kind: Mode;
	rows: Row[];
	source: RandomSource;
	timestamp: number;
	lottoOptions?: LottoOptions;
};
type Settings = {
	min: string;
	max: string;
	count: number;
	allowDuplicates: boolean;
	sortResult: boolean;
};
const defaults: Settings = {
	min: "1",
	max: "10000",
	count: 1,
	allowDuplicates: false,
	sortResult: true,
};
const modes = [
	{
		id: "number" as const,
		label: "랜덤 숫자",
		icon: Hash,
		description: "최소값과 최대값, 뽑을 개수를 설정하세요.",
		title: "범위와 개수 설정",
	},
	{
		id: "lotto" as const,
		label: "로또 6/45",
		icon: Ticket,
		description: "1~45에서 중복 없는 숫자 6개를 뽑습니다.",
		title: "로또 번호 추첨",
	},
	{
		id: "pension" as const,
		label: "연금복권 720+",
		icon: Layers3,
		description: "조와 여섯 자리 번호를 무작위로 뽑습니다.",
		title: "연금복권 번호 추첨",
	},
];
type Example = {
	title: string;
	description: string;
	detail: string;
	settings?: Settings;
	games?: number;
	group?: string;
};
const examples: Record<Mode, Example[]> = {
	number: [
		{
			title: "발표자 1명 선정",
			description: "30명 중 한 명의 번호를 뽑습니다.",
			detail: "1~30 · 1명",
			settings: {
				min: "1",
				max: "30",
				count: 1,
				allowDuplicates: false,
				sortResult: false,
			},
		},
		{
			title: "경품 당첨자 5명 추첨",
			description: "100명 중 서로 다른 5명을 뽑습니다.",
			detail: "1~100 · 5명 · 중복 없음",
			settings: {
				min: "1",
				max: "100",
				count: 5,
				allowDuplicates: false,
				sortResult: true,
			},
		},
		{
			title: "10명의 발표 순서 정하기",
			description: "1~10을 섞어 발표 순서를 정합니다.",
			detail: "1~10 · 10개 · 정렬 안 함",
			settings: {
				min: "1",
				max: "10",
				count: 10,
				allowDuplicates: false,
				sortResult: false,
			},
		},
	],
	lotto: [
		{
			title: "로또 1게임",
			description: "중복 없는 여섯 숫자 조합을 뽑습니다.",
			detail: "1~45 · 6개 번호",
			games: 1,
		},
		{
			title: "로또 3게임",
			description: "서로 다른 세 가지 조합을 뽑습니다.",
			detail: "3게임 · 게임 안에서 중복 없음",
			games: 3,
		},
		{
			title: "로또 5게임",
			description: "다섯 가지 번호 조합을 한 번에 뽑습니다.",
			detail: "5게임 · 결과 한 번에 복사",
			games: 5,
		},
	],
	pension: [
		{
			title: "조와 번호 모두 랜덤",
			description: "1~5조와 여섯 자리 번호를 뽑습니다.",
			detail: "1게임 · 조 자동 선택",
			games: 1,
			group: "random",
		},
		{
			title: "3조에서 5게임",
			description: "3조의 서로 다른 번호 다섯 개를 뽑습니다.",
			detail: "5게임 · 3조 고정",
			games: 5,
			group: "3",
		},
		{
			title: "조까지 랜덤으로 5게임",
			description: "게임마다 조와 번호를 무작위로 정합니다.",
			detail: "5게임 · 조 자동 선택",
			games: 5,
			group: "random",
		},
	],
};
function SourceIcon({ source }: { source: RandomSource }) {
	if (source === "quantum") return <Atom size={15} />;
	if (source === "atmospheric") return <Wind size={15} />;
	if (source === "mixed") return <Layers3 size={15} />;
	return <ShieldCheck size={15} />;
}
function rowText(row: Row, mode: Mode) {
	return mode === "pension"
		? `${row.group}조 ${row.numbers.join("")}`
		: row.numbers.join(", ");
}
function isLottoOptions(value: unknown): value is LottoOptions {
	if (!value || typeof value !== "object") return false;
	const options = value as LottoOptions;
	return (
		["random", "spread", "fixed"].includes(options.mode) &&
		Array.isArray(options.fixedNumbers) &&
		options.fixedNumbers.length <= 5 &&
		new Set(options.fixedNumbers).size === options.fixedNumbers.length &&
		options.fixedNumbers.every(
			(number) => Number.isInteger(number) && number >= 1 && number <= 45,
		) &&
		(options.excludedNumbers === undefined ||
			(Array.isArray(options.excludedNumbers) &&
				options.excludedNumbers.length <= 39 &&
				new Set(options.excludedNumbers).size ===
					options.excludedNumbers.length &&
				options.excludedNumbers.every(
					(number) =>
						Number.isInteger(number) &&
						number >= 1 &&
						number <= 45 &&
						!options.fixedNumbers.includes(number),
				))) &&
		typeof options.spreadRemainder === "boolean"
	);
}
function describeLotto(draw: Draw) {
	const options = draw.lottoOptions;
	const strategy =
		options?.mode === "fixed"
			? `번호 고정: ${options.fixedNumbers.join(", ")} · 나머지 ${options.spreadRemainder ? "번호 분산" : "랜덤"}`
			: options?.mode === "spread"
				? "번호 분산 · 게임 간 겹침 없음"
				: "일반 랜덤";
	return options?.excludedNumbers?.length
		? `${strategy} · 제외: ${options.excludedNumbers.join(", ")}`
		: strategy;
}
function isDraw(value: unknown): value is Draw {
	if (!value || typeof value !== "object") return false;
	const draw = value as Draw;
	return (
		typeof draw.id === "string" &&
		["number", "lotto", "pension"].includes(draw.kind) &&
		Number.isFinite(draw.timestamp) &&
		(draw.lottoOptions === undefined || isLottoOptions(draw.lottoOptions)) &&
		["quantum", "atmospheric", "csprng", "mixed"].includes(draw.source) &&
		Array.isArray(draw.rows) &&
		draw.rows.length > 0 &&
		draw.rows.every(
			(row) =>
				row !== null &&
				typeof row === "object" &&
				Array.isArray(row.numbers) &&
				row.numbers.length > 0 &&
				row.numbers.every(Number.isSafeInteger),
		)
	);
}
export default function RandomGenerator() {
	const id = useId();
	const resultRef = useRef<HTMLDivElement>(null);
	const lottoConstraintRef = useRef<HTMLOutputElement>(null);
	const formRef = useRef<HTMLFormElement>(null);
	const [mode, setMode] = useState<Mode>("number");
	const [settings, setSettings] = useState<Settings>(defaults);
	const [lottoGameCount, setLottoGameCount] = useState(1);
	const [pensionGameCount, setPensionGameCount] = useState(1);
	const [group, setGroup] = useState("random");
	const [lottoMode, setLottoMode] = useState<LottoMode>("random");
	const [fixedNumbers, setFixedNumbers] = useState<number[]>([]);
	const [excludedNumbers, setExcludedNumbers] = useState<number[]>([]);
	const [spreadRemainder, setSpreadRemainder] = useState(true);
	const [draws, setDraws] = useState<Partial<Record<Mode, Draw>>>({});
	const [history, setHistory] = useState<Draw[]>([]);
	const [removed, setRemoved] = useState<Draw[] | null>(null);
	const [ready, setReady] = useState(false);
	const [historyLoaded, setHistoryLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [storageNotice, setStorageNotice] = useState("");
	const [copied, setCopied] = useState("");
	const [appliedExample, setAppliedExample] = useState("");
	const current = modes.find((item) => item.id === mode) ?? modes[0];
	const gameCount = mode === "pension" ? pensionGameCount : lottoGameCount;
	const draw = draws[mode];
	const recent = history.filter(
		(item) => item.kind === mode && item.id !== draw?.id,
	);
	const lottoRequest = {
		kind: "lotto" as const,
		count: gameCount,
		strategy:
			lottoMode === "spread" || (lottoMode === "fixed" && spreadRemainder)
				? ("spread" as const)
				: ("random" as const),
		fixedNumbers: lottoMode === "fixed" ? fixedNumbers : [],
		excludedNumbers,
	};
	let lottoConstraintError = "";
	if (mode === "lotto") {
		try {
			validateLotteryRequest(lottoRequest);
		} catch (cause) {
			lottoConstraintError =
				cause instanceof Error
					? cause.message
					: "로또 추첨 조건을 확인해 주세요.";
		}
	}
	useEffect(() => {
		try {
			const saved =
				localStorage.getItem("randomlab.settings") ??
				Cookies.get("rng_settings");
			if (saved) {
				const value = JSON.parse(saved);
				if (!value || typeof value !== "object" || Array.isArray(value)) {
					throw new Error("Invalid saved settings");
				}
				setSettings({
					min: String(value.min ?? defaults.min),
					max: String(value.max ?? defaults.max),
					count:
						Number.isInteger(value.count) &&
						value.count >= 1 &&
						value.count <= 100
							? value.count
							: 1,
					allowDuplicates: value.allowDuplicates === true,
					sortResult: value.sortResult !== false,
				});
			}
		} catch {
			setStorageNotice("저장된 설정을 읽지 못해 기본값으로 시작합니다.");
		}
		try {
			const storedHistory = localStorage.getItem("randomlab.history");
			if (storedHistory) {
				const parsed = JSON.parse(storedHistory);
				if (!Array.isArray(parsed)) throw new Error("Invalid saved history");
				setHistory(parsed.filter(isDraw).slice(0, 50));
			} else {
				const legacy = JSON.parse(Cookies.get("rng_history") ?? "[]");
				if (!Array.isArray(legacy)) throw new Error("Invalid legacy history");
				setHistory(
					legacy
						.filter(
							(item) =>
								item !== null &&
								typeof item === "object" &&
								Array.isArray(item.numbers) &&
								item.numbers.every(Number.isSafeInteger),
						)
						.map((item) => ({
							...item,
							kind: "number",
							rows: [{ numbers: item.numbers }],
							source: item.source ?? "csprng",
						}))
						.filter(isDraw)
						.slice(0, 50),
				);
			}
			setHistoryLoaded(true);
		} catch {
			setStorageNotice(
				"저장된 기록을 읽지 못해 그대로 보존했습니다. 새 결과는 복사해 간직해 주세요.",
			);
		}
		setReady(true);
	}, []);
	useEffect(() => {
		if (!ready) return;
		try {
			localStorage.setItem("randomlab.settings", JSON.stringify(settings));
			Cookies.remove("rng_settings");
			if (historyLoaded) {
				localStorage.setItem("randomlab.history", JSON.stringify(history));
				Cookies.remove("rng_history");
			}
		} catch {
			setStorageNotice(
				"이 브라우저에 기록을 저장할 수 없습니다. 필요한 결과는 복사해 주세요.",
			);
		}
	}, [settings, history, ready, historyLoaded]);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(""), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	async function copyText(text: string, copyId: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(copyId);
		} catch {
			setError("복사하지 못했습니다. 화면의 숫자를 선택해 직접 복사해 주세요.");
		}
	}
	async function copy(value: Draw) {
		await copyText(
			value.rows.map((row) => rowText(row, value.kind)).join("\n"),
			value.id,
		);
	}
	function copyTicket(value: Draw, row: Row, index: number) {
		return copyText(
			value.kind === "pension" ? row.numbers.join("") : row.numbers.join(", "),
			`${value.id}-row-${index}`,
		);
	}

	async function generate() {
		setError("");
		if (mode === "lotto" && lottoConstraintError) {
			lottoConstraintRef.current?.focus();
			return;
		}
		if (
			mode === "lotto" &&
			lottoMode === "fixed" &&
			fixedNumbers.length === 0
		) {
			setError("고정할 번호를 1개 이상 선택해 주세요.");
			return;
		}
		if (mode === "number") {
			const min = Number(settings.min);
			const max = Number(settings.max);
			if (
				!settings.min.trim() ||
				!settings.max.trim() ||
				!Number.isSafeInteger(min) ||
				!Number.isSafeInteger(max) ||
				!Number.isSafeInteger(max - min + 1) ||
				min > max
			) {
				setError(
					"최소값과 최대값에 정수를 입력해 주세요. 최대값은 최소값 이상이어야 합니다.",
				);
				return;
			}
			if (
				!Number.isInteger(settings.count) ||
				settings.count < 1 ||
				settings.count > 100
			) {
				setError("생성 개수는 1개부터 100개까지 선택해 주세요.");
				return;
			}
			if (!settings.allowDuplicates && settings.count > max - min + 1) {
				setError(
					"중복 없이 뽑을 숫자가 부족합니다. 범위를 넓히거나 개수를 줄여 주세요.",
				);
				return;
			}
		}
		setBusy(true);
		resultRef.current?.scrollIntoView({
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
			block: "start",
		});
		try {
			let rows: Row[];
			let source: RandomSource;
			if (mode === "number") {
				const result = await generateRandomNumbers({
					data: {
						min: Number(settings.min),
						max: Number(settings.max),
						count: settings.count,
						unique: !settings.allowDuplicates,
					},
				});
				rows = [
					{
						numbers: settings.sortResult
							? [...result.numbers].sort((a, b) => a - b)
							: result.numbers,
					},
				];
				source = result.source;
			} else {
				const result = await generateLotteryNumbers({
					data:
						mode === "lotto"
							? lottoRequest
							: {
									kind: "pension",
									count: gameCount,
									...(group !== "random"
										? {
												group:
													group === "all" ? ("all" as const) : Number(group),
											}
										: {}),
								},
				});
				rows = result.tickets;
				source = result.source;
			}
			const next: Draw = {
				id: crypto.randomUUID(),
				kind: mode,
				rows,
				source,
				timestamp: Date.now(),
				...(mode === "lotto"
					? {
							lottoOptions: {
								mode: lottoMode,
								fixedNumbers: lottoMode === "fixed" ? [...fixedNumbers] : [],
								excludedNumbers: [...excludedNumbers],
								spreadRemainder,
							},
						}
					: {}),
			};
			setDraws((prev) => ({ ...prev, [mode]: next }));
			setHistory((prev) => [next, ...prev].slice(0, 50));
			setRemoved(null);
		} catch {
			setError("숫자를 가져오지 못했습니다. 잠시 후 다시 생성해 주세요.");
			formRef.current?.scrollIntoView({ block: "nearest" });
		} finally {
			setBusy(false);
		}
	}
	function changeMode(next: Mode) {
		if (busy) return;
		setMode(next);
		setError("");
		setAppliedExample("");
	}
	function updateSettings(next: Settings) {
		setSettings(next);
		setAppliedExample("");
	}
	function updateGameCount(value: number) {
		if (mode === "pension") setPensionGameCount(value);
		else setLottoGameCount(value);
	}
	function applyExample(example: Example) {
		if (busy) return;
		if (example.settings) setSettings(example.settings);
		if (example.games) updateGameCount(example.games);
		if (example.group) setGroup(example.group);
		setError("");
		setAppliedExample(example.title);
		formRef.current?.scrollIntoView({
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
			block: "start",
		});
	}
	return (
		<div className="random-lab">
			<header className="masthead">
				<div className="top-bar">
					<a className="wordmark" href="/" aria-label="랜덤랩 홈">
						<span className="brand-icon">
							<Shuffle size={22} strokeWidth={2.5} />
						</span>
						<span>
							random<span className="wordmark-light">lab</span>
							<span className="brand-period">.</span>
						</span>
					</a>
				</div>{" "}
				<nav className="tool-nav" aria-label="생성 도구">
					{modes.map((item, index) => {
						const Icon = item.icon;
						return (
							<button
								type="button"
								key={item.id}
								className={`tool-tab ${mode === item.id ? "is-active" : ""}`}
								aria-pressed={mode === item.id}
								disabled={busy}
								onClick={() => changeMode(item.id)}
							>
								<span className="tab-number">0{index + 1}</span>
								<Icon size={18} />
								<span>{item.label}</span>
								{mode === item.id && <span className="active-dot" />}
							</button>
						);
					})}
				</nav>
			</header>
			<main id="main-content">
				<section className="page-heading" aria-labelledby={`${id}-title`}>
					<h1 id={`${id}-title`}>랜덤 번호 생성기</h1>
					<div className="entropy-intro">
						<p className="entropy-lead">
							<Atom size={20} aria-hidden="true" />
							<strong>
								양자 현상과 대기 잡음에서 얻은 실제 난수를 우선 사용합니다.
							</strong>
						</p>
						<p className="entropy-description">
							ANU의 양자 난수, Random.org의 대기 잡음 난수 순으로 요청해 번호를
							생성합니다.
						</p>
						<p className="entropy-fallback">
							두 외부 원천을 사용할 수 없으면 암호학적 난수로 대체하며, 실제
							사용한 출처는 결과에 표시합니다.
						</p>
					</div>
				</section>

				<section className="generator" aria-label={current.label}>
					<form
						className={`controls controls-${mode}`}
						ref={formRef}
						onSubmit={(event) => {
							event.preventDefault();
							void generate();
						}}
						noValidate
					>
						<div className="section-label">
							<span>조건 설정</span>
							<span>01</span>
						</div>
						<h2>{current.title}</h2>
						<p className="control-description">{current.description}</p>
						{appliedExample && (
							<output className="preset-notice">
								“{appliedExample}” 설정을 적용했습니다. 생성 버튼을 누르세요.
							</output>
						)}
						<fieldset disabled={busy} className="settings-fields">
							{mode === "number" ? (
								<>
									<div className="range-fields">
										<label htmlFor={`${id}-min`}>
											최소값
											<input
												id={`${id}-min`}
												type="number"
												step="1"
												value={settings.min}
												onChange={(event) =>
													updateSettings({
														...settings,
														min: event.target.value,
													})
												}
											/>
										</label>
										<span className="range-dash">—</span>
										<label htmlFor={`${id}-max`}>
											최대값
											<input
												id={`${id}-max`}
												type="number"
												step="1"
												value={settings.max}
												onChange={(event) =>
													updateSettings({
														...settings,
														max: event.target.value,
													})
												}
											/>
										</label>
									</div>
									<div className="count-controls">
										<div className="count-heading">
											<label htmlFor={`${id}-count`}>생성 개수</label>
											<div className="count-input">
												<input
													id={`${id}-count`}
													type="number"
													min="1"
													max="100"
													value={settings.count}
													onChange={(event) =>
														updateSettings({
															...settings,
															count: Number(event.target.value),
														})
													}
												/>
												<span>개</span>
											</div>
										</div>
										<input
											className="count-range"
											aria-label="생성 개수 조절"
											type="range"
											min="1"
											max="100"
											value={settings.count}
											style={
												{
													"--range-progress": `${Math.min(100, Math.max(0, ((settings.count - 1) / 99) * 100))}%`,
												} as React.CSSProperties
											}
											onChange={(event) =>
												updateSettings({
													...settings,
													count: Number(event.target.value),
												})
											}
										/>
										<div className="range-limits">
											<span>1</span>
											<span>100</span>
										</div>
									</div>
									<div className="toggle-options">
										<div>
											<label htmlFor={`${id}-duplicates`}>
												중복 허용<span>결과에 같은 숫자를 허용합니다</span>
											</label>
											<Switch
												id={`${id}-duplicates`}
												checked={settings.allowDuplicates}
												onCheckedChange={(checked) =>
													updateSettings({
														...settings,
														allowDuplicates: checked,
													})
												}
												className="lab-switch"
											/>
										</div>
										<div>
											<label htmlFor={`${id}-sort`}>
												작은 숫자부터 정렬
												<span>결과를 오름차순으로 정렬합니다</span>
											</label>
											<Switch
												id={`${id}-sort`}
												checked={settings.sortResult}
												onCheckedChange={(checked) =>
													updateSettings({ ...settings, sortResult: checked })
												}
												className="lab-switch"
											/>
										</div>
									</div>
								</>
							) : (
								<>
									<div className="lottery-options">
										<div className="game-selector">
											<div className="game-count-label" id={`${id}-games`}>
												추첨할 게임 수
											</div>
											<fieldset
												className="game-options"
												disabled={mode === "pension" && group === "all"}
												aria-labelledby={`${id}-games`}
											>
												{[1, 2, 3, 4, 5].map((value) => (
													<button
														type="button"
														key={value}
														aria-pressed={gameCount === value}
														className={gameCount === value ? "selected" : ""}
														onClick={() => {
															updateGameCount(value);
															setError("");
															setAppliedExample("");
														}}
													>
														{value}
														<span>게임</span>
													</button>
												))}
											</fieldset>
											{mode === "pension" && group === "all" && (
												<p className="all-groups-note">
													1~5조에 같은 여섯 자리 번호를 배정합니다. 5게임으로
													고정됩니다.
												</p>
											)}
										</div>
										{mode === "pension" && (
											<label
												className="group-select-label"
												htmlFor={`${id}-group`}
											>
												조 선택
												<div className="select-wrap">
													<select
														id={`${id}-group`}
														value={group}
														onChange={(event) => {
															setGroup(event.target.value);
															if (event.target.value === "all")
																setPensionGameCount(5);
															setAppliedExample("");
														}}
													>
														<option value="random">조도 무작위로 선택</option>
														<option value="all">
															모든 조 · 같은 번호 (5게임)
														</option>
														{[1, 2, 3, 4, 5].map((value) => (
															<option key={value} value={value}>
																{value}조
															</option>
														))}
													</select>
													<ChevronDown size={16} />
												</div>
											</label>
										)}
									</div>
									{mode === "lotto" && (
										<LottoStrategyControls
											mode={lottoMode}
											onModeChange={(next) => {
												setLottoMode(next);
												setError("");
											}}
											fixedNumbers={fixedNumbers}
											onFixedNumbersChange={(numbers) => {
												setFixedNumbers(numbers);
												setError("");
											}}
											excludedNumbers={excludedNumbers}
											onExcludedNumbersChange={(numbers) => {
												setExcludedNumbers(numbers);
												setFixedNumbers((prev) =>
													prev.filter((number) => !numbers.includes(number)),
												);
												setError("");
											}}
											spreadRemainder={spreadRemainder}
											onSpreadRemainderChange={(value) => {
												setSpreadRemainder(value);
												setError("");
											}}
											gameCount={gameCount}
											disabled={busy}
										/>
									)}
								</>
							)}
						</fieldset>
						<output
							ref={lottoConstraintRef}
							tabIndex={-1}
							id={`${id}-lotto-constraints`}
							className={
								mode === "lotto" && lottoConstraintError
									? "inline-error"
									: undefined
							}
						>
							{mode === "lotto" ? lottoConstraintError : ""}
						</output>
						{error && (
							<p className="inline-error" role="alert">
								{error}
							</p>
						)}
						<button
							className="generate-button"
							type="submit"
							disabled={busy || !ready}
							aria-describedby={
								mode === "lotto" && lottoConstraintError
									? `${id}-lotto-constraints`
									: undefined
							}
						>
							<span>
								{busy ? (
									<LoaderCircle size={19} className="spin" />
								) : (
									<Shuffle size={19} />
								)}
								{busy
									? "추첨 중…"
									: mode === "number"
										? "숫자 생성하기"
										: "번호 뽑기"}
							</span>
							{!busy && <ArrowRight size={19} />}
						</button>
						<p className="button-caption">
							{mode === "number"
								? "설정한 범위에서 숫자를 생성합니다"
								: "각 게임의 번호를 개별 복사할 수 있습니다"}
						</p>
					</form>
					<div
						className={`result-panel ${draw ? "has-result" : ""}`}
						ref={resultRef}
						aria-busy={busy}
					>
						<div className="result-toolbar">
							<span>
								<span className="result-indicator" /> 이번 추첨 결과
							</span>
							<span>
								{busy
									? "추첨 중"
									: draw
										? `${mode === "number" ? draw.rows[0].numbers.length : draw.rows.length}${mode === "number" ? "개" : "게임"}`
										: "생성 전"}
							</span>
						</div>
						<div className="result-stage" aria-live="polite" aria-atomic="true">
							{busy ? (
								<DrawingAnimation
									kind={mode}
									count={mode === "number" ? settings.count : gameCount}
								/>
							) : draw ? (
								<div key={draw.id} className={`generated-results ${mode}`}>
									{mode === "lotto" && (
										<div className="lotto-result-summary">
											<span>{describeLotto(draw)}</span>
											<span>
												{draw.rows.length}게임 · 사용 번호{" "}
												{new Set(draw.rows.flatMap((row) => row.numbers)).size}
												개
											</span>
										</div>
									)}
									{mode === "number" ? (
										<div
											className={`number-result ${draw.rows[0].numbers.length === 1 ? "single-number" : "multiple-numbers"}`}
										>
											{draw.rows[0].numbers.map((number, index) => (
												<button
													type="button"
													key={`${draw.id}-${index}-${number}`}
													className={`number-item ${copied === `${draw.id}-number-${index}` ? "is-copied" : ""}`}
													aria-label={`${index + 1}번째 숫자 ${number} 복사`}
													title="이 숫자 복사"
													onClick={() =>
														void copyText(
															String(number),
															`${draw.id}-number-${index}`,
														)
													}
												>
													<span className="number-value">
														{number.toLocaleString("en-US")}
													</span>
													<span
														className="number-copy-feedback"
														aria-hidden="true"
													>
														<Check size={12} />
														복사됨
													</span>
												</button>
											))}
										</div>
									) : (
										draw.rows.map((row, index) => (
											<div className="ticket-row" key={`${draw.id}-${index}`}>
												<div className="ticket-numbers">
													<span className="ticket-index">
														{String.fromCharCode(65 + index)}
													</span>
													{mode === "pension" && (
														<span className="pension-group">
															{row.group}
															<small>조</small>
														</span>
													)}
													<div
														className={
															mode === "lotto"
																? "lotto-balls"
																: "pension-digits"
														}
													>
														{row.numbers.map((number, digit) => (
															<span
																key={`${draw.id}-${index}-${digit}`}
																className={
																	mode === "lotto"
																		? `lotto-ball ball-color-${Math.ceil(number / 10)} ${draw.lottoOptions?.fixedNumbers.includes(number) ? "fixed-ball" : ""}`
																		: "digit"
																}
															>
																{number}
																{mode === "lotto" &&
																	draw.lottoOptions?.fixedNumbers.includes(
																		number,
																	) && (
																		<span className="fixed-number-marker">
																			고정
																		</span>
																	)}
															</span>
														))}
													</div>
												</div>
												<button
													type="button"
													className="ticket-copy"
													onClick={() => void copyTicket(draw, row, index)}
													aria-label={`${String.fromCharCode(65 + index)}게임 ${mode === "pension" ? "여섯 자리 " : ""}번호 복사`}
												>
													{copied === `${draw.id}-row-${index}` ? (
														<Check size={17} />
													) : (
														<Copy size={17} />
													)}
													<span>
														{copied === `${draw.id}-row-${index}`
															? "복사됨"
															: "번호 복사"}
													</span>
												</button>
											</div>
										))
									)}
									{mode === "number" && (
										<p className="number-copy-hint">
											숫자를 누르면 해당 숫자 하나만 복사됩니다.
										</p>
									)}
									<div className="result-actions">
										<button
											type="button"
											className="result-copy"
											onClick={() => void copy(draw)}
										>
											{copied === draw.id ? (
												<Check size={16} />
											) : (
												<Copy size={16} />
											)}
											{copied === draw.id
												? "복사됨"
												: mode === "number"
													? "전체 결과 복사"
													: "전체 번호 복사"}
										</button>
										<span>
											{new Date(draw.timestamp).toLocaleTimeString("ko-KR", {
												hour: "2-digit",
												minute: "2-digit",
											})}{" "}
											생성
										</span>
									</div>
								</div>
							) : (
								<div className="empty-result">
									<div className="empty-symbol">
										<Dices size={36} strokeWidth={1.3} />
										<span className="empty-plus">+</span>
										<span className="empty-dot" />
									</div>
									<h3>생성한 숫자가 여기에 표시됩니다.</h3>
									<p>
										{mode === "number"
											? "범위와 개수를 설정한 뒤 숫자 생성하기를 누르세요."
											: "게임 수를 선택한 뒤 번호 뽑기를 누르세요."}
									</p>
								</div>
							)}
						</div>
						<div className="result-bottom">
							<div>
								{busy ? (
									<>
										<LoaderCircle size={15} className="spin" />
										<span>새 난수를 요청하고 있습니다</span>
									</>
								) : draw ? (
									<>
										<SourceIcon source={draw.source} />
										<span>{getSourceDisplayName(draw.source)}</span>
									</>
								) : (
									<>
										<ShieldCheck size={15} />
										<span>결과와 함께 난수 출처를 표시합니다</span>
									</>
								)}
							</div>
							<span className="tiny-asterisk">✳</span>
						</div>
					</div>
				</section>
				<div className="below-generator">
					<span>
						<ShieldCheck size={14} />{" "}
						{mode === "number"
							? "추첨 기록은 이 브라우저에 저장됩니다."
							: "번호 선택을 돕는 도구이며, 당첨을 예측하지 않습니다."}
					</span>
				</div>
				{mode !== "number" && (
					<p className="ticket-copy-hint">
						{mode === "pension"
							? "번호 복사는 조를 제외한 여섯 자리 숫자만 복사합니다. 조는 별도로 선택하세요."
							: "번호 복사는 해당 게임의 여섯 숫자를 복사합니다."}
					</p>
				)}
				{mode === "number" ? (
					<section className="use-cases" aria-labelledby={`${id}-examples`}>
						<div className="use-cases-heading">
							<h2 id={`${id}-examples`}>활용 예시</h2>
							<p>예시를 선택하면 해당 조건이 설정됩니다.</p>
						</div>
						<div className="example-grid">
							{examples[mode].map((example) => (
								<button
									type="button"
									className={`example-card ${appliedExample === example.title ? "is-applied" : ""}`}
									key={example.title}
									disabled={busy}
									onClick={() => applyExample(example)}
								>
									<strong>{example.title}</strong>
									<span>{example.description}</span>
									<small>{example.detail}</small>
									<span className="example-action">
										{appliedExample === example.title
											? "설정 적용됨"
											: "이 설정 사용"}
										<ArrowUpRight size={16} />
									</span>
								</button>
							))}
						</div>
					</section>
				) : (
					<LotteryGuide kind={mode} />
				)}
				<section className="history-section" aria-labelledby={`${id}-history`}>
					<div className="history-heading">
						<div>
							<History size={19} />
							<h2 id={`${id}-history`}>이전 추첨 기록</h2>
							<span className="history-count">{recent.length}</span>
						</div>
						{removed ? (
							<button
								type="button"
								className="text-button"
								onClick={() => {
									setHistory(removed);
									setRemoved(null);
								}}
							>
								<RotateCcw size={14} />
								삭제 취소
							</button>
						) : (
							<button
								type="button"
								className="text-button clear-history"
								disabled={!recent.length}
								onClick={() => {
									setRemoved(history);
									setHistory((prev) =>
										prev.filter(
											(item) => item.kind !== mode || item.id === draw?.id,
										),
									);
								}}
							>
								<Trash2 size={14} />
								기록 지우기
							</button>
						)}
					</div>
					{storageNotice && (
						<output className="storage-notice">{storageNotice}</output>
					)}
					{recent.length ? (
						<div className="history-list">
							{recent.map((item) => (
								<article className="history-item" key={item.id}>
									<div className="history-meta">
										<span>
											{new Date(item.timestamp).toLocaleString("ko-KR", {
												month: "2-digit",
												day: "2-digit",
												hour: "2-digit",
												minute: "2-digit",
											})}
										</span>
										<span className="history-source">
											<SourceIcon source={item.source} />
											{getSourceDisplayName(item.source)}
										</span>
									</div>
									{item.kind === "lotto" && (
										<p className="history-lotto-strategy">
											{describeLotto(item)}
										</p>
									)}
									<div className="history-numbers">
										{item.rows.map((row, index) => (
											<div className="history-row" key={`${item.id}-${index}`}>
												<span>
													{item.kind !== "number" && (
														<small>{String.fromCharCode(65 + index)}</small>
													)}
													{rowText(row, item.kind)}
												</span>
												{item.kind !== "number" && (
													<button
														type="button"
														className="history-row-copy"
														aria-label={`이전 ${String.fromCharCode(65 + index)}게임 ${item.kind === "pension" ? "여섯 자리 " : ""}번호 복사`}
														onClick={() => void copyTicket(item, row, index)}
													>
														{copied === `${item.id}-row-${index}` ? (
															<Check size={16} />
														) : (
															<Copy size={16} />
														)}
														<span>
															{copied === `${item.id}-row-${index}`
																? "복사됨"
																: "번호 복사"}
														</span>
													</button>
												)}
											</div>
										))}
									</div>
									<button
										className="icon-button"
										type="button"
										aria-label={`${new Date(item.timestamp).toLocaleTimeString("ko-KR")} 생성 결과 전체 복사`}
										onClick={() => void copy(item)}
									>
										{copied === item.id ? (
											<Check size={17} />
										) : (
											<Copy size={17} />
										)}
									</button>
								</article>
							))}
						</div>
					) : (
						<div className="empty-history">
							<span className="history-dash">—</span>
							<p>
								{removed
									? "기록을 지웠습니다. 삭제 취소로 되돌릴 수 있어요."
									: "이전 추첨 기록이 없습니다."}
								<span>
									{removed
										? "새 결과를 생성하기 전까지 복원할 수 있습니다."
										: "다시 추첨하면 앞서 생성한 결과가 여기에 표시됩니다. 최대 50회 저장됩니다."}
								</span>
							</p>
							<Plus size={18} />
						</div>
					)}
				</section>
			</main>
			<footer className="lab-footer">
				<span className="footer-brand">randomlab.</span>
				<span>랜덤 숫자 · 로또 6/45 · 연금복권 720+</span>
			</footer>
			<output className="sr-only">
				{copied ? "결과를 클립보드에 복사했습니다." : ""}
			</output>
		</div>
	);
}
