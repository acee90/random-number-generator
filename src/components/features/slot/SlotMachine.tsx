import { Check, Shuffle, Zap } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	type ReactElement,
	type RefObject,
	useMemo,
} from "react";
import { Button } from "@/components/ui/button";
import type { LunchPlace } from "@/lib/lunch";
import type { RoomDraw } from "@/lib/lunchRoom";
import {
	getSpinDeadline,
	getSpinSlotIndex,
	type SpinDrive,
} from "@/lib/spinDrive";
import type { SpinAdjustment } from "../game-art/spin-motion";
import type { BallotScene } from "../picnic/ballots";
import { slotStrip } from "./motion";
import { type SlotMotionOptions, useSlotReel } from "./useSlotReel";
import "./slot-machine.css";

const preview = 0;

type Props = {
	candidates: readonly LunchPlace[];
	numbers: readonly number[];
	draw: RoomDraw | null;
	clockOffset: number;
	phase: "idle" | "fetching" | "spinning" | "done";
	reduced: boolean;
	host: boolean;
	disabled: boolean;
	drive?: SpinDrive;
	driveClockOffset?: number;
	driveAdjustment?: SpinAdjustment;
	motionOptions?: SlotMotionOptions;
	holdHintId?: string;
	drawButtonProps?: ComponentPropsWithoutRef<"button">;
	canReplay?: boolean;
	countdown?: ReactElement;
	resultActions: ReactElement | null;
	result: BallotScene["result"];
	voteMotionRound?: string;
	showVoting: boolean;
	children?: ReactElement;
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
	drive = draw?.drive,
	driveClockOffset = clockOffset,
	driveAdjustment,
	motionOptions,
	holdHintId,
	drawButtonProps,
	canReplay = false,
	countdown,
	resultActions,
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
	const done = phase === "done";
	const busy = !drive && (phase === "fetching" || phase === "spinning");
	const winner = draw?.winnerIndex;
	const moving = Boolean(drive && !done);
	// Keep the first travelling window painted while waiting for the press.
	const windowReady = moving || (!draw && !done && count > 1);
	const completed = done && !canReplay;
	const blocked = disabled || busy || completed || !count;
	const rows = useMemo(
		() =>
			drive
				? slotStrip(count, done ? (winner ?? preview) : preview)
				: slotStrip(count, preview, winner),
		[count, winner, drive, done],
	);
	const landingRow = rows.length - 3;
	const { canvasRef, cabinetRef } = useSlotReel({
		phase,
		rowCount: windowReady ? 4 : rows.length,
		startedAt: draw?.startedAt,
		duration: draw ? getSpinDeadline(draw) - draw.startedAt : undefined,
		power: draw?.spinPower ?? 0,
		clockOffset,
		drive,
		driveClockOffset,
		driveAdjustment,
		motionOptions,
		candidates,
		numbers,
		preview,
		reduced,
		result,
		voteMotionRound,
	});

	const label = done
		? "추첨 완료"
		: phase === "fetching"
			? "슬롯 준비 중"
			: "추첨 중";
	const action = count === 1 ? "마지막 후보 확정" : "슬롯 돌리기";
	return (
		<div
			className="slot-machine"
			data-phase={phase}
			data-drive={moving ? (drive?.held ? "held" : "braking") : undefined}
			data-voting={showVoting || undefined}
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
							{windowReady
								? [0, 1, 2, 3].map((slot) => {
										const index = getSpinSlotIndex(preview + slot - 1, count);
										return (
											<div
												className="slot-row"
												key={`live-${slot}`}
												aria-hidden="true"
											>
												<span className="slot-number">
													{String(numbers[index] ?? index + 1).padStart(2, "0")}
												</span>
												<span className="slot-name">
													{candidates[index]?.name}
												</span>
											</div>
										);
									})
								: rows.map((index, slot) => {
										const place =
											index === null ? undefined : candidates[index];
										const landing =
											winner !== undefined && slot === landingRow + 1;
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
															{String(numbers[index] ?? index + 1).padStart(
																2,
																"0",
															)}
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
					{resultActions ? (
						resultActions
					) : host ? (
						<Button
							id={buttonId}
							ref={buttonRef}
							className="slot-action"
							size="lg"
							disabled={blocked}
							aria-busy={busy || undefined}
							aria-describedby={holdHintId}
							{...drawButtonProps}
						>
							{busy ? (
								<Zap aria-hidden="true" />
							) : completed ? (
								<Check aria-hidden="true" />
							) : (
								<Shuffle aria-hidden="true" />
							)}
							<span className="slot-action-label">
								{busy || completed ? label : action}
							</span>
						</Button>
					) : (
						<span className="slot-wait">
							{phase === "idle" ? "방장의 추첨을 기다리는 중" : label}
						</span>
					)}
				</div>
			</div>
			{countdown && <div className="slot-countdown">{countdown}</div>}
			<div className="slot-reveal">{children}</div>
		</div>
	);
}
