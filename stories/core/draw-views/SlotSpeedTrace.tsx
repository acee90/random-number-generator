import { useEffect, useState } from "react";
import {
	sampleTunedSlotDrive,
	slotTuningLimits,
	type TunedSlotDrive,
} from "./slotTuningMotion";

const historyMs = 10000;
const ceiling = slotTuningLimits.maxSpeed.max;
type Point = { time: number; speed: number };

export function SlotSpeedTrace({
	drive,
	finished,
}: {
	drive?: TunedSlotDrive;
	finished: boolean;
}) {
	const [points, setPoints] = useState<Point[]>([]);
	useEffect(() => {
		if (!drive) return;
		const record = () => {
			const time = Math.min(Date.now(), drive.stopAt ?? Infinity);
			const speed = Math.abs(sampleTunedSlotDrive(drive, time).speed);
			setPoints((previous) => [
				...previous.filter(
					(point) => point.time >= time - historyMs && point.time < time,
				),
				{ time, speed },
			]);
		};
		record();
		if (finished) return;
		const timer = window.setInterval(record, 80);
		return () => clearInterval(timer);
	}, [drive, finished]);
	const last = points.at(-1);
	const speed = last?.speed ?? 0;
	const line = points
		.map(
			({ time, speed }) =>
				`${(1 - ((last?.time ?? time) - time) / historyMs) * 400},${62 - (Math.min(ceiling, speed) / ceiling) * 60}`,
		)
		.join(" ");
	return (
		<figure className="slot-lab-trace">
			<figcaption>
				<span>현재 속도</span>
				<span>
					<output aria-label="현재 속도" aria-live="off">
						{speed > 0 && speed < 0.05 ? "< 0.1" : speed.toFixed(1)}
					</output>{" "}
					칸/초
				</span>
			</figcaption>
			<svg viewBox="0 0 400 64" preserveAspectRatio="none" aria-hidden="true">
				<path className="slot-lab-gridline" d="M0 2H400 M0 32H400 M0 62H400" />
				<polyline
					points={line}
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			<div className="slot-lab-axis">
				<span>10초 전</span>
				<span>현재</span>
			</div>
		</figure>
	);
}
