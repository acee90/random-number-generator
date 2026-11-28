import { Shuffle, Zap } from "lucide-react";
import {
	type ComponentPropsWithoutRef,
	memo,
	type RefObject,
	useCallback,
	useRef,
} from "react";
import { Button } from "@/components/ui/button";
import type { LunchPlace } from "@/lib/lunch";
import type { SpinDrive } from "@/lib/spinDrive";
import type { SpinAdjustment } from "./game-art/spin-motion";
import {
	getWheelLabels,
	layoutWheelLabels,
	type WheelLabel,
	wheelControl,
	wheelFaceRadius,
} from "./picnic/layout";
import { useDriveRotation } from "./picnic/useDriveRotation";
import "./lunch-wheel.css";

type Phase = "idle" | "fetching" | "spinning" | "done";

const wheelColors = ["#d6f266", "#edf2e3", "#ffffff", "#dce6c9"];
const WheelFace = memo(
	function WheelFace({
		labels,
		side,
	}: {
		labels: readonly WheelLabel[];
		side: number;
	}) {
		const {
			items,
			badgeWidth,
			badgeHeight,
			numberSize,
			showNames,
			nameOffset,
			nameSize,
		} = layoutWheelLabels(labels, side);
		return (
			<svg
				viewBox={`-${wheelFaceRadius} -${wheelFaceRadius} ${wheelFaceRadius * 2} ${wheelFaceRadius * 2}`}
				focusable="false"
				aria-hidden="true"
			>
				{items.map(({ label, x, y, rotation, nameOnRight }) => (
					<g
						key={label.id}
						className="lunch-wheel-label"
						transform={`translate(${x} ${y}) rotate(${rotation})`}
						direction="ltr"
					>
						{showNames && (
							<rect
								x={-badgeWidth / 2}
								y={-badgeHeight / 2}
								width={badgeWidth}
								height={badgeHeight}
								rx={badgeHeight / 2}
							/>
						)}
						<text
							className="lunch-wheel-number"
							textAnchor="middle"
							dominantBaseline="central"
							fontSize={numberSize}
						>
							{label.number}
						</text>
						{showNames && (
							<text
								x={nameOnRight ? nameOffset : -nameOffset}
								textAnchor={nameOnRight ? "start" : "end"}
								dominantBaseline="central"
								fontSize={nameSize}
							>
								{label.name}
							</text>
						)}
					</g>
				))}
			</svg>
		);
	},
	(previous, next) =>
		previous.side === next.side &&
		previous.labels.length === next.labels.length &&
		previous.labels.every(
			(label, index) =>
				label.id === next.labels[index].id &&
				label.number === next.labels[index].number &&
				label.name === next.labels[index].name,
		),
);

export function LunchWheel({
	candidates,
	candidateNumbers,
	wheelSide = 440,
	rotation,
	phase,
	onComplete,
	onDraw,
	buttonId,
	errorId,
	covered,
	buttonRef,
	rotorRef,
	controlled = false,
	canDraw = true,
	drawLabel,
	drawText,
	drive,
	driveClockOffset = 0,
	driveAdjustment,
	motionOff = false,
	holdHintId,
	drawButtonProps,
	externalControl = false,
}: {
	candidates: readonly LunchPlace[];
	candidateNumbers: readonly number[];
	wheelSide?: number;
	rotation: number;
	phase: Phase;
	onComplete: () => void;
	onDraw: () => void;
	buttonId: string;
	errorId?: string;
	covered: boolean;
	buttonRef: RefObject<HTMLButtonElement | null>;
	rotorRef?: RefObject<HTMLDivElement | null>;
	controlled?: boolean;
	canDraw?: boolean;
	drawLabel?: string;
	drawText?: string;
	drive?: SpinDrive;
	driveClockOffset?: number;
	driveAdjustment?: SpinAdjustment;
	motionOff?: boolean;
	holdHintId?: string;
	drawButtonProps?: ComponentPropsWithoutRef<"button">;
	externalControl?: boolean;
}) {
	const size = candidates.length;
	const ownRotorRef = useRef<HTMLDivElement>(null);
	const rotor = rotorRef ?? ownRotorRef;
	const rotate = useCallback(
		(position: number) =>
			rotor.current?.style.setProperty(
				"transform",
				`rotate(${position * 360}deg)`,
			),
		[rotor],
	);
	useDriveRotation(drive, driveClockOffset, motionOff, rotate, driveAdjustment);
	const { busy, caption, label } = wheelControl(
		phase,
		canDraw,
		Boolean(drive),
		drawLabel,
		drawText,
	);
	const disabled = !canDraw || covered || busy;
	const labels = getWheelLabels(candidates, candidateNumbers);
	const background =
		size > 360
			? "repeating-conic-gradient(#d6f266 0deg .5deg, #dce6c9 .5deg 1deg)"
			: size
				? `conic-gradient(${candidates
						.map(
							(_, index) =>
								`${wheelColors[index % wheelColors.length]} ${(index * 360) / size}deg ${((index + 1) * 360) / size}deg`,
						)
						.join(", ")})`
				: "#edf2e3";
	return (
		<div
			className="lunch-wheel"
			data-candidate-count={size}
			data-phase={phase}
			data-drive={drive ? (drive.held ? "held" : "braking") : undefined}
		>
			<div className="lunch-wheel-pointer" aria-hidden="true" />
			<div className="lunch-wheel-track" aria-hidden="true">
				<div
					className="lunch-wheel-rotor"
					ref={rotor}
					data-controlled={Boolean(drive || controlled) || undefined}
					aria-hidden="true"
					data-phase={phase}
					style={{
						background,
						transform: drive ? undefined : `rotate(${rotation}deg)`,
					}}
					onTransitionEnd={(event) => {
						if (
							event.target === event.currentTarget &&
							event.propertyName === "transform"
						)
							onComplete();
					}}
				>
					<WheelFace labels={labels} side={wheelSide} />
				</div>
			</div>
			{!externalControl && (
				<Button
					variant="plain"
					size="auto"
					type="button"
					id={buttonId}
					ref={buttonRef}
					className="lunch-wheel-center"
					data-hit="draw"
					data-draw-permission={canDraw ? "host" : "viewer"}
					disabled={disabled}
					aria-busy={busy || undefined}
					onClick={() => onDraw()}
					aria-label={label}
					aria-describedby={
						[errorId, holdHintId].filter(Boolean).join(" ") || undefined
					}
					{...drawButtonProps}
				>
					{busy ? (
						<Zap size={22} aria-hidden="true" />
					) : (
						<Shuffle size={22} aria-hidden="true" />
					)}
					<span aria-hidden="true">{caption}</span>
					<small aria-hidden="true">{size}개</small>
				</Button>
			)}
		</div>
	);
}
