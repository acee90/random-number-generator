import { LoaderCircle } from "lucide-react";
import {
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { StageScene } from "./layout";
import type { createPicnicPainter } from "./paint";
import "./picnic-art.css";
import "./details.css";

type Painter = Awaited<ReturnType<typeof createPicnicPainter>>;
export function PicnicArt({
	scene,
	width,
	height,
	rotorRef,
	animate = false,
}: {
	scene: StageScene;
	width: number;
	height: number;
	rotorRef?: RefObject<HTMLDivElement | null>;
	animate?: boolean;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const painter = useRef<Painter | null>(null);
	const [ready, setReady] = useState(false);
	const [status, setStatus] = useState<"loading" | "painted" | "fallback">(
		"loading",
	);
	const painted = status === "painted";

	useEffect(() => {
		const canvas = canvasRef.current;
		if (import.meta.env.SSR || !canvas || !window.CanvasRenderingContext2D) {
			setStatus("fallback");
			return;
		}
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
				if (active) setStatus("fallback");
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
			painter.current.paint(scene, width, height);
			setStatus("painted");
		} catch {
			setStatus("fallback");
		}
	}, [ready, scene, width, height]);
	useEffect(() => {
		const rotor = rotorRef?.current;
		if (!animate || !painted || !rotor) return;
		let frame = 0;
		// Sample the same server-aligned Web Animation as the fallback wheel.
		function tick() {
			if (!rotor || !painter.current) return;
			try {
				const matrix = new DOMMatrixReadOnly(getComputedStyle(rotor).transform);
				painter.current.rotate(Math.atan2(matrix.b, matrix.a));
				frame = requestAnimationFrame(tick);
			} catch {
				setStatus("fallback");
			}
		}
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	}, [animate, painted, rotorRef]);
	return (
		<>
			<canvas
				className="picnic-art"
				ref={canvasRef}
				data-scene={scene.result ? "result" : scene.wheel.phase}
				data-painted={painted || undefined}
				inert
			/>
			{status === "loading" && (
				<output className="picnic-loading">
					<LoaderCircle
						size={20}
						className="motion-safe:animate-spin"
						aria-hidden="true"
					/>
					추첨판을 불러오는 중…
				</output>
			)}
		</>
	);
}
