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
			variant="outline"
			size="lg"
			type="button"
			className="room-next-round"
			disabled={disabled}
			aria-busy={pending || undefined}
			onClick={onClick}
		>
			<span className="picnic-next-label">
				{pending ? "대기 화면으로 이동 중…" : "다음 게임"}
			</span>
			<span className="picnic-next-stub" aria-hidden>
				<ArrowRight size={17} />
			</span>
		</Button>
	);
}
