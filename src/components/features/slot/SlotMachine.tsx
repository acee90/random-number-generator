import {
	Award,
	ChevronLeft,
	ChevronRight,
	LoaderCircle,
	Shuffle,
} from "lucide-react";
import {
	type ReactElement,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import type { LunchPlace } from "@/lib/lunch";
import type { RoomDraw } from "@/lib/lunchRoom";
import type { createDrumArt } from "./drumArt";
import { slotMotion, slotStrip, slotStripOffset } from "./motion";
import "./slot-machine.css";

type Props = {
	candidates: readonly LunchPlace[];
	numbers: readonly number[];
	draw: RoomDraw | null;
	clockOffset: number;
	phase: "idle" | "fetching" | "spinning" | "done";
	reduced: boolean;
	host: boolean;
	disabled: boolean;
	onDraw: () => void;
	resultActions: ReactElement | null;
	buttonRef: RefObject<HTMLButtonElement | null>;
	buttonId: string;
	titleRef?: RefObject<HTMLHeadingElement | null>;
	titleId: string;
};

export default function SlotMachine({
	candidates,
	numbers,
	draw,
	clockOffset,
	phase,
	reduced,
	host,
	disabled,
	onDraw,
	resultActions,
	buttonRef,
	buttonId,
	titleRef,
	titleId,
}: Props) {
	const count = candidates.length;
	const [preview, setPreview] = useState(0);
	const windowRef = useRef<HTMLDivElement>(null);
	const stripRef = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const art = useRef<Awaited<ReturnType<typeof createDrumArt>> | null>(null);
	const frame = useRef({ width: 0, height: 0, row: 0, speed: 0 });
	const [showFullName, setShowFullName] = useState(false);
	const done = phase === "done";
	const busy = phase === "fetching" || phase === "spinning";
	const winner = draw?.winnerIndex;
	const category = draw?.candidates[draw.winnerIndex]?.category;
	const rows = useMemo(
		() => slotStrip(count, preview, winner),
		[count, preview, winner],
	);
	const landingRow = rows.length - 3;
	const startedAt = draw?.startedAt,
		duration = draw?.durationMs;

	useEffect(() => {
		if (
			!canvas.current ||
			!window.CanvasRenderingContext2D ||
			window.matchMedia("(forced-colors: active)").matches
		)
			return;
		let active = true;
		const element = canvas.current;
		void import("./drumArt")
			.then(async ({ createDrumArt }) => {
				if (!active) return;
				const instance = await createDrumArt(element);
				if (!active) return instance.destroy();
				art.current = instance;
				const { width, height, row, speed } = frame.current;
				instance.paint(width, height, row, speed);
			})
			.catch(() => {
				/* The DOM drum and all controls work without the canvas. */
			});
		return () => {
			active = false;
			art.current?.destroy();
			art.current = null;
		};
	}, []);

	useLayoutEffect(() => {
		const drum = windowRef.current,
			strip = stripRef.current;
		if (!drum || !strip) return;
		const motionOff =
			reduced || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		let raf = 0;
		function paint() {
			if (!drum || !strip) return;
			const elapsed =
				startedAt === undefined ? 0 : Date.now() + clockOffset - startedAt;
			const moving =
				!motionOff && !done && duration !== undefined && landingRow > 0;
			const { travel, speed } = moving
				? slotMotion(elapsed, duration, landingRow)
				: { travel: 0, speed: 0 };
			const row = done ? landingRow : slotStripOffset(travel);
			const state = frame.current;
			state.row = row;
			state.speed = speed;
			strip.style.transform = `translateY(${(-row * 100) / rows.length}%)`;
			drum.style.setProperty("--drum-blur", `${1.6 * speed ** 2}px`);
			art.current?.paint(state.width, state.height, row, speed);
			if (moving && elapsed < duration && !document.hidden)
				raf = requestAnimationFrame(paint);
		}
		function align() {
			cancelAnimationFrame(raf);
			if (!drum) return;
			frame.current.width = drum.clientWidth;
			frame.current.height = drum.clientHeight;
			paint();
			const name = drum.querySelector<HTMLElement>(".slot-name-measure");
			setShowFullName(
				Boolean(name && name.scrollHeight > name.clientHeight + 1),
			);
		}
		align();
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(align);
		observer?.observe(drum);
		document.addEventListener("visibilitychange", align);
		return () => {
			cancelAnimationFrame(raf);
			observer?.disconnect();
			document.removeEventListener("visibilitychange", align);
		};
	}, [
		clockOffset,
		done,
		duration,
		landingRow,
		reduced,
		rows.length,
		startedAt,
	]);

	const browsing = phase === "idle" && count > 1;
	const plaqueCategory = done && resultActions ? category : undefined;
	const label = done
		? "당첨 메뉴"
		: phase === "spinning"
			? "추첨 중"
			: phase === "fetching"
				? "추첨 준비 중"
				: "후보 미리보기";
	const action = count === 1 ? "마지막 후보 확정" : "슬롯 돌리기";
	return (
		<div className="slot-machine" data-phase={phase}>
			<div className="slot-cabinet">
				<div className="slot-plaque">
					<span className="slot-rule" aria-hidden="true" />
					<span className="slot-plaque-label" title={plaqueCategory}>
						{label}
						{plaqueCategory && ` · ${plaqueCategory}`}
					</span>
					<span className="slot-rule" aria-hidden="true" />
				</div>
				<div className="slot-bezel">
					<div
						className="slot-drum"
						ref={windowRef}
						data-full-name={(done && showFullName) || undefined}
					>
						<div className="slot-strip" ref={stripRef}>
							{rows.map((index, slot) => {
								const place = index === null ? undefined : candidates[index];
								const landed = done && slot === landingRow + 1;
								return (
									<div
										className="slot-row"
										// biome-ignore lint/suspicious/noArrayIndexKey: Fixed positions on the drum outlive their labels.
										key={slot}
										aria-hidden={landed ? undefined : true}
									>
										{index !== null && place && (
											<>
												<span className="slot-number">
													<span className="sr-only">후보 </span>
													{String(numbers[index] ?? index + 1).padStart(2, "0")}
													<span className="sr-only">번</span>
												</span>
												{landed ? (
													<>
														<span
															aria-hidden="true"
															className="slot-name slot-name-measure"
														>
															{place.name}
														</span>
														<h3
															className="slot-name"
															tabIndex={-1}
															ref={titleRef}
															id={titleId}
														>
															{place.name}
														</h3>
													</>
												) : (
													<span className="slot-name">{place.name}</span>
												)}
											</>
										)}
									</div>
								);
							})}
						</div>
						<canvas className="slot-etching" ref={canvas} inert />
						<div className="slot-payline" aria-hidden="true" />
					</div>
				</div>
				<div className="slot-controls">
					{browsing && (
						<Button
							size="icon"
							variant="ghost"
							aria-label="이전 후보"
							onClick={() => setPreview((preview + count - 1) % count)}
						>
							<ChevronLeft aria-hidden="true" />
						</Button>
					)}
					{done ? (
						(resultActions ?? (
							<div className="slot-outcome">
								<Award aria-hidden="true" />
								<span>{category}</span>
							</div>
						))
					) : host ? (
						<Button
							id={buttonId}
							ref={buttonRef}
							className="slot-action"
							size="lg"
							disabled={disabled || busy || !count}
							aria-busy={busy}
							onClick={onDraw}
						>
							{busy ? (
								<LoaderCircle
									className="motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : (
								<Shuffle aria-hidden="true" />
							)}
							{busy ? label : action}
						</Button>
					) : (
						<span className="slot-wait">
							{busy ? label : "방장의 추첨을 기다리는 중"}
						</span>
					)}
					{browsing && (
						<Button
							size="icon"
							variant="ghost"
							aria-label="다음 후보"
							onClick={() => setPreview((preview + 1) % count)}
						>
							<ChevronRight aria-hidden="true" />
						</Button>
					)}
				</div>
				{phase === "idle" && count > 0 && (
					<output className="sr-only" aria-live="polite">
						후보 미리보기 · {candidates[preview % count].name}
					</output>
				)}
			</div>
		</div>
	);
}
