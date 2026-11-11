import { Shuffle } from "lucide-react";
import type { CSSProperties } from "react";
import "./drawing-animation.css";

interface DrawingAnimationProps {
	kind: "number" | "lotto" | "pension";
	count?: number;
}

// These fixed sequences are decorative, never generated or returned draw results.
const digitReels = ["0", "7", "2", "9", "4", "1", "8", "3", "6", "5", "0"];
const lottoReels = [
	"7",
	"24",
	"31",
	"16",
	"42",
	"9",
	"35",
	"18",
	"3",
	"28",
	"7",
];

const slotPositions = ["first", "second", "third", "fourth", "fifth", "sixth"];

export default function DrawingAnimation({
	kind,
	count = 1,
}: DrawingAnimationProps) {
	const slots = kind === "number" ? Math.min(4, Math.max(3, count)) : 6;
	const reels = kind === "lotto" ? lottoReels : digitReels;

	return (
		<div className="drawing-animation" data-kind={kind}>
			<div className="drawing-progress-label" aria-hidden="true">
				<Shuffle size={18} />
				<span>추첨 진행 중</span>
			</div>
			<div
				className="drawing-reels"
				aria-hidden="true"
				style={{ "--drawing-slots": slots } as CSSProperties}
			>
				{slotPositions.slice(0, slots).map((positionName, index) => (
					<div
						className="drawing-slot"
						key={positionName}
						style={{ "--drawing-index": index } as CSSProperties}
					>
						<span className="drawing-static-slot">—</span>
						<div className="drawing-reel">
							{reels.map((value, position) => (
								<span key={`${position}-${value}`}>
									{reels[(position + index * 2) % 10] ?? value}
								</span>
							))}
						</div>
					</div>
				))}
			</div>
			<output className="drawing-status" aria-live="polite">
				<span className="drawing-status-title">숫자 추첨 중</span>
				<span className="drawing-status-description">
					완료되면 결과가 표시됩니다.
				</span>
			</output>
		</div>
	);
}
