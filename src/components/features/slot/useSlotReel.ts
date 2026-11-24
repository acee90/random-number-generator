import { useEffect, useLayoutEffect, useRef } from "react";
import type { BallotScene } from "../picnic/ballots";
import { slotMotion, slotStripOffset } from "./motion";
import type { createSlotPainter } from "./paint";

type SlotState = Pick<BallotScene, "result" | "voteMotionRound"> & {
	phase: "idle" | "fetching" | "spinning" | "done";
	rowCount: number;
	startedAt?: number;
	duration?: number;
	clockOffset: number;
	reduced: boolean;
};

export function useSlotReel(next: SlotState) {
	const state = useRef(next);
	const invalidate = useRef<
		((part: "layout" | "round" | "sheet") => void) | null
	>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const cabinetRef = useRef<HTMLDivElement>(null);
	const painter = useRef<Awaited<ReturnType<typeof createSlotPainter>> | null>(
		null,
	);
	useLayoutEffect(() => {
		const prev = state.current;
		state.current = next;
		if (prev.rowCount !== next.rowCount) invalidate.current?.("layout");
		else if (
			prev.phase !== next.phase ||
			prev.startedAt !== next.startedAt ||
			prev.duration !== next.duration ||
			prev.clockOffset !== next.clockOffset ||
			prev.reduced !== next.reduced
		)
			invalidate.current?.("round");
		else if (
			prev.result !== next.result ||
			prev.voteMotionRound !== next.voteMotionRound
		)
			invalidate.current?.("sheet");
	}, [next]);

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
			invalidate.current?.("layout");
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
				invalidate.current?.("layout");
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
		const machine = canvas?.parentElement;
		const sheet = machine?.querySelector<HTMLElement>(".slot-reveal");
		if (
			!canvas ||
			!cabinet ||
			!drum ||
			!strip ||
			!controls ||
			!machine ||
			!sheet
		)
			return;
		const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
		let raf = 0,
			layoutDirty = true,
			roundDirty = true,
			controlsDirty = true,
			sheetDirty = true,
			canPaint = false;
		let appearanceDirty = true,
			transitioning = false,
			focused = false;
		const moveStrip = (row: number) => {
			strip.style.transform = `translateY(${(-row * 100) / state.current.rowCount}%)`;
		};
		const schedule = () => {
			if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
		};
		const frame = (now: number) => {
			raf = 0;
			const { phase, rowCount, startedAt, duration, clockOffset, reduced } =
				state.current;
			const landing = rowCount - 3;
			const done = phase === "done";
			const still = reduced || motion.matches;
			const elapsed =
				startedAt === undefined ? 0 : Date.now() + clockOffset - startedAt;
			const spinning =
				!still && phase === "spinning" && duration !== undefined && landing > 0;
			const { travel, speed } = spinning
				? slotMotion(elapsed, duration, landing)
				: { travel: 0, speed: 0 };
			const row = done ? landing : slotStripOffset(travel);
			const reveal =
				done && !still && duration !== undefined
					? Math.min(1, Math.max(0, (elapsed - duration) / 260))
					: 1;
			const art = painter.current;
			try {
				if (layoutDirty || roundDirty) {
					moveStrip(done ? landing : 0);
					const name = drum.querySelector<HTMLElement>("h3");
					machine.toggleAttribute(
						"data-clipped-winner",
						Boolean(done && name && name.scrollHeight > name.clientHeight + 1),
					);
					// A reveal changes the controls and sheet. Keep the final printed strip
					// and its Pixi containers when the reel geometry did not change.
					if (layoutDirty)
						canPaint = art?.layout(cabinet, drum, strip) ?? false;
					roundDirty = false;
					layoutDirty = false;
					controlsDirty = true;
					sheetDirty = true;
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
					if (sheetDirty) art.sheet(state.current);
					sheetDirty = false;
					if (controlsDirty || appearanceDirty)
						focused = drum.matches(":has(h3:focus-visible)");
					controlsDirty = false;
					appearanceDirty = false;
					art.paint(
						row,
						speed,
						reveal,
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
				(canPaint && reveal < 1) ||
				loadingIcon ||
				(canPaint && transitioning)
			)
				schedule();
		};
		function layout() {
			layoutDirty = true;
			schedule();
		}
		function updateSheet() {
			sheetDirty = true;
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
		invalidate.current = (part) => {
			if (part === "layout") layoutDirty = true;
			if (part === "round") roundDirty = true;
			sheetDirty = true;
			schedule();
		};
		frame(performance.now());
		const sizes =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver((entries) => {
						if (entries.some((entry) => entry.target !== machine)) layout();
						else updateSheet();
					});
		sizes?.observe(cabinet);
		sizes?.observe(drum);
		sizes?.observe(machine);
		const changes = new MutationObserver((records) => {
			if (records.some(({ target }) => strip.contains(target))) layout();
			if (records.some(({ target }) => controls.contains(target))) {
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
		const sheetChanges = new MutationObserver(updateSheet);
		sheetChanges.observe(sheet, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
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
		for (const event of events) {
			cabinet.addEventListener(event, interactions);
			sheet.addEventListener(event, updateSheet);
		}
		sheet.addEventListener("scroll", updateSheet, true);
		window.addEventListener("resize", layout);
		document.fonts?.addEventListener("loadingdone", layout);
		motion.addEventListener("change", layout);
		document.addEventListener("visibilitychange", visibility);
		return () => {
			invalidate.current = null;
			cancelAnimationFrame(raf);
			sizes?.disconnect();
			changes.disconnect();
			sheetChanges.disconnect();
			for (const event of events) {
				cabinet.removeEventListener(event, interactions);
				sheet.removeEventListener(event, updateSheet);
			}
			sheet.removeEventListener("scroll", updateSheet, true);
			window.removeEventListener("resize", layout);
			document.fonts?.removeEventListener("loadingdone", layout);
			motion.removeEventListener("change", layout);
			document.removeEventListener("visibilitychange", visibility);
		};
	}, []);
	return { canvasRef, cabinetRef };
}
