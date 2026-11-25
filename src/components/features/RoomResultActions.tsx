import { Button } from "@/components/ui/button";
import type { SpinButtonProps } from "@/hooks/useSpinInput";
import { cn } from "@/lib/utils";

export default function RoomResultActions({
	disabled,
	canRedraw,
	holdHintId,
	nextPending,
	onNext,
	onRedraw,
	redrawButtonProps,
}: {
	disabled: boolean;
	canRedraw: boolean;
	holdHintId?: string;
	nextPending: boolean;
	onNext: () => void;
	onRedraw: () => void;
	redrawButtonProps?: SpinButtonProps;
}) {
	return (
		<div className="room-result-actions flex flex-wrap justify-center gap-2">
			<Button
				variant="outline"
				size="touch"
				className="room-next-round"
				disabled={disabled}
				aria-busy={nextPending || undefined}
				aria-label={nextPending ? "대기 화면으로 이동 중…" : undefined}
				onClick={onNext}
			>
				{nextPending ? "이동 중…" : "대기화면으로 이동"}
			</Button>
			<Button
				size="touch"
				className={cn(
					"room-next-round room-redraw",
					redrawButtonProps && "touch-none select-none",
				)}
				disabled={disabled || !canRedraw}
				aria-describedby={holdHintId}
				onClick={onRedraw}
				{...redrawButtonProps}
			>
				바로 다시 뽑기
			</Button>
		</div>
	);
}
