import SiteHeader from "@/components/layout/SiteHeader";
import { lunchRoomLimits } from "@/lib/lunchRoom";
import CreateLunchRoom from "./CreateLunchRoom";

export default function CreateLunchRoomPage({
	solo = false,
}: {
	solo?: boolean;
}) {
	return (
		<div className="random-lab flex h-dvh flex-col">
			<SiteHeader active="lunch" />
			<main
				id="main-content"
				className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-3 py-4 sm:pt-6"
			>
				<CreateLunchRoom solo={solo} />
				<p className="shrink-0 text-sm text-muted-foreground">
					{solo
						? "이 탭에 최대 24시간 보관 · 탭을 닫으면 삭제"
						: `최대 ${lunchRoomLimits.maxParticipants}명 · 방과 기록은 24시간 뒤 삭제`}
				</p>
			</main>
		</div>
	);
}
