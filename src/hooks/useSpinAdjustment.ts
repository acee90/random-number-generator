import { useLayoutEffect, useRef, useState } from "react";
import {
	getSpinAdjustment,
	type SpinAdjustment,
	sampleDisplaySpin,
} from "@/components/features/game-art/spin-motion";
import type { DrawView } from "@/lib/drawView";
import {
	getDefaultTapBoost,
	getRegripSpeed,
	type SpinDrive,
} from "@/lib/spinDrive";

export function useSpinAdjustment(
	id: string | undefined,
	drive: SpinDrive | undefined,
	mode: DrawView,
	clockOffset: number,
	candidateCount: number,
) {
	const [adjustment, setAdjustment] = useState<SpinAdjustment>();
	const previous = useRef<{
		id: string;
		mode: DrawView;
		drive: SpinDrive;
		clockOffset: number;
		adjustment: SpinAdjustment | undefined;
	}>(undefined);

	useLayoutEffect(() => {
		const last = previous.current;
		if (!id || !drive) {
			previous.current = undefined;
			setAdjustment(undefined);
			return;
		}
		let next: SpinAdjustment | undefined;
		if (last?.id === id && last.mode === mode) {
			if (
				last.drive.held === drive.held &&
				last.drive.at === drive.at &&
				last.drive.position === drive.position &&
				last.drive.speed === drive.speed &&
				last.drive.target === drive.target &&
				last.drive.stopAt === drive.stopAt &&
				last.drive.regripSequence === drive.regripSequence &&
				last.drive.tuning?.maxSpeed === drive.tuning?.maxSpeed &&
				last.drive.tuning?.acceleration === drive.tuning?.acceleration &&
				last.drive.slotBrake?.easeOutSeconds ===
					drive.slotBrake?.easeOutSeconds &&
				last.drive.slotBrake?.brakeStrength ===
					drive.slotBrake?.brakeStrength &&
				last.clockOffset === clockOffset
			) {
				next = last.adjustment;
			} else {
				const localNow = Date.now();
				const at = localNow + clockOffset;
				const before = sampleDisplaySpin(
					last.drive,
					localNow + last.clockOffset,
					mode,
					last.adjustment,
				);
				// Reconcile position continuously and show each impulse once even
				// when the server repeats the already-displayed local input.
				if (
					drive.tuning &&
					drive.regripSequence !== undefined &&
					drive.regripSequence > last.drive.sequence
				) {
					before.speed = getRegripSpeed(
						before.speed,
						drive.tuning.maxSpeed,
						getDefaultTapBoost(mode),
					);
				}
				// A turn or a full unmodified reel loop is the same visible pose.
				const period =
					mode === "wheel"
						? 1
						: !drive.slotOffset &&
								!drive.slotSeams?.length &&
								!last.drive.slotOffset &&
								!last.drive.slotSeams?.length
							? candidateCount
							: 0;
				next = getSpinAdjustment(drive, at, mode, before, period);
			}
		}
		previous.current = { id, mode, drive, clockOffset, adjustment: next };
		setAdjustment(next);
	}, [id, drive, mode, clockOffset, candidateCount]);

	return adjustment;
}
