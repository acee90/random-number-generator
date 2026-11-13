import { LoaderCircle, Shuffle } from "lucide-react";
import { memo, type RefObject } from "react";
import type { LunchPlace } from "@/lib/lunch";
import "./lunch-picker.css";

type Phase = "idle" | "fetching" | "spinning" | "done";

const wheelColors = ["#d6f266", "#edf2e3", "#ffffff", "#dce6c9"];

type WheelLabel = { id: string; text: string };

const WheelFace = memo(
	function WheelFace({ labels }: { labels: readonly WheelLabel[] }) {
		const size = labels.length;
		const labelFontSize =
			size > 12 ? Math.min(14, (2 * Math.PI * 112) / size) : 18;
		return (
			<svg viewBox="0 0 400 400" focusable="false" aria-hidden="true">
				{labels.map((label, index) => {
					const angle = ((index + 0.5) * 360) / size;
					const radians = ((angle - 90) * Math.PI) / 180;
					const radius = 188;
					const flipped = angle > 180;
					// Avoid SVG hydration differences between math engines.
					const x = Number((200 + Math.cos(radians) * radius).toFixed(4));
					const y = Number((200 + Math.sin(radians) * radius).toFixed(4));
					return (
						<text
							key={label.id}
							x={x}
							y={y}
							textAnchor={flipped ? "start" : "end"}
							dominantBaseline="central"
							style={{ fontSize: labelFontSize }}
							transform={`rotate(${angle - 90 + (flipped ? 180 : 0)}, ${x}, ${y})`}
						>
							{label.text}
						</text>
					);
				})}
			</svg>
		);
	},
	(previous, next) =>
		previous.labels.length === next.labels.length &&
		previous.labels.every(
			(label, index) =>
				label.id === next.labels[index].id &&
				label.text === next.labels[index].text,
		),
);

export function LunchWheel({
	candidates,
	candidateNumbers,
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
}: {
	candidates: readonly LunchPlace[];
	candidateNumbers: readonly number[];
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
}) {
	const size = candidates.length;
	const labels = candidates.map((place, index) => ({
		id: place.id,
		text: `${candidateNumbers[index]} ${place.name.length > 5 ? `${place.name.slice(0, 4)}…` : place.name}`,
	}));
	const background = size
		? `conic-gradient(${candidates
				.map(
					(_, index) =>
						`${wheelColors[index % wheelColors.length]} ${(index * 360) / size}deg ${((index + 1) * 360) / size}deg`,
				)
				.join(", ")})`
		: "#edf2e3";
	return (
		<div className="lunch-wheel" data-candidate-count={size}>
			<div className="lunch-wheel-pointer" aria-hidden="true" />
			<div className="lunch-wheel-track" aria-hidden="true">
				<div
					className="lunch-wheel-rotor"
					ref={rotorRef}
					data-controlled={controlled || undefined}
					aria-hidden="true"
					data-phase={phase}
					style={{ background, transform: `rotate(${rotation}deg)` }}
					onTransitionEnd={(event) => {
						if (
							event.target === event.currentTarget &&
							event.propertyName === "transform"
						)
							onComplete();
					}}
				>
					<WheelFace labels={labels} />
				</div>
			</div>
			<button
				type="button"
				id={buttonId}
				ref={buttonRef}
				className="lunch-wheel-center"
				data-draw-permission={canDraw ? "host" : "viewer"}
				disabled={
					!canDraw || covered || phase === "fetching" || phase === "spinning"
				}
				onClick={onDraw}
				aria-label={
					phase === "fetching"
						? "추첨 준비 중…"
						: phase === "spinning"
							? "룰렛이 돌아가고 있어요"
							: !canDraw
								? "방장이 추첨을 시작할 때까지 대기"
								: phase === "done"
									? "한 번 더 추첨하기"
									: "점심 메뉴 추첨하기"
				}
				aria-describedby={errorId}
			>
				{phase === "fetching" ? (
					<LoaderCircle size={22} aria-hidden="true" />
				) : (
					<Shuffle size={22} aria-hidden="true" />
				)}
				<span aria-hidden="true">
					{phase === "fetching"
						? "준비 중"
						: phase === "spinning"
							? "룰렛"
							: !canDraw
								? "방장 대기"
								: phase === "done"
									? "한 번 더"
									: "추첨하기"}
				</span>
				<small aria-hidden="true">{size}곳</small>
			</button>
		</div>
	);
}
