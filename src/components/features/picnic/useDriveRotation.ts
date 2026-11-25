import { useLayoutEffect } from "react";
import type { SpinDrive } from "@/lib/spinDrive";
import {
	type SpinAdjustment,
	sampleDisplaySpin,
} from "../game-art/spin-motion";

export function useDriveRotation(
	drive: SpinDrive | undefined,
	clockOffset: number,
	motionOff: boolean,
	rotate: (turns: number) => void,
	adjustment?: SpinAdjustment,
) {
	useLayoutEffect(() => {
		if (!drive) return;
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		let frame = 0;
		function tick() {
			cancelAnimationFrame(frame);
			if (!drive || document.hidden) return;
			if (motionOff || media.matches) {
				rotate(0);
				return;
			}
			const at = Date.now() + clockOffset;
			rotate(sampleDisplaySpin(drive, at, "wheel", adjustment).position);
			if (drive.held || at < (drive.stopAt ?? Infinity))
				frame = requestAnimationFrame(tick);
		}
		// The board can reconcile the new drive in a parent layout effect.
		// Paint the resulting pair once on the next frame.
		frame = requestAnimationFrame(tick);
		document.addEventListener("visibilitychange", tick);
		media.addEventListener("change", tick);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("visibilitychange", tick);
			media.removeEventListener("change", tick);
		};
	}, [drive, clockOffset, motionOff, rotate, adjustment]);
}
