import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { useDrawSound } from "@/hooks/useDrawPresentation";

export default function DrawPresentationControls({
	sound,
}: {
	sound: ReturnType<typeof useDrawSound>;
}) {
	return (
		<div className="draw-presentation-controls">
			<Button
				variant="ghost"
				size="icon"
				type="button"
				aria-label="효과음"
				aria-pressed={sound.enabled}
				title={sound.enabled ? "효과음 끄기" : "효과음 켜기"}
				disabled={!sound.supported}
				onClick={sound.toggle}
			>
				{sound.enabled ? (
					<Volume2 size={18} aria-hidden="true" />
				) : (
					<VolumeX size={18} aria-hidden="true" />
				)}
			</Button>
		</div>
	);
}
