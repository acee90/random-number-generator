import SiteHeader from "@/components/layout/SiteHeader";
import { lunchRoomLimits } from "@/lib/lunchRoom";
import CreateLunchRoom from "./CreateLunchRoom";

export default function CreateLunchRoomPage() {
	return (
		<div className="random-lab flex h-dvh flex-col">
			<SiteHeader active="lunch" />
			<main
				id="main-content"
				className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-3 py-4 sm:pt-6"
			>
				<CreateLunchRoom />
				<p className="shrink-0 text-sm text-muted-foreground">
					최대 {lunchRoomLimits.maxParticipants}명 · 방과 기록은 24시간 뒤 삭제
				</p>
			</main>
		</div>
	);
}
