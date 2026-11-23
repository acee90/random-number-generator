import {
	ChevronLeft,
	ChevronRight,
	List,
	LoaderCircle,
	Shuffle,
	Tickets,
} from "lucide-react";
import {
	type CSSProperties,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { picnic } from "@/components/features/picnic/palette";
import RoomDrawFeedback from "@/components/features/RoomDrawFeedback";
import RoomGameStage from "@/components/features/RoomGameStage";
import RoomNextGameButton from "@/components/features/RoomNextGameButton";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { useRoomTimeline } from "@/hooks/useRoomTimeline";
import type { RoomDraw, RoomDrawVote } from "@/lib/lunchRoom";
import { MenuCard, WinnerTicket } from "./Scenes";
import { sampleCandidates, sampleRound } from "./sample";
import "./draw-views.css";

const modes = {
	rolling: "슬롯머신",
	wheel: "룰렛",
	cards: "카드 뽑기",
} as const;
type Mode = keyof typeof modes;
const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(update: () => void) {
	const media = matchMedia(motionQuery);
	media.addEventListener("change", update);
	return () => media.removeEventListener("change", update);
}

export function DrawViewPreview({
	initialMode,
	count,
	guest,
	longName,
}: {
	initialMode: Mode;
	count: number;
	guest: boolean;
	longName: boolean;
}) {
	const id = useId();
	const [mode, setMode] = useState(initialMode);
	const [index, setIndex] = useState(Math.max(0, Math.min(13, count - 1)));
	const [round, setRound] = useState(1);
	const [draw, setDraw] = useState<RoomDraw | null>(null);
	const [pending, setPending] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const drawButton = useRef<HTMLButtonElement>(null);
	const rotor = useRef<HTMLDivElement>(null);
	const selectedMode = useRef<HTMLButtonElement>(null);
	const result = useRef<HTMLHeadingElement>(null);
	const places = useMemo(
		() => sampleCandidates(count, longName),
		[count, longName],
	);
	const reduced = useSyncExternalStore(
		subscribeMotion,
		() => matchMedia(motionQuery).matches,
		() => false,
	);
	const finished = useRoomTimeline(draw, 0, rotor, reduced);
	const locked = pending || Boolean(draw);
	const spinning = Boolean(draw && !finished);
	const label = modes[mode];

	useEffect(() => () => clearTimeout(timer.current), []);
	useEffect(() => {
		if (finished && !document.querySelector('[role="dialog"]')) {
			result.current?.focus({ preventScroll: true });
		}
	}, [finished]);

	function start() {
		if (guest || locked || !places.length || timer.current !== undefined)
			return;
		setPending(true);
		timer.current = setTimeout(() => {
			setDraw(sampleRound(places, round, longName));
			setPending(false);
			timer.current = undefined;
		}, 320);
	}
	function next() {
		setRound(round + 1);
		setDraw(null);
		requestAnimationFrame(() => selectedMode.current?.focus());
	}
	function vote(drawId: string, choice: RoomDrawVote["vote"]) {
		if (!draw || draw.id !== drawId || !finished || draw.votes?.length)
			return false;
		const timestamp = Date.now();
		setDraw({
			...draw,
			votes: [
				{
					participantId: "preview-host",
					name: "방장",
					vote: choice,
					reactionMs: Math.max(0, timestamp - draw.startedAt - draw.durationMs),
					timestamp,
				},
			],
		});
		return true;
	}

	const status = pending ? "추첨 준비 중" : "추첨 중";
	const place = places[index];
	const previewName =
		mode === "cards" && place ? `미리보기, ${index + 1}번 ${place.name}` : "";
	const allowBrowse = !locked && count > 1;
	const action = count === 1 ? "마지막 후보 확정" : "카드 한 장 뽑기";
	const palette = {
		"--dv-mint": picnic.slices[1],
		"--dv-gold": picnic.slices[0],
		"--dv-coral": picnic.slices[2],
	} as CSSProperties;

	return (
		<main className="dv-preview" style={palette}>
			<header className="dv-heading">
				<div>
					<p>{round}회차</p>
					<h1>점심 추첨</h1>
				</div>
				<Dialog>
					<DialogTrigger asChild>
						<Button
							variant="outline"
							className="dv-list-trigger"
							aria-label={`후보 ${count}개 보기`}
						>
							<List aria-hidden="true" />
							후보 {count}개<ChevronRight aria-hidden="true" />
						</Button>
					</DialogTrigger>
					<DialogContent
						className="dv-list-dialog"
						aria-describedby={undefined}
					>
						<DialogHeader>
							<DialogTitle>이번 추첨 후보 {count}개</DialogTitle>
						</DialogHeader>
						{count ? (
							// biome-ignore lint/a11y/noNoninteractiveTabindex: Let keyboard users scroll the full candidate list inside the dialog.
							<ol aria-label="후보 전체 목록" tabIndex={0}>
								{places.map((item, i) => (
									<li key={item.id}>
										<span className="dv-serial">
											{String(i + 1).padStart(3, "0")}
										</span>
										<strong>{item.name}</strong>
										<small>{item.category}</small>
									</li>
								))}
							</ol>
						) : (
							<p>이번 게임에 포함된 후보가 없습니다.</p>
						)}
					</DialogContent>
				</Dialog>
			</header>
			<div className="dv-picker">
				{guest ? (
					<p>
						{label} <span>· 방장 선택</span>
					</p>
				) : (
					<Combobox
						label="추첨 보기"
						options={modes}
						value={mode}
						onValueChange={setMode}
						disabled={locked}
						triggerRef={selectedMode}
					/>
				)}
			</div>

			{!count ? (
				<div className="dv-empty">
					<Tickets aria-hidden="true" />
					<p>추첨할 후보가 없습니다.</p>
					<small>후보를 추가하거나 제외 조건을 확인해 주세요.</small>
				</div>
			) : mode === "cards" && finished && draw ? (
				<div>
					<section
						className="picnic-frame dv-mat dv-result"
						data-view={mode}
						aria-label="추첨 결과"
					>
						<WinnerTicket draw={draw} titleRef={result} />
					</section>
					<RoomDrawFeedback
						draw={draw}
						selfId="preview-host"
						connected
						pending={false}
						isHost={!guest}
						mode="results"
						onVote={vote}
					/>
					<div className="dv-next">
						<RoomNextGameButton
							disabled={false}
							pending={false}
							onClick={next}
						/>
					</div>
				</div>
			) : mode !== "cards" ? (
				<RoomGameStage
					viewMode={mode === "rolling" ? "slot-v1" : "wheel"}
					activeDraw={draw}
					draw={finished ? draw : null}
					titleRef={result}
					selfId="preview-host"
					connected
					pending={false}
					isHost={!guest}
					reducedMotion={reduced}
					canNext
					onNext={next}
					onVote={vote}
					wheel={{
						candidates: places,
						candidateNumbers: places.map((_, i) => i + 1),
						rotation: 0,
						phase: pending
							? "fetching"
							: spinning
								? "spinning"
								: finished
									? "done"
									: "idle",
						controlled: true,
						onComplete: () => {},
						onDraw: start,
						buttonId: id,
						covered: locked,
						canDraw: !guest,
						drawLabel: count === 1 ? "마지막 후보 확정" : "룰렛 돌리기",
						drawText: count === 1 ? "후보 확정" : "돌리기",
						buttonRef: drawButton,
						rotorRef: rotor,
					}}
				/>
			) : (
				<section className="picnic-frame dv-mat" aria-label={`${label} 추첨판`}>
					<div className="dv-toolbar" data-busy={locked || undefined}>
						<p>
							<span className="dv-status-dot" />
							후보 미리보기
						</p>
						<div className="dv-browse">
							<Button
								variant="ghost"
								size="icon"
								disabled={!allowBrowse}
								aria-label="이전 후보"
								onClick={() => setIndex((index + count - 1) % count)}
							>
								<ChevronLeft aria-hidden="true" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								disabled={!allowBrowse}
								aria-label="다음 후보"
								onClick={() => setIndex((index + 1) % count)}
							>
								<ChevronRight aria-hidden="true" />
							</Button>
						</div>
					</div>
					<div className="dv-scene">
						<MenuCard place={place} index={index} drawing={spinning} />
					</div>
					<div className="dv-action">
						{guest ? (
							<p>방장의 추첨을 기다리는 중</p>
						) : (
							<Button
								size="lg"
								ref={drawButton}
								disabled={locked}
								aria-busy={locked}
								onClick={start}
							>
								{locked ? (
									<LoaderCircle aria-hidden="true" />
								) : (
									<Shuffle aria-hidden="true" />
								)}
								{locked ? status : action}
							</Button>
						)}
					</div>
				</section>
			)}
			<output className="sr-only" aria-live="polite" aria-atomic="true">
				{finished ? "" : locked ? status : previewName}
			</output>
		</main>
	);
}
