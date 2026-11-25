import {
	type RefObject,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { SpinDrive } from "@/lib/spinDrive";
import type { SpinAdjustment } from "../game-art/spin-motion";
import type { StageScene } from "./layout";
import type { createPicnicPainter } from "./paint";
import { useDriveRotation } from "./useDriveRotation";
import "./picnic-art.css";
import "./details.css";

type Painter = Awaited<ReturnType<typeof createPicnicPainter>>;
export function PicnicArt({
	scene,
	width,
	height,
	rotorRef,
	motionOff = false,
	drive,
	driveClockOffset = 0,
	driveAdjustment,
}: {
	scene: StageScene;
	width: number;
	height: number;
	rotorRef?: RefObject<HTMLDivElement | null>;
	motionOff?: boolean;
	drive?: SpinDrive;
	driveClockOffset?: number;
	driveAdjustment?: SpinAdjustment;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const painter = useRef<Painter | null>(null);
	const [ready, setReady] = useState(false);
	const [painted, setPainted] = useState(false);
	const phase = scene.wheel.phase;
	const hasResult = Boolean(scene.result);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (import.meta.env.SSR || !canvas || !window.CanvasRenderingContext2D)
			return;
		let active = true;
		void import("./paint")
			.then(async ({ createPicnicPainter }) => {
				if (!active) return;
				const instance = await createPicnicPainter(canvas);
				if (!active) instance.destroy();
				else {
					painter.current = instance;
					setReady(true);
				}
			})
			.catch(() => {
				if (active) setPainted(false);
			});
		return () => {
			active = false;
			painter.current?.destroy();
			painter.current = null;
		};
	}, []);
	useLayoutEffect(() => {
		if (!ready || !painter.current || !width || !height) return;
		try {
			painter.current.paint(scene, width, height, motionOff);
			setPainted(true);
		} catch {
			setPainted(false);
		}
	}, [ready, scene, width, height, motionOff]);
	const rotate = useCallback((position: number) => {
		try {
			painter.current?.rotate(position * 2 * Math.PI);
		} catch {
			setPainted(false);
		}
	}, []);
	useDriveRotation(
		painted && !hasResult ? drive : undefined,
		driveClockOffset,
		motionOff,
		rotate,
		driveAdjustment,
	);
	useEffect(() => {
		const rotor = rotorRef?.current;
		if (
			!painted ||
			!rotor ||
			hasResult ||
			motionOff ||
			drive ||
			phase !== "spinning"
		)
			return;
		let frame = 0;
		// Older rounds use the rotor's server-aligned Web Animation.
		function tick() {
			if (!rotor || !painter.current) return;
			try {
				const matrix = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
				painter.current.rotate(Math.atan2(matrix.b, matrix.a));
				frame = requestAnimationFrame(tick);
			} catch {
				setPainted(false);
			}
		}
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [phase, painted, rotorRef, hasResult, motionOff, drive]);
	return (
		<canvas
			className="picnic-art"
			ref={canvasRef}
			data-scene={scene.result ? "result" : scene.wheel.phase}
			data-painted={painted || undefined}
			inert
		/>
	);
}
