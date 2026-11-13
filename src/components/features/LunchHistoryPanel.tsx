import { ArrowLeft, Check, Copy } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import CopyFallback from "@/components/features/CopyFallback";
import { type LunchHistoryRecord, lunchHistoryLimit } from "@/lib/lunchHistory";
import { getSourceDisplayName } from "@/services/randomService";
import "./lunch-history-panel.css";

interface LunchHistoryPanelProps {
	records: readonly LunchHistoryRecord[];
	storageFailed: boolean;
	onClose: () => void;
}

type CopyFailure = { recordId: string; text: string; attempt: number };

export default function LunchHistoryPanel({
	records,
	storageFailed,
	onClose,
}: LunchHistoryPanelProps) {
	const id = useId();
	const titleRef = useRef<HTMLHeadingElement>(null);
	const copyButtonsRef = useRef(new Map<string, HTMLButtonElement>());
	const copyAttemptRef = useRef(0);
	const recordsRef = useRef(records);
	const [copiedId, setCopiedId] = useState("");
	const [copyFailure, setCopyFailure] = useState<CopyFailure | null>(null);

	useEffect(() => {
		titleRef.current?.focus({ preventScroll: true });
		return () => {
			copyAttemptRef.current++;
		};
	}, []);

	useEffect(() => {
		if (recordsRef.current === records) return;
		recordsRef.current = records;
		copyAttemptRef.current++;
		setCopiedId("");
		setCopyFailure(null);
	}, [records]);

	async function copyRecord(record: LunchHistoryRecord) {
		const attempt = ++copyAttemptRef.current;
		const text = `음식점: ${record.place.name}\n분류: ${record.place.category}`;
		setCopiedId("");
		setCopyFailure(null);
		try {
			await navigator.clipboard.writeText(text);
			if (attempt !== copyAttemptRef.current) return;
			setCopiedId(record.id);
			copyButtonsRef.current.get(record.id)?.focus();
		} catch {
			if (attempt === copyAttemptRef.current)
				setCopyFailure({ recordId: record.id, text, attempt });
		}
	}

	function closeCopyHelp(recordId: string) {
		copyAttemptRef.current++;
		setCopyFailure(null);
		copyButtonsRef.current.get(recordId)?.focus();
	}

	const copiedRecord = records.find((record) => record.id === copiedId);

	return (
		<section className="lunch-history-panel" aria-labelledby={`${id}-title`}>
			<div className="lunch-history-heading">
				<div>
					<h2 id={`${id}-title`} ref={titleRef} tabIndex={-1}>
						추첨 기록
					</h2>
					<p>
						최근 {lunchHistoryLimit}회 · {records.length}회
					</p>
				</div>
				<button
					type="button"
					className="lunch-history-return"
					onClick={onClose}
				>
					<ArrowLeft size={16} aria-hidden="true" />
					룰렛으로 돌아가기
				</button>
			</div>
			{storageFailed && (
				<output className="lunch-history-storage-error" aria-live="polite">
					이 브라우저에 기록을 저장하지 못했습니다. 현재 화면에서는 기록을
					확인할 수 있습니다.
				</output>
			)}
			<output className="sr-only" aria-live="polite">
				{copiedRecord ? `${copiedRecord.place.name} 기록을 복사했습니다.` : ""}
			</output>
			{records.length === 0 ? (
				<div className="lunch-history-empty">
					<p>아직 추첨 기록이 없습니다.</p>
					<span>룰렛으로 음식점을 추첨하면 최근 결과가 여기에 저장됩니다.</span>
				</div>
			) : (
				<ol
					className="lunch-history-list"
					aria-label="최근 점심 추첨 기록"
					// biome-ignore lint/a11y/noNoninteractiveTabindex: The history list scrolls independently and supports keyboard scrolling.
					tabIndex={0}
				>
					{records.map((record) => (
						<li key={record.id} className="lunch-history-item">
							<div className="lunch-history-item-heading">
								<h3>{record.place.name}</h3>
								<button
									type="button"
									className="lunch-history-copy"
									aria-label={`${record.place.name} 기록 복사`}
									ref={(button) => {
										if (button) copyButtonsRef.current.set(record.id, button);
										else copyButtonsRef.current.delete(record.id);
									}}
									onClick={() => void copyRecord(record)}
								>
									{copiedId === record.id ? (
										<Check size={16} aria-hidden="true" />
									) : (
										<Copy size={16} aria-hidden="true" />
									)}
									{copiedId === record.id ? "복사됨" : "복사"}
								</button>
							</div>
							<p className="lunch-history-category">{record.place.category}</p>
							<p className="lunch-history-source">
								{record.candidateCount}곳 중 추첨 ·{" "}
								{getSourceDisplayName(record.source)}
							</p>
							<time dateTime={new Date(record.timestamp).toISOString()}>
								{new Date(record.timestamp).toLocaleString("ko-KR", {
									year: "numeric",
									month: "2-digit",
									day: "2-digit",
									hour: "2-digit",
									minute: "2-digit",
								})}
							</time>
							{copyFailure?.recordId === record.id && (
								<CopyFallback
									key={copyFailure.attempt}
									text={copyFailure.text}
									onRetry={() => void copyRecord(record)}
									onClose={() => closeCopyHelp(record.id)}
								/>
							)}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
