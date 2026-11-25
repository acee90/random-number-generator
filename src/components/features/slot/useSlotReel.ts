import { useEffect, useLayoutEffect, useRef } from "react";
import type { LunchPlace } from "@/lib/lunch";
import { getSpinSlotIndex, type SpinDrive } from "@/lib/spinDrive";
import {
	type SpinAdjustment,
	sampleDisplaySpin,
} from "../game-art/spin-motion";
import type { BallotScene } from "../picnic/ballots";
import { defaultSlotMaxBlurPx, slotMotion, slotStripOffset } from "./motion";
import type { createSlotPainter } from "./paint";

export type SlotMotionOptions = {
	sampleDrive: (
		drive: SpinDrive,
		at: number,
	) => { position: number; speed: number };
	maxBlurPx: number;
};

type SlotState = Pick<BallotScene, "result" | "voteMotionRound"> & {
	phase: "idle" | "fetching" | "spinning" | "done";
	rowCount: number;
	startedAt?: number;
	duration?: number;
	power: number;
	clockOffset: number;
	drive?: SpinDrive;
	driveClockOffset: number;
	driveAdjustment?: SpinAdjustment;
	motionOptions?: SlotMotionOptions;
	candidates: readonly LunchPlace[];
	numbers: readonly number[];
	preview: number;
	reduced: boolean;
};

export function useSlotReel(next: SlotState) {
	const state = useRef(next);
	const sheetExitStartedAt = useRef<number | null>(null);
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
		if (prev.phase === "done" && next.phase !== "done")
			sheetExitStartedAt.current = performance.now();
		else if (next.phase === "done") sheetExitStartedAt.current = null;
		if (prev.rowCount !== next.rowCount) invalidate.current?.("layout");
		else if (
			prev.phase !== next.phase ||
			prev.startedAt !== next.startedAt ||
			prev.duration !== next.duration ||
			prev.power !== next.power ||
			prev.drive !== next.drive ||
			prev.driveClockOffset !== next.driveClockOffset ||
			prev.driveAdjustment !== next.driveAdjustment ||
			prev.motionOptions !== next.motionOptions ||
			prev.candidates !== next.candidates ||
			prev.numbers !== next.numbers ||
			prev.preview !== next.preview ||
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
		const moveStrip = (row: number, rowCount: number) => {
			strip.style.transform = `translateY(${(-row * 100) / rowCount}%)`;
		};
		const schedule = () => {
			if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
		};
		const frame = () => {
			raf = 0;
			const {
				phase,
				rowCount,
				startedAt,
				duration,
				power,
				clockOffset,
				drive,
				driveClockOffset,
				driveAdjustment,
				motionOptions,
				candidates,
				numbers,
				preview,
				reduced,
			} = state.current;
			const landing = rowCount - 3;
			const done = phase === "done";
			const still = reduced || motion.matches;
			const now = Date.now();
			const elapsed =
				startedAt === undefined ? 0 : now + clockOffset - startedAt;
			const driveTime = now + driveClockOffset;
			const live = Boolean(drive && !done);
			const legacySpin =
				!drive &&
				!still &&
				phase === "spinning" &&
				duration !== undefined &&
				landing > 0;
			const legacySample = legacySpin
				? slotMotion(elapsed, duration, landing, power)
				: { travel: 0, speed: 0 };
			const active = drive && !done && !still;
			const sample = active
				? (motionOptions?.sampleDrive(drive, driveTime) ??
					sampleDisplaySpin(drive, driveTime, "slot-v1", driveAdjustment))
				: undefined;
			const position = sample?.position ?? preview;
			const baseRow = Math.floor(position);
			const speed = sample
				? Math.min(1, Math.abs(sample.speed) / (drive?.tuning?.maxSpeed ?? 26))
				: legacySample.speed;
			const blurPx =
				(motionOptions?.maxBlurPx ?? defaultSlotMaxBlurPx) * speed ** 2;
			const changedRows: number[] = [];
			if (live && candidates.length) {
				for (const [slot, row] of Array.from(strip.children).entries()) {
					const raw = baseRow + slot - 1;
					const index = getSpinSlotIndex(
						raw,
						candidates.length,
						active ? drive : undefined,
					);
					const number = row.children[0];
					const name = row.children[1];
					const value = String(numbers[index] ?? index + 1).padStart(2, "0");
					const label = candidates[index].name;
					if (number.textContent === value && name.textContent === label)
						continue;
					number.textContent = value;
					name.textContent = label;
					changedRows.push(slot);
				}
			}
			let reveal =
				done && !still && duration !== undefined
					? Math.min(1, Math.max(0, (elapsed - duration) / 640))
					: 1;
			if (!done && sheetExitStartedAt.current !== null) {
				reveal = still
					? 0
					: 1 -
						Math.min(1, (performance.now() - sheetExitStartedAt.current) / 640);
				if (reveal === 0) sheetExitStartedAt.current = null;
			}
			const row = done
				? landing + Math.sin(reveal * Math.PI * 3) * 0.12 * (1 - reveal)
				: live
					? position - baseRow
					: slotStripOffset(legacySample.travel, power);
			const printedRows = live ? 4 : rowCount;
			const art = painter.current;
			try {
				if (!layoutDirty && canPaint && changedRows.length)
					art?.labels(strip, changedRows);
				if (layoutDirty || roundDirty) {
					moveStrip(done ? landing : 0, printedRows);
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
					art.paint(row, speed, reveal, focused, blurPx);
					canvas.toggleAttribute("data-painted", true);
				}
			} catch (error) {
				if (import.meta.env.DEV) console.warn("Slot rendering failed", error);
				canPaint = false;
				painter.current = null;
				art?.destroy();
			}
			moveStrip(row, printedRows);
			if (!canPaint) {
				canvas.removeAttribute("data-painted");
				drum.style.setProperty("--drum-blur", `${blurPx}px`);
			}
			if (
				(active && (drive.held || driveTime < (drive.stopAt ?? Infinity))) ||
				(legacySpin && elapsed < duration) ||
				(canPaint && (reveal < 1 || sheetExitStartedAt.current !== null)) ||
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
		frame();
		let boardWidth = canvas.clientWidth;
		const sizes =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver((entries) => {
						const width = canvas.clientWidth;
						if (
							width !== boardWidth ||
							entries.some(
								(entry) => entry.target === cabinet || entry.target === drum,
							)
						)
							layout();
						else updateSheet();
						boardWidth = width;
					});
		sizes?.observe(cabinet);
		sizes?.observe(drum);
		sizes?.observe(machine);
		sizes?.observe(canvas);
		const changes = new MutationObserver((records) => {
			if (
				records.some(
					({ target, attributeName }) =>
						attributeName !== "style" &&
						strip.contains(target) &&
						!(state.current.drive && state.current.phase !== "done"),
				)
			)
				layout();
			if (
				records.some(
					({ target, attributeName }) =>
						controls.contains(target) && attributeName !== "style",
				)
			) {
				controlsDirty = true;
				schedule();
			}
		});
		changes.observe(cabinet, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["class", "disabled", "aria-busy", "style"],
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
