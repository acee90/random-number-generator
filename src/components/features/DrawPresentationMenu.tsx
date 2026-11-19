import { Maximize, Minimize, MonitorCog, Volume2, VolumeX } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
	useDrawFullscreen,
	useDrawSound,
} from "@/hooks/useDrawPresentation";

export default function DrawPresentationMenu({
	fullscreen,
	sound,
	triggerRef,
}: {
	fullscreen: ReturnType<typeof useDrawFullscreen>;
	sound: ReturnType<typeof useDrawSound>;
	triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					ref={triggerRef}
					variant="outline"
					size="icon"
					aria-label="추첨 화면 설정"
					title="추첨 화면 설정"
				>
					{fullscreen.active ? (
						<Minimize size={18} aria-hidden="true" />
					) : (
						<MonitorCog size={18} aria-hidden="true" />
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent>
				<DropdownMenuItem onSelect={() => void fullscreen.toggle()}>
					{fullscreen.active ? (
						<Minimize size={16} aria-hidden="true" />
					) : (
						<Maximize size={16} aria-hidden="true" />
					)}
					{fullscreen.label}
				</DropdownMenuItem>
				<DropdownMenuItem disabled={!sound.supported} onSelect={sound.toggle}>
					{sound.enabled ? (
						<VolumeX size={16} aria-hidden="true" />
					) : (
						<Volume2 size={16} aria-hidden="true" />
					)}
					{sound.enabled ? "효과음 끄기" : "효과음 켜기"}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
