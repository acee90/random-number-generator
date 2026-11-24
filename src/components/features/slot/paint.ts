import { Container, Filter, Graphics } from "pixi.js";
import "pixi.js/filters";
import { createBoardRenderer } from "../game-art/renderer";
import { createTextPrinter } from "../game-art/text";
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
	const catchLight = stage.addChild(new Graphics());
	const focus = stage.addChild(new Graphics());
	const controls = stage.addChild(new Container());
	let blurPx = 0;
	const blur = Object.assign(new Filter({ resources: {} }), {
		getCanvasFilterString: () => `blur(${blurPx}px)`,
	});
	reel.filters = [blur];
	let releaseGradients: (() => void) | undefined;
	let buttons: ReturnType<typeof drawControls> | undefined;
	let width = 0,
		height = 0,
		winnerRow = -1;

	return {
		layout(cabinet: HTMLElement, drum: HTMLElement, strip: HTMLElement) {
			const origin = canvas.getBoundingClientRect();
			const box = relativeBox(drum, origin);
			width = box.width;
			height = box.height;
			if (!width || !height) return false;
			// Supersample this small (at most 500px wide) cabinet so fractional
			// row positions and small lettering stay crisp on a 1× screen too.
			if (
				renderer.screen.width !== origin.width ||
				renderer.screen.height !== origin.height ||
				renderer.resolution !== 2
			)
				renderer.resize(origin.width, origin.height, 2);
			clear(back);
			clear(glass);
			clear(reel);
			releaseGradients?.();
			const expanded = drum.hasAttribute("data-full-name");
			releaseGradients = drawCabinet(
				back,
				glass,
				cabinet,
				origin,
				box,
				expanded,
			);
			const plaque = cabinet.querySelector(".slot-plaque-label");
			if (plaque) printLabel(back, plaque, origin, 1);
			viewport.position.set(box.x, box.y);
			mask.clear().roundRect(box.x, box.y, width, height, 6).fill(0xffffff);
			const rowHeight = height / 3;
			// Build the bounded strip once. Spinning only translates Pixi containers.
			winnerRow = -1;
			for (const [i, el] of Array.from(strip.children).entries()) {
				const group = reel.addChild(new Container());
				group.y = i * rowHeight;
				const heading = el.querySelector("h3");
				if (expanded && !heading) continue;
				const rowBox = el.getBoundingClientRect();
				if (!expanded)
					group
						.addChild(new Graphics())
						.rect(0, rowHeight - 1, width, 1)
						.fill({ color: 0xffe3a3, alpha: 0.26 });
				const number = el.querySelector(".slot-number");
				if (number) printLabel(group, number, rowBox);
				const name = el.querySelector<HTMLElement>(
					".slot-name:not(.slot-name-measure)",
				);
				if (name && expanded && name.scrollHeight > name.clientHeight) {
					const b = relativeBox(name, rowBox);
					const letters = group.addChild(new Container());
					letters.mask = group
						.addChild(new Graphics())
						.rect(b.x, b.y, b.width, b.height)
						.fill(0xffffff);
					printLabel(letters, name, rowBox);
				} else if (name) {
					printLabel(group, name, rowBox, expanded ? undefined : 2);
				}
				if (expanded) winnerRow = i;
			}
			marks.visible = !expanded;
			const y = expanded ? box.y : box.y + rowHeight;
			const bandHeight = expanded ? height : rowHeight;
			focus
				.clear()
				.rect(box.x + 3, y + 3, width - 6, bandHeight - 6)
				.stroke({
					color: getComputedStyle(cabinet)
						.getPropertyValue("--slot-highlight")
						.trim(),
					width: 2,
				});
			catchLight.clear();
			for (let i = 0; i < 12; i++) {
				catchLight
					.rect(
						box.x + i + 0.5,
						y + i + 0.5,
						width - 2 * i - 1,
						bandHeight - 2 * i - 1,
					)
					.stroke({
						color: 0xffdc91,
						width: 1,
						alpha: 0.36 * (1 - i / 12) ** 2,
					});
			}
			return true;
		},
		controls(root: HTMLElement) {
			clear(controls);
			buttons = drawControls(controls, root, canvas.getBoundingClientRect());
		},
		restyleControls() {
			buttons?.restyle();
		},
		get hasSpinner() {
			return Boolean(buttons?.spinner);
		},
		paint(
			row: number,
			speed: number,
			glow: number,
			focused: boolean,
			spinnerAngle: number,
		) {
			if (!width || !height) return;
			reel.y = (-row * height) / 3;
			const first = Math.floor(row);
			for (const [i, group] of reel.children.entries())
				group.visible =
					winnerRow >= 0 ? i === winnerRow : i >= first && i <= first + 3;
			blurPx = 1.6 * speed ** 2 * renderer.resolution;
			blur.enabled = blurPx > 0.05;
			if (marks.visible) drawMarks(marks, width, height, row, speed);
			catchLight.alpha = glow;
			focus.visible = focused;
			if (buttons?.spinner) buttons.spinner.rotation = spinnerAngle;
			renderer.render({ container: stage });
		},
		destroy() {
			stage.destroy(owned);
			blur.destroy();
			releaseGradients?.();
			renderer.destroy();
		},
	};
}
