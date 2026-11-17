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
			onClick={onClick}
		>
			{pending ? "대기 화면으로 이동 중…" : "다음 게임"}
			<ArrowRight size={18} aria-hidden="true" />
		</Button>
	);
}
