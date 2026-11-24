import { Button } from "@/components/ui/button";

export default function RoomResultActions({
	disabled,
	canRedraw,
	nextPending,
	onNext,
	onRedraw,
}: {
	disabled: boolean;
	canRedraw: boolean;
	nextPending: boolean;
	onNext: () => void;
	onRedraw: () => void;
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
				className="room-next-round"
				disabled={disabled || !canRedraw}
				onClick={onRedraw}
			>
				바로 다시 뽑기
			</Button>
		</div>
	);
}
