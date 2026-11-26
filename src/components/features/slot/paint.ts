import { Container, Filter, Graphics } from "pixi.js";
import "pixi.js/filters";
import { createBoardRenderer } from "../game-art/renderer";
import { createTextPrinter } from "../game-art/text";
import { type BallotScene, createBallots } from "../picnic/ballots";
import { drawDetails, observeDetails } from "../picnic/details";
import { assemblyPose, assemblyProgress } from "../picnic/resultAssembly";
import { drawCabinet, relativeBox } from "./cabinet";
import { drawControls } from "./controls";

const owned = { children: true, context: true, style: true };
function clear(group: Container) {
	for (const child of group.removeChildren()) child.destroy(owned);
}

function printLabel(
	group: Container,
	el: Element,
	origin: DOMRect,
	maxLines?: number,
) {
	const print = createTextPrinter(origin, 2);
	const style = getComputedStyle(el);
	const limit = maxLines
		? { width: el.getBoundingClientRect().width, lines: maxLines }
		: undefined;
	for (const child of el.childNodes)
		if (child.nodeType === Node.TEXT_NODE) print(group, child, style, limit);
}

function drawMarks(
	marks: Graphics,
	width: number,
	height: number,
	row: number,
	speed: number,
) {
	marks.clear();
	const pitch = height / 12;
	const travel = (row * height) / 3;
	for (let y = -(travel % pitch); y < height; y += pitch) {
		for (const x of [5, width - 8])
			marks
				.roundRect(x, y, 3, 3 + 5 * speed, 1.5)
				.fill({ color: 0xe8be74, alpha: 0.42 });
	}
	if (speed <= 0.02) return;
	for (let i = 0; i < 18; i++) {
		const x = width * ((i * 0.618 + 0.12) % 1);
		const y = (((i * 43 - travel) % height) + height) % height;
		marks
			.moveTo(x, y)
			.lineTo(x, y + speed * 23)
			.stroke({ color: 0xffedc3, width: 1, alpha: speed * 0.24 });
	}
}

export async function createSlotPainter(canvas: HTMLCanvasElement) {
	const renderer = await createBoardRenderer(canvas);
	const stage = new Container();
	const back = stage.addChild(new Container());
	const viewport = stage.addChild(new Container());
	const reel = viewport.addChild(new Container());
	const marks = viewport.addChild(new Graphics());
	const mask = stage.addChild(new Graphics());
	viewport.mask = mask;
	const glass = stage.addChild(new Container());
	const focus = stage.addChild(new Graphics());
	const detent = stage.addChild(new Graphics());
	const controls = stage.addChild(new Container());
	const sheet = stage.addChild(new Container());
	const paper = sheet.addChild(new Container());
	const sheetRoot =
		canvas.parentElement?.querySelector<HTMLElement>(".slot-reveal");
	const ballots = createBallots(
		sheet.addChild(new Container()),
		canvas,
		sheetRoot,
		() => renderer.render({ container: stage }),
	);
	const board = canvas.closest(".slot-stage");
	const overlay = stage.addChild(new Container());
	const overlayRoots =
		board?.querySelectorAll<HTMLElement>(
			":scope > .picnic-options, :scope > .picnic-popup-layer",
		) ?? [];
	function drawOverlay() {
		clear(overlay);
		for (const root of overlayRoots) drawDetails(overlay, root, canvas, 2);
	}
	const disconnectOverlay = Array.from(overlayRoots, (root) =>
		observeDetails(root, () => {
			drawOverlay();
			renderer.render({ container: stage });
		}),
	);
	let blurPx = 0;
	const blur = Object.assign(new Filter({ resources: {} }), {
		getCanvasFilterString: () => `blur(${blurPx}px)`,
	});
	reel.filters = [blur];
	let releaseGradients: (() => void) | undefined;
	let buttons: ReturnType<typeof drawControls> | undefined;
	let width = 0,
		height = 0;
	let lastRow = NaN,
		lastSpeed = NaN;
	let paperCenter = { x: 0, y: 0 };
	let revealProgress = 1;
	let lastBallotScene: Pick<BallotScene, "result" | "voteMotionRound"> | null =
		null;
	function drawLabel(group: Container, row: Element) {
		const box = row.getBoundingClientRect();
		const number = row.querySelector(".slot-number");
		if (number) printLabel(group, number, box);
		const name = row.querySelector(".slot-name");
		if (name) printLabel(group, name, box, 2);
	}

	return {
		layout(cabinet: HTMLElement, drum: HTMLElement, strip: HTMLElement) {
			const origin = canvas.getBoundingClientRect();
			const box = relativeBox(drum, origin);
			width = box.width;
			height = box.height;
			if (!width || !height) return false;
			clear(back);
			clear(glass);
			clear(reel);
			releaseGradients?.();
			const cabinetOrigin = cabinet.getBoundingClientRect();
			back.position.set(
				cabinetOrigin.left - origin.left,
				cabinetOrigin.top - origin.top,
			);
			glass.position.copyFrom(back.position);
			releaseGradients = drawCabinet(
				back,
				glass,
				cabinet,
				cabinetOrigin,
				relativeBox(drum, cabinetOrigin),
			);
			const plaque = cabinet.querySelector(".slot-plaque-label");
			if (plaque) printLabel(back, plaque, cabinetOrigin, 1);
			drawOverlay();
			viewport.position.set(box.x, box.y);
			mask.clear().roundRect(box.x, box.y, width, height, 6).fill(0xffffff);
			const rowHeight = height / 3;
			lastRow = NaN;
			for (const [i, el] of Array.from(strip.children).entries()) {
				const group = reel.addChild(new Container());
				group.y = i * rowHeight;
				group
					.addChild(new Graphics())
					.rect(0, rowHeight - 1, width, 1)
					.fill({ color: 0xffe3a3, alpha: 0.26 });
				drawLabel(group.addChild(new Container()), el);
			}
			focus
				.clear()
				.rect(box.x + 3, box.y + rowHeight + 3, width - 6, rowHeight - 6)
				.stroke({
					color: getComputedStyle(cabinet)
						.getPropertyValue("--slot-highlight")
						.trim(),
					width: 2,
				});
			return true;
		},
		labels(strip: HTMLElement, changedRows: readonly number[]) {
			for (const index of changedRows) {
				const label = (reel.children[index] as Container).getChildAt(1);
				clear(label);
				drawLabel(label, strip.children[index]);
			}
		},
		controls(root: HTMLElement) {
			clear(controls);
			buttons = drawControls(controls, root, canvas.getBoundingClientRect());
		},
		restyleControls() {
			buttons?.restyle();
		},
		sheet({
			result,
			voteMotionRound,
		}: Pick<BallotScene, "result" | "voteMotionRound">) {
			// A long ballot can extend the canvas down without rebuilding the reel.
			const canvasBounds = canvas.getBoundingClientRect();
			const resized =
				renderer.screen.width !== canvasBounds.width ||
				renderer.screen.height !== canvasBounds.height ||
				renderer.resolution !== 2;
			if (resized) renderer.resize(canvasBounds.width, canvasBounds.height, 2);
			if (result) {
				clear(paper);
				if (sheetRoot)
					drawDetails(paper, sheetRoot, canvas, renderer.resolution);
				const rect = sheetRoot
					?.querySelector<HTMLElement>(".picnic-sheet")
					?.getBoundingClientRect();
				paperCenter = rect
					? {
							x: rect.left - canvasBounds.left + rect.width / 2,
							y: rect.top - canvasBounds.top + rect.height / 2,
						}
					: { x: 0, y: 0 };
				lastBallotScene = { result, voteMotionRound };
			} else if (revealProgress === 0) {
				clear(paper);
				lastBallotScene = null;
			}
			const hit = (selector: string) =>
				sheetRoot?.querySelector<HTMLElement>(selector)?.dataset.hit as
					| "up"
					| "down"
					| undefined;
			if (result || revealProgress === 0 || resized)
				ballots.paint(
					{
						result: lastBallotScene?.result ?? null,
						voteMotionRound: lastBallotScene?.voteMotionRound,
						hover: window.matchMedia("(hover: hover)").matches
							? (hit("[data-hit]:hover") ?? null)
							: null,
						pressed: hit("[data-hit]:has(:active)") ?? null,
					},
					resized,
				);
			ballots.setArrival(
				assemblyProgress(revealProgress, 310, 545),
				assemblyProgress(revealProgress, 395, 640),
			);
		},
		paint(
			row: number,
			speed: number,
			reveal: number,
			focused: boolean,
			rowBlurPx: number,
			pulse: number,
		) {
			if (!width || !height) return;
			revealProgress = reveal;
			if (reveal === 0 && lastBallotScene) {
				clear(paper);
				ballots.paint(
					{
						result: null,
						voteMotionRound: undefined,
						hover: null,
						pressed: null,
					},
					true,
				);
				lastBallotScene = null;
			}
			blurPx = rowBlurPx * renderer.resolution;
			blur.enabled = blurPx > 0.05;
			if (row !== lastRow || speed !== lastSpeed) {
				reel.y = (-row * height) / 3;
				const first = Math.floor(row);
				for (const [i, group] of reel.children.entries())
					group.visible = i >= first && i <= first + 3;
				drawMarks(marks, width, height, row, speed);
				lastRow = row;
				lastSpeed = speed;
			}
			const ticketProgress = assemblyProgress(reveal, 0, 320);
			const { lift, impact, alpha } = assemblyPose(ticketProgress);
			const sheetProgress = assemblyProgress(reveal, 150, 410);
			paper.pivot.set(paperCenter.x, paperCenter.y);
			paper.position.set(
				paperCenter.x - 64 * lift,
				paperCenter.y - 42 * lift + 9 * impact + 38 * (1 - sheetProgress) ** 3,
			);
			paper.rotation = -0.16 * lift + 0.045 * impact;
			paper.alpha = alpha;
			ballots.setArrival(
				assemblyProgress(reveal, 310, 545),
				assemblyProgress(reveal, 395, 640),
			);
			sheet.alpha = 1;
			detent.clear();
			if (pulse > 0.01)
				detent
					.roundRect(
						viewport.x + 3,
						viewport.y + height / 3 + 3,
						width - 6,
						height / 3 - 6,
						5,
					)
					.stroke({
						color: 0xffe18b,
						width: 2 + pulse * 2,
						alpha: pulse * 0.9,
					});
			focus.visible = focused;
			renderer.render({ container: stage });
		},
		destroy() {
			for (const disconnect of disconnectOverlay) disconnect();
			ballots.destroy();
			stage.destroy(owned);
			blur.destroy();
			releaseGradients?.();
			renderer.destroy();
		},
	};
}
