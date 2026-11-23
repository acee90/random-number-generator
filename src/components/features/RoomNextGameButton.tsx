import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function RoomNextGameButton({
	disabled,
	pending,
	onClick,
}: {
	disabled: boolean;
	pending: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			variant="default"
			size="lg"
			type="button"
			className="room-next-round"
			disabled={disabled}
			aria-busy={pending || undefined}
			aria-label={pending ? "대기 화면으로 이동 중…" : undefined}
			onClick={onClick}
		>
			<span>{pending ? "이동 중…" : "다음 게임"}</span>
			<ArrowRight size={18} aria-hidden />
		</Button>
	);
}
