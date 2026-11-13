import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, X } from "lucide-react";
import {
	type CSSProperties,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import CopyFallback from "@/components/features/CopyFallback";
import RoomDrawFeedback from "@/components/features/RoomDrawFeedback";
import type { RoomDraw } from "@/lib/lunchRoom";
import { getSourceDisplayName } from "@/services/randomService";

function probabilityLabel(draw: RoomDraw, index: number) {
	const probability = draw.probabilities?.[index] ?? 1 / draw.candidates.length;
	return `1/${draw.candidates.length} · 약 ${new Intl.NumberFormat("ko-KR", { style: "percent", maximumFractionDigits: 2 }).format(probability)}`;
}

export function roomDrawCopyText(draw: RoomDraw) {
	const winner = draw.candidates[draw.winnerIndex];
	return [
		`음식점: ${winner.name}`,
		`분류: ${winner.category}`,
		`추첨 ID: ${draw.id}`,
		`후보 목록 버전: ${draw.listVersion}`,
		`추첨 요청: ${draw.requestedAt === undefined ? "이전 기록에는 요청 시각이 없습니다" : new Date(draw.requestedAt).toISOString()}`,
		`난수 결과 생성: ${new Date(draw.timestamp).toISOString()}`,
		`룰렛 시작: ${new Date(draw.startedAt).toISOString()}`,
		`공개 예정 시각: ${new Date(draw.startedAt + draw.durationMs).toISOString()}`,
		`난수 출처: ${getSourceDisplayName(draw.source)}`,
		...(draw.votes === undefined
			? []
			: [
					"",
					"확정 투표:",
					...draw.votes.map(
						(vote) =>
							`- ${vote.name}: ${vote.vote === "up" ? "좋아요" : "싫어요"} (+${vote.reactionMs}ms · ${new Date(vote.timestamp).toISOString()})`,
					),
				]),
		"",
		"추첨 요청 시 참가자:",
		...(draw.participants === undefined
			? ["이전 기록에는 참가자 정보가 없습니다"]
			: draw.participants.length === 0
				? ["참가자 0명"]
				: draw.participants.map(
						(participant) =>
							`- ${participant.name}${participant.isHost ? " (방장)" : ""}`,
					)),
		"",
		`후보와 확률 (${draw.probabilities ? "당시 기록된 확률" : "후보 수에 따른 균등 추첨 기준으로 계산"}):`,
		...draw.candidates.map(
			(place, index) =>
				`${index + 1}. ${place.name} (${place.category}) — ${probabilityLabel(draw, index)}`,
		),
	].join("\n");
}

function RoomDrawRecordBody({ draw }: { draw: RoomDraw }) {
	const times = [
		{ label: "추첨 요청", value: draw.requestedAt },
		{ label: "난수 결과 생성", value: draw.timestamp },
		{ label: "룰렛 시작", value: draw.startedAt },
		{ label: "공개 예정 시각", value: draw.startedAt + draw.durationMs },
	];
	return (
		<div className="room-record-details">
			<dl>
				<div>
					<dt>추첨 ID</dt>
					<dd className="room-draw-id">{draw.id}</dd>
				</div>
				<div>
					<dt>난수 출처</dt>
					<dd>{getSourceDisplayName(draw.source)}</dd>
				</div>
				<div>
					<dt>후보 목록 버전</dt>
					<dd>{draw.listVersion}</dd>
				</div>
				{times.map(({ label, value }) => (
					<div key={label}>
						<dt>{label}</dt>
						<dd>
							{value === undefined ? (
								"이전 기록에는 요청 시각이 없습니다"
							) : (
								<time dateTime={new Date(value).toISOString()}>
									{new Date(value).toLocaleString("ko-KR", {
										year: "numeric",
										month: "2-digit",
										day: "2-digit",
										hour: "2-digit",
										minute: "2-digit",
										second: "2-digit",
									})}
								</time>
							)}
						</dd>
					</div>
				))}
			</dl>
			<h4>추첨 요청 시 참가자</h4>
			{draw.participants === undefined ? (
				<p>이전 기록에는 참가자 정보가 없습니다.</p>
			) : draw.participants.length === 0 ? (
				<p>참가자 0명</p>
			) : (
				<ul className="room-draw-participants">
					{draw.participants.map((participant) => (
						<li key={participant.id}>
							{participant.name}
							{participant.isHost && (
								<span className="room-host-badge">방장</span>
							)}
						</li>
					))}
				</ul>
			)}
			<h4>후보와 확률</h4>
			<p className="room-probability-note">
				{draw.probabilities
					? "당시 기록된 후보별 확률입니다."
					: "이전 기록은 후보 수에 따른 균등 추첨 기준으로 계산했습니다."}
			</p>
			<ol className="room-draw-candidates">
				{draw.candidates.map((place, index) => (
					<li key={place.id}>
						<strong>{place.name}</strong>
						<span>{probabilityLabel(draw, index)}</span>
					</li>
				))}
			</ol>
		</div>
	);
}

export default function RoomDrawDialog({
	draw,
	columnRef,
	returnFocusRef,
	fallbackFocusRef,
	chatInputRef,
	onClose,
}: {
	draw: RoomDraw;
	columnRef: RefObject<HTMLDivElement | null>;
	returnFocusRef: RefObject<HTMLButtonElement | null>;
	fallbackFocusRef: RefObject<HTMLHeadingElement | null>;
	chatInputRef: RefObject<HTMLTextAreaElement | null>;
	onClose: () => void;
}) {
	const [modal, setModal] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(max-width: 900px)").matches,
	);
	const [bounds, setBounds] = useState<{ left: number; width: number } | null>(
		null,
	);
	const [copied, setCopied] = useState(false);
	const [copyFailure, setCopyFailure] = useState(false);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const copyButtonRef = useRef<HTMLButtonElement>(null);
	const copyAttemptRef = useRef(0);
	useEffect(() => {
		const media = window.matchMedia("(max-width: 900px)");
		const update = () => setModal(media.matches);
		media.addEventListener("change", update);
		return () => {
			media.removeEventListener("change", update);
			copyAttemptRef.current++;
		};
	}, []);
	useLayoutEffect(() => {
		const column = columnRef.current;
		if (!column) return;
		function measure() {
			if (!column) return;
			const rect = column.getBoundingClientRect();
			setBounds((previous) =>
				previous?.left === rect.left && previous.width === rect.width
					? previous
					: { left: rect.left, width: rect.width },
			);
		}
		measure();
		const observer =
			typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
		observer?.observe(column);
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, [columnRef]);
	async function copyRecord() {
		const attempt = ++copyAttemptRef.current;
		setCopied(false);
		setCopyFailure(false);
		try {
			await navigator.clipboard.writeText(roomDrawCopyText(draw));
			if (attempt !== copyAttemptRef.current) return;
			setCopied(true);
			copyButtonRef.current?.focus();
		} catch {
			if (attempt === copyAttemptRef.current) setCopyFailure(true);
		}
	}
	function restoreFocus() {
		for (const target of [
			returnFocusRef.current,
			fallbackFocusRef.current,
			chatInputRef.current,
		]) {
			if (!target?.isConnected) continue;
			target.focus();
			if (document.activeElement === target) break;
		}
	}
	const frameStyle = bounds
		? ({
				"--room-record-left": `${bounds.left}px`,
				"--room-record-width": `${bounds.width}px`,
			} as CSSProperties)
		: undefined;
	const winner = draw.candidates[draw.winnerIndex];
	return (
		<Dialog.Root
			open
			modal={modal}
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<Dialog.Portal>
				{modal && <Dialog.Overlay className="room-record-overlay" />}
				<div
					className="room-record-frame"
					data-modal={modal ? "true" : "false"}
					style={frameStyle}
				>
					{!modal && (
						<div className="room-record-left-shade" aria-hidden="true" />
					)}
					<Dialog.Content
						className="room-record-dialog"
						aria-modal={modal || undefined}
						onOpenAutoFocus={(event) => {
							event.preventDefault();
							titleRef.current?.focus();
						}}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							restoreFocus();
						}}
						onInteractOutside={(event) => {
							if (!modal) event.preventDefault();
						}}
					>
						<div className="room-record-heading">
							<div>
								<Dialog.Title
									ref={titleRef}
									tabIndex={-1}
									className="room-record-title"
								>
									{winner.name} 상세 기록
								</Dialog.Title>
								<Dialog.Description className="room-record-description">
									이 회차에 저장된 후보와 참가자 정보를 표시합니다.
								</Dialog.Description>
							</div>
							<Dialog.Close
								className="room-chat-icon-button"
								aria-label="상세 기록 닫기"
							>
								<X size={18} aria-hidden="true" />
							</Dialog.Close>
						</div>
						<div className="room-record-body">
							<RoomDrawRecordBody draw={draw} />
							{draw.votes && (
								<RoomDrawFeedback
									draw={draw}
									isHost={false}
									connected={false}
									pending={false}
									readOnly
									onVote={() => false}
								/>
							)}
							{copyFailure && (
								<CopyFallback
									text={roomDrawCopyText(draw)}
									onRetry={() => void copyRecord()}
									onClose={() => {
										copyAttemptRef.current++;
										setCopyFailure(false);
										copyButtonRef.current?.focus();
									}}
								/>
							)}
						</div>
						<div className="room-record-actions">
							{!modal && (
								<button
									type="button"
									className="room-outline-button"
									onClick={() => chatInputRef.current?.focus()}
								>
									채팅으로 이동
								</button>
							)}
							<button
								type="button"
								className="room-outline-button"
								ref={copyButtonRef}
								onClick={() => void copyRecord()}
							>
								{copied ? (
									<Check size={16} aria-hidden="true" />
								) : (
									<Copy size={16} aria-hidden="true" />
								)}
								{copied ? "전체 기록 복사됨" : "전체 기록 복사"}
							</button>
							<Dialog.Close className="room-outline-button">닫기</Dialog.Close>
						</div>
					</Dialog.Content>
				</div>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
