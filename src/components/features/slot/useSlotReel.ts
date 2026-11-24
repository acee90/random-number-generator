import { useEffect, useLayoutEffect, useRef } from "react";
import { slotMotion, slotStripOffset } from "./motion";
import type { createSlotPainter } from "./paint";

type Timing = {
	phase: "idle" | "fetching" | "spinning" | "done";
	rowCount: number;
	startedAt?: number;
	duration?: number;
	clockOffset: number;
	reduced: boolean;
};

export function useSlotReel({
	phase,
	rowCount,
	startedAt,
	duration,
	clockOffset,
	reduced,
}: Timing) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const cabinetRef = useRef<HTMLDivElement>(null);
	const painter = useRef<Awaited<ReturnType<typeof createSlotPainter>> | null>(
		null,
	);
	const refresh = useRef<(() => void) | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !window.CanvasRenderingContext2D) return;
		const contrast = window.matchMedia("(forced-colors: active)");
		let generation = 0;
		function release() {
			generation++;
			canvas?.removeAttribute("data-painted");
			painter.current?.destroy();
			painter.current = null;
		}
		async function connect() {
			release();
			refresh.current?.();
			if (!canvas || contrast.matches) return;
			const current = generation;
			try {
				const { createSlotPainter } = await import("./paint");
				if (current !== generation) return;
				const instance = await createSlotPainter(canvas);
				if (current !== generation) {
					instance.destroy();
					return;
				}
				painter.current = instance;
				refresh.current?.();
			} catch (error) {
				// The native cabinet is visible until a complete Pixi frame has been drawn.
				if (import.meta.env.DEV)
					console.warn("Slot renderer initialization failed", error);
			}
		}
		void connect();
		contrast.addEventListener("change", connect);
		return () => {
			contrast.removeEventListener("change", connect);
			release();
		};
	}, []);

	useLayoutEffect(() => {
		const canvas = canvasRef.current;
		const cabinet = cabinetRef.current;
		const drum = cabinet?.querySelector<HTMLElement>(".slot-drum");
		const strip = drum?.querySelector<HTMLElement>(".slot-strip");
		const controls = cabinet?.querySelector<HTMLElement>(".slot-controls");
		if (!canvas || !cabinet || !drum || !strip || !controls) return;
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		const landing = rowCount - 3;
		const done = phase === "done";
		let raf = 0,
			layoutDirty = true,
			controlsDirty = true,
			canPaint = false;
		let appearanceDirty = true,
			transitioning = false,
			focused = false;
		const moveStrip = (row: number) => {
			strip.style.transform = `translateY(${(-row * 100) / rowCount}%)`;
		};
		const schedule = () => {
			if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
		};
		const frame = (now: number) => {
			raf = 0;
			const still = reduced || motion.matches;
			const elapsed =
				startedAt === undefined ? 0 : Date.now() + clockOffset - startedAt;
			const spinning =
				!still && phase === "spinning" && duration !== undefined && landing > 0;
			const { travel, speed } = spinning
				? slotMotion(elapsed, duration, landing)
				: { travel: 0, speed: 0 };
			const row = done ? landing : slotStripOffset(travel);
			const glow =
				done && !still && duration !== undefined
					? Math.max(0, 1 - Math.max(0, elapsed - duration) / 420) ** 2
					: 0;
			const art = painter.current;
			try {
				if (layoutDirty) {
					moveStrip(done ? landing : 0);
					const name = drum.querySelector<HTMLElement>(".slot-name-measure");
					drum.toggleAttribute(
						"data-full-name",
						Boolean(done && name && name.scrollHeight > name.clientHeight + 1),
					);
					canPaint = art?.layout(cabinet, drum, strip) ?? false;
					layoutDirty = false;
					controlsDirty = true;
				}
				if (art && canPaint) {
					if (transitioning)
						transitioning = controls
							.getAnimations({ subtree: true })
							.some(
								(animation) =>
									"transitionProperty" in animation &&
									animation.playState === "running",
							);
					if (controlsDirty) art.controls(controls);
					else if (appearanceDirty || transitioning) art.restyleControls();
					if (controlsDirty || appearanceDirty)
						focused = drum.matches(":has(h3:focus-visible)");
					controlsDirty = false;
					appearanceDirty = false;
					art.paint(
						row,
						speed,
						glow,
						focused,
						still ? 0 : ((now % 1000) * Math.PI) / 500,
					);
					canvas.toggleAttribute("data-painted", true);
				}
			} catch (error) {
				if (import.meta.env.DEV) console.warn("Slot rendering failed", error);
				canPaint = false;
				painter.current = null;
				art?.destroy();
			}
			if (!canPaint) {
				canvas.removeAttribute("data-painted");
				moveStrip(row);
				drum.style.setProperty("--drum-blur", `${1.6 * speed ** 2}px`);
			}
			const loadingIcon =
				canPaint &&
				!still &&
				(phase === "fetching" || phase === "spinning") &&
				art?.hasSpinner;
			if (
				(spinning && elapsed < duration) ||
				glow > 0 ||
				loadingIcon ||
				(canPaint && transitioning)
			)
				schedule();
		};
		function layout() {
			layoutDirty = true;
			schedule();
		}
		function interactions(event: Event) {
			if (event.type === "transitionrun") transitioning = true;
			appearanceDirty = true;
			schedule();
		}
		function visibility() {
			cancelAnimationFrame(raf);
			raf = 0;
			if (!document.hidden) layout();
		}
		refresh.current = layout;
		frame(performance.now());
		const sizes =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
		sizes?.observe(cabinet);
		sizes?.observe(drum);
		const changes = new MutationObserver((records) => {
			if (records.some(({ target }) => !controls.contains(target))) layout();
			else {
				controlsDirty = true;
				schedule();
			}
		});
		changes.observe(cabinet, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["class", "disabled", "aria-busy"],
		});
		const events = [
			"focusin",
			"focusout",
			"pointerover",
			"pointerout",
			"pointerdown",
			"pointerup",
			"pointercancel",
			"keydown",
			"keyup",
			"transitionrun",
			"transitionend",
			"transitioncancel",
		];
		for (const event of events) cabinet.addEventListener(event, interactions);
		drum.addEventListener("scroll", layout, true);
		window.addEventListener("resize", layout);
		document.fonts?.addEventListener("loadingdone", layout);
		motion.addEventListener("change", layout);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			refresh.current = null;
			cancelAnimationFrame(raf);
			sizes?.disconnect();
			changes.disconnect();
			for (const event of events)
				cabinet.removeEventListener(event, interactions);
			drum.removeEventListener("scroll", layout, true);
			window.removeEventListener("resize", layout);
			document.fonts?.removeEventListener("loadingdone", layout);
			motion.removeEventListener("change", layout);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, [clockOffset, duration, phase, reduced, rowCount, startedAt]);
	return { canvasRef, cabinetRef };
}
