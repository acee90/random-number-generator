import {
	Ban,
	ChevronDown,
	Layers3,
	Pin,
	RotateCcw,
	Shuffle,
	X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import "./lotto-strategy.css";

export type LottoMode = "random" | "spread" | "fixed";

export interface LottoStrategyControlsProps {
	mode: LottoMode;
	onModeChange: (mode: LottoMode) => void;
	fixedNumbers: number[];
	onFixedNumbersChange: (numbers: number[]) => void;
	excludedNumbers: number[];
	onExcludedNumbersChange: (numbers: number[]) => void;
	spreadRemainder: boolean;
	onSpreadRemainderChange: (value: boolean) => void;
	gameCount: number;
	disabled?: boolean;
}

const choices = [
	{
		value: "random" as const,
		label: "일반 랜덤",
		icon: Shuffle,
		description:
			"선택 조건에 맞는 조합에서 무작위로 뽑습니다. 같은 조합은 반복하지 않습니다.",
	},
	{
		value: "spread" as const,
		label: "번호 분산",
		icon: Layers3,
		description:
			"게임끼리 번호가 겹치지 않도록 서로 다른 번호를 나눠 뽑습니다.",
	},
	{
		value: "fixed" as const,
		label: "번호 고정",
		icon: Pin,
		description:
			"원하는 번호를 모든 게임에 넣고, 나머지 번호만 무작위로 뽑습니다.",
	},
];

const lottoNumbers = Array.from({ length: 45 }, (_, index) => index + 1);
type NumberEntryKind = "fixed" | "excluded";
type NumberEntry = { text: string; error: string; status: string };

export default function LottoStrategyControls({
	mode,
	onModeChange,
	fixedNumbers,
	onFixedNumbersChange,
	excludedNumbers,
	onExcludedNumbersChange,
	spreadRemainder,
	onSpreadRemainderChange,
	gameCount,
	disabled = false,
}: LottoStrategyControlsProps) {
	const id = useId();
	const fixedCount = fixedNumbers.length;
	const excludedCount = excludedNumbers.length;
	const fixedEntryRef = useRef<HTMLTextAreaElement>(null);
	const excludedEntryRef = useRef<HTMLTextAreaElement>(null);
	const [entries, setEntries] = useState<Record<NumberEntryKind, NumberEntry>>({
		fixed: { text: "", error: "", status: "" },
		excluded: { text: "", error: "", status: "" },
	});

	function addNumbers(kind: NumberEntryKind) {
		if (disabled) return;
		const inputRef = kind === "fixed" ? fixedEntryRef : excludedEntryRef;
		const label = kind === "fixed" ? "고정 번호" : "제외 번호";
		const text = entries[kind].text.trim();
		function reject(error: string) {
			setEntries((prev) => ({
				...prev,
				[kind]: { ...prev[kind], error, status: "" },
			}));
			inputRef.current?.focus();
		}
		if (!text) {
			reject("추가할 번호를 입력해 주세요.");
			return;
		}
		const tokens = text.split(/[,\s]+/);
		if (
			tokens.some(
				(token) =>
					!/^\d+$/.test(token) || Number(token) < 1 || Number(token) > 45,
			)
		) {
			reject("1~45 사이의 정수를 쉼표나 공백으로 구분해 입력해 주세요.");
			return;
		}
		const numbers = [...new Set(tokens.map(Number))];
		const unavailable =
			kind === "fixed" ? excludedNumbers : mode === "fixed" ? fixedNumbers : [];
		const conflicts = numbers.filter((number) => unavailable.includes(number));
		if (conflicts.length) {
			reject(
				kind === "fixed"
					? `${conflicts.join(", ")}번은 제외 중입니다. 제외를 해제한 뒤 고정 번호에 추가해 주세요.`
					: `${conflicts.join(", ")}번은 고정 중입니다. 고정을 해제한 뒤 제외 번호에 추가해 주세요.`,
			);
			return;
		}
		const selected = kind === "fixed" ? fixedNumbers : excludedNumbers;
		const merged = [...new Set([...selected, ...numbers])].sort(
			(a, b) => a - b,
		);
		const limit = kind === "fixed" ? 5 : 39;
		if (merged.length > limit) {
			reject(
				`${label}는 최대 ${limit}개까지 선택할 수 있습니다. 일부 번호를 해제한 뒤 추가해 주세요.`,
			);
			return;
		}
		const addedCount = merged.length - selected.length;
		if (addedCount > 0) {
			if (kind === "fixed") onFixedNumbersChange(merged);
			else onExcludedNumbersChange(merged);
		}
		setEntries((prev) => ({
			...prev,
			[kind]: {
				text: "",
				error: "",
				status: `${label} ${addedCount}개를 추가했습니다.`,
			},
		}));
		inputRef.current?.focus();
	}

	function numberEntry(kind: NumberEntryKind) {
		const label = kind === "fixed" ? "고정 번호" : "제외 번호";
		const entry = entries[kind];
		const entryId = `${id}-${kind}-entry`;
		return (
			<div className="lotto-number-entry">
				<label htmlFor={entryId}>{label} 한 번에 추가</label>
				<div className="lotto-entry-controls">
					<textarea
						id={entryId}
						name={`lotto-${kind}-numbers`}
						ref={kind === "fixed" ? fixedEntryRef : excludedEntryRef}
						rows={1}
						inputMode="text"
						autoComplete="off"
						placeholder="3, 7, 21"
						value={entry.text}
						disabled={disabled}
						aria-invalid={Boolean(entry.error)}
						aria-describedby={`${entryId}-help ${entryId}-error`}
						onChange={(event) => {
							if (disabled) return;
							const text = event.target.value;
							setEntries((prev) => ({
								...prev,
								[kind]: { text, error: "", status: "" },
							}));
						}}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							if (!event.nativeEvent.isComposing) addNumbers(kind);
						}}
					/>
					<button
						type="button"
						className={`lotto-fixed-clear lotto-entry-add ${kind === "excluded" ? "lotto-excluded-clear" : ""}`}
						disabled={disabled}
						aria-label={`${label} 추가`}
						onClick={() => addNumbers(kind)}
					>
						추가
					</button>
				</div>
				<p id={`${entryId}-help`} className="lotto-entry-help">
					쉼표나 공백으로 구분하세요. 선택한 번호에 추가됩니다.
				</p>
				<p
					id={`${entryId}-error`}
					className="lotto-entry-error"
					aria-live="polite"
				>
					{entry.error}
				</p>
				<output className="lotto-entry-status" aria-live="polite">
					{entry.status}
				</output>
			</div>
		);
	}

	function toggleNumber(number: number) {
		if (disabled) return;
		if (fixedNumbers.includes(number)) {
			onFixedNumbersChange(fixedNumbers.filter((value) => value !== number));
		} else if (fixedCount < 5 && !excludedNumbers.includes(number)) {
			onFixedNumbersChange([...fixedNumbers, number].sort((a, b) => a - b));
		}
	}

	function toggleExcludedNumber(number: number) {
		if (disabled) return;
		if (excludedNumbers.includes(number)) {
			onExcludedNumbersChange(
				excludedNumbers.filter((value) => value !== number),
			);
		} else if (
			excludedCount < 39 &&
			!(mode === "fixed" && fixedNumbers.includes(number))
		) {
			onExcludedNumbersChange(
				[...excludedNumbers, number].sort((a, b) => a - b),
			);
		}
	}

	return (
		<div className="lotto-strategy-controls">
			<fieldset className="lotto-mode-fieldset" disabled={disabled}>
				<legend>추첨 방식</legend>
				<div className="lotto-mode-options">
					{choices.map((choice) => {
						const Icon = choice.icon;
						return (
							<label
								key={choice.value}
								className={`lotto-mode-card ${mode === choice.value ? "is-selected" : ""}`}
								data-disabled={disabled || undefined}
							>
								<span className="lotto-mode-title">
									<input
										type="radio"
										name={`${id}-lotto-mode`}
										value={choice.value}
										checked={mode === choice.value}
										disabled={disabled}
										onChange={() => onModeChange(choice.value)}
									/>
									<Icon size={18} aria-hidden="true" />
									<strong>{choice.label}</strong>
								</span>
								<span className="lotto-mode-description">
									{choice.description}
								</span>
							</label>
						);
					})}
				</div>
			</fieldset>

			{mode === "spread" && (
				<p className="lotto-strategy-summary">
					<strong>
						{gameCount}게임에 총 {gameCount * 6}개의 서로 다른 번호
					</strong>
					가 필요합니다.
					{gameCount === 1
						? " 게임 수를 늘려도 다른 게임과 번호가 겹치지 않습니다."
						: " 각 게임 안에서도, 게임 사이에서도 같은 번호가 나오지 않습니다."}
				</p>
			)}

			{mode === "fixed" && (
				<fieldset className="lotto-fixed-fieldset" disabled={disabled}>
					<legend>고정 번호 선택</legend>
					<div className="lotto-fixed-heading">
						<p id={`${id}-fixed-help`}>
							모든 게임에 넣을 번호를 1~5개 선택하세요.
						</p>
						<button
							type="button"
							className="lotto-fixed-clear"
							disabled={disabled || fixedCount === 0}
							onClick={() => onFixedNumbersChange([])}
						>
							<RotateCcw size={14} aria-hidden="true" /> 전체 해제
						</button>
					</div>
					<div className="lotto-fixed-selection">
						<output className="lotto-fixed-count" aria-live="polite">
							선택 {fixedCount}/5개
						</output>
						{fixedCount === 0 ? (
							<span className="lotto-fixed-empty">
								아래에서 번호를 선택하세요.
							</span>
						) : (
							<div className="lotto-selected-chips">
								{fixedNumbers.map((number) => (
									<button
										key={number}
										type="button"
										className="lotto-selected-chip"
										disabled={disabled}
										aria-label={`${number} 고정 해제`}
										onClick={() => toggleNumber(number)}
									>
										{number}
										<X size={12} aria-hidden="true" />
									</button>
								))}
							</div>
						)}
					</div>
					{numberEntry("fixed")}
					<div
						className="lotto-number-grid"
						aria-describedby={`${id}-fixed-help`}
					>
						{lottoNumbers.map((number) => {
							const selected = fixedNumbers.includes(number);
							const excluded = excludedNumbers.includes(number);
							return (
								<button
									type="button"
									key={number}
									className={`lotto-number-choice ${selected ? "is-selected" : ""} ${excluded ? "is-unavailable" : ""}`}
									aria-label={`${number} 고정 번호${excluded ? ", 제외 중이므로 선택 불가" : ""}`}
									aria-pressed={selected}
									title={
										excluded
											? "제외 번호를 해제한 뒤 고정할 수 있습니다."
											: undefined
									}
									disabled={
										disabled || excluded || (!selected && fixedCount >= 5)
									}
									onClick={() => toggleNumber(number)}
								>
									{number}
									{excluded && (
										<X
											className="lotto-unavailable-mark"
											size={12}
											aria-hidden="true"
										/>
									)}
								</button>
							);
						})}
					</div>
					{fixedCount === 5 && (
						<p className="lotto-selection-limit">
							최대 5개까지 선택할 수 있습니다. 번호를 해제하면 다른 번호를
							선택할 수 있습니다.
						</p>
					)}
					<label className="lotto-spread-remainder">
						<input
							type="checkbox"
							checked={spreadRemainder}
							disabled={disabled}
							onChange={(event) =>
								onSpreadRemainderChange(event.target.checked)
							}
						/>
						<span>
							<strong>나머지 번호는 게임 간 겹치지 않게</strong>
							<span>
								{spreadRemainder
									? `고정 번호를 제외한 ${6 - fixedCount}개씩을 서로 다른 번호로 채웁니다.`
									: `고정 번호를 제외한 ${6 - fixedCount}개씩을 무작위로 채우며, 게임 간 같은 번호가 나올 수 있습니다.`}
							</span>
						</span>
					</label>
				</fieldset>
			)}
			<details className="lotto-excluded-details">
				<summary>
					<span className="lotto-excluded-title">
						<Ban size={18} aria-hidden="true" /> 제외 번호 선택
					</span>
					<span className="lotto-excluded-summary-count">
						{excludedCount > 0 ? `${excludedCount}개 제외` : "선택 없음"}
					</span>
					<ChevronDown
						className="lotto-excluded-chevron"
						size={18}
						aria-hidden="true"
					/>
				</summary>
				<fieldset className="lotto-excluded-fieldset" disabled={disabled}>
					<legend className="sr-only">추첨에서 제외할 번호</legend>
					<div className="lotto-fixed-heading">
						<p id={`${id}-excluded-help`}>
							선택한 번호는 모든 게임에서 제외합니다. 고정 번호와 함께 선택할 수
							없습니다.
						</p>
						<button
							type="button"
							className="lotto-fixed-clear lotto-excluded-clear"
							disabled={disabled || excludedCount === 0}
							onClick={() => onExcludedNumbersChange([])}
						>
							<RotateCcw size={14} aria-hidden="true" /> 제외 전체 해제
						</button>
					</div>
					<div className="lotto-fixed-selection">
						<output className="lotto-excluded-count" aria-live="polite">
							선택 {excludedCount}/39개 · 사용 가능 {45 - excludedCount}개
						</output>
						{excludedCount > 0 && (
							<div className="lotto-selected-chips">
								{excludedNumbers.map((number) => (
									<button
										key={number}
										type="button"
										className="lotto-selected-chip lotto-excluded-chip"
										disabled={disabled}
										aria-label={`${number} 제외 해제`}
										onClick={() => toggleExcludedNumber(number)}
									>
										{number}
										<X size={12} aria-hidden="true" />
									</button>
								))}
							</div>
						)}
					</div>
					{numberEntry("excluded")}
					<div
						className="lotto-number-grid"
						aria-describedby={`${id}-excluded-help`}
					>
						{lottoNumbers.map((number) => {
							const selected = excludedNumbers.includes(number);
							const fixed = mode === "fixed" && fixedNumbers.includes(number);
							return (
								<button
									key={number}
									type="button"
									className={`lotto-number-choice lotto-excluded-choice ${selected ? "is-excluded" : ""} ${fixed ? "is-unavailable" : ""}`}
									aria-label={`${number} 제외 번호${fixed ? ", 고정 중이므로 선택 불가" : ""}`}
									aria-pressed={selected}
									title={
										fixed
											? "고정 번호를 해제한 뒤 제외할 수 있습니다."
											: undefined
									}
									disabled={
										disabled || fixed || (!selected && excludedCount >= 39)
									}
									onClick={() => toggleExcludedNumber(number)}
								>
									{number}
									{selected && (
										<X
											className="lotto-unavailable-mark"
											size={12}
											aria-hidden="true"
										/>
									)}
									{fixed && (
										<Pin
											className="lotto-unavailable-mark"
											size={12}
											aria-hidden="true"
										/>
									)}
								</button>
							);
						})}
					</div>
					<p className="lotto-selection-limit">
						최소 6개 번호를 남겨야 합니다. 게임 수와 분산 설정에 따라 더 많은
						번호가 필요할 수 있습니다.
					</p>
				</fieldset>
			</details>
			<p className="lotto-strategy-note">
				{excludedCount > 0
					? "고정·제외 조건은 추첨할 번호의 범위를 좁히며, 당첨 번호를 예측하지 않습니다."
					: "선택 방식은 번호 배분을 바꾸며, 같은 게임 수의 1등 당첨 확률을 높이지 않습니다."}
			</p>
		</div>
	);
}
