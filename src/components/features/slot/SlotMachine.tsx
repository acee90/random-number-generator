import {
	Check,
	ChevronLeft,
	ChevronRight,
	LoaderCircle,
	Shuffle,
} from "lucide-react";
import { type ReactElement, type RefObject, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LunchPlace } from "@/lib/lunch";
import type { RoomDraw } from "@/lib/lunchRoom";
import type { BallotScene } from "../picnic/ballots";
import { slotStrip } from "./motion";
import { useSlotReel } from "./useSlotReel";
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
	result: BallotScene["result"];
	voteMotionRound?: string;
	showVoting: boolean;
	children: ReactElement;
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
	result,
	voteMotionRound,
	showVoting,
	children,
	buttonRef,
	buttonId,
	titleRef,
	titleId,
}: Props) {
	const count = candidates.length;
	const [preview, setPreview] = useState(0);
	const done = phase === "done";
	const busy = phase === "fetching" || phase === "spinning";
	const winner = draw?.winnerIndex;
	const rows = useMemo(
		() => slotStrip(count, preview, winner),
		[count, preview, winner],
	);
	const landingRow = rows.length - 3;
	const { canvasRef, cabinetRef } = useSlotReel({
		phase,
		rowCount: rows.length,
		startedAt: draw?.startedAt,
		duration: draw?.durationMs,
		clockOffset,
		reduced,
		result,
		voteMotionRound,
	});

	const label = done
		? "추첨 완료"
		: phase === "spinning"
			? "추첨 중"
			: phase === "fetching"
				? "추첨 준비 중"
				: "후보 미리보기";
	const action = count === 1 ? "마지막 후보 확정" : "슬롯 돌리기";
	return (
		<div
			className="slot-machine"
			data-phase={phase}
			data-voting={showVoting || undefined}
			data-host={host || undefined}
		>
			<canvas className="slot-art" ref={canvasRef} inert />
			<div className="slot-cabinet" ref={cabinetRef}>
				<div className="slot-plaque">
					<span className="slot-rule" aria-hidden="true" />
					<span className="slot-plaque-label">슬롯머신</span>
					<span className="slot-rule" aria-hidden="true" />
				</div>
				<div className="slot-bezel">
					<div className="slot-drum">
						<div className="slot-strip">
							{rows.map((index, slot) => {
								const place = index === null ? undefined : candidates[index];
								const landing = winner !== undefined && slot === landingRow + 1;
								return (
									<div
										className="slot-row"
										// biome-ignore lint/suspicious/noArrayIndexKey: Fixed positions on the drum outlive their labels.
										key={slot}
										aria-hidden={done && landing ? undefined : true}
									>
										{index !== null && place && (
											<>
												<span className="slot-number">
													<span className="sr-only">후보 </span>
													{String(numbers[index] ?? index + 1).padStart(2, "0")}
													<span className="sr-only">번</span>
												</span>
												{landing ? (
													<h3
														className="slot-name"
														tabIndex={-1}
														ref={done ? titleRef : undefined}
														id={titleId}
														title={done ? place.name : undefined}
													>
														{place.name}
													</h3>
												) : (
													<span className="slot-name">{place.name}</span>
												)}
											</>
										)}
									</div>
								);
							})}
						</div>
						<div className="slot-payline" aria-hidden="true" />
					</div>
				</div>
				<div className="slot-controls">
					{count > 1 && (
						<Button
							size="icon"
							variant="ghost"
							aria-label="이전 후보"
							disabled={phase !== "idle"}
							onClick={() => setPreview((preview + count - 1) % count)}
						>
							<ChevronLeft aria-hidden="true" />
						</Button>
					)}
					{host ? (
						<Button
							id={buttonId}
							ref={buttonRef}
							className="slot-action"
							size="lg"
							disabled={disabled || busy || done || !count}
							aria-busy={busy}
							onClick={onDraw}
						>
							{busy ? (
								<LoaderCircle
									className="motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : done ? (
								<Check aria-hidden="true" />
							) : (
								<Shuffle aria-hidden="true" />
							)}
							{busy || done ? label : action}
						</Button>
					) : (
						<span className="slot-wait">
							{busy || done ? label : "방장의 추첨을 기다리는 중"}
						</span>
					)}
					{count > 1 && (
						<Button
							size="icon"
							variant="ghost"
							aria-label="다음 후보"
							disabled={phase !== "idle"}
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
			<div className="slot-reveal">{children}</div>
		</div>
	);
}
