import { Color, type Container, FillGradient, Graphics } from "pixi.js";

type Box = { x: number; y: number; width: number; height: number };
type Stops = [number, string][];

export function relativeBox(element: Element, origin: DOMRect): Box {
	const { left, top, width, height } = element.getBoundingClientRect();
	return { x: left - origin.left, y: top - origin.top, width, height };
}

function mix(base: string, overlay: string, amount: number) {
	const a = new Color(base).toUint8RgbArray();
	const b = new Color(overlay).toUint8RgbArray();
	return `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * amount)).join(",")})`;
}

/** The same light angles and color stops as the CSS cabinet used in high contrast / fallback. */
export function drawCabinet(
	back: Container,
	glass: Container,
	cabinet: HTMLElement,
	origin: DOMRect,
	drum: Box,
	expanded: boolean,
) {
	const style = getComputedStyle(cabinet);
	const token = (name: string) => style.getPropertyValue(name).trim();
	const shell = token("--slot-shell");
	const dark = token("--slot-shell-dark");
	const brass = token("--slot-brass");
	const highlight = token("--slot-highlight");
	const barrel = token("--slot-barrel");
	const muted = token("--paper-muted");
	const gradients: FillGradient[] = [];
	function gradient(box: Box, angle: number, stops: Stops) {
		const radians = (angle * Math.PI) / 180;
		const dx = Math.sin(radians),
			dy = -Math.cos(radians);
		const length = Math.abs(box.width * dx) + Math.abs(box.height * dy);
		const cx = box.x + box.width / 2,
			cy = box.y + box.height / 2;
		const fill = new FillGradient({
			textureSpace: "global",
			start: { x: cx - (dx * length) / 2, y: cy - (dy * length) / 2 },
			end: { x: cx + (dx * length) / 2, y: cy + (dy * length) / 2 },
			colorStops: stops.map(([offset, color]) => ({ offset, color })),
		});
		gradients.push(fill);
		return fill;
	}
	const bounds = relativeBox(cabinet, origin);
	const { width: w, height: h } = bounds;
	const shellInk = back.addChild(new Graphics());
	shellInk
		.roundRect(0, 3, w, h, 17)
		.fill(muted)
		.roundRect(0, 0, w, h, 17)
		.fill(dark)
		.roundRect(2, 2, w - 4, h - 4, 15)
		.fill(mix(shell, brass, 0.37))
		.roundRect(4, 4, w - 8, h - 8, 13)
		.fill(
			gradient(bounds, 145, [
				[0, mix(shell, brass, 0.18)],
				[0.45, shell],
				[1, dark],
			]),
		);
	for (const x of [11, w - 11]) {
		for (const y of [11, h - 11]) {
			shellInk.circle(x, y, 3.5).fill(dark).circle(x, y, 2.2).fill(brass);
			if (y === 11) shellInk.circle(x, y, 1).fill(highlight);
		}
	}
	for (const rule of cabinet.querySelectorAll(".slot-rule")) {
		const b = relativeBox(rule, origin);
		shellInk.rect(b.x, b.y, b.width, b.height).fill(brass);
	}
	const { x, y, width, height } = drum;
	const bw = width + 12,
		bh = height + 12;
	shellInk
		.roundRect(x - 6, y - 6, bw, bh, 10)
		.fill(dark)
		.roundRect(x - 5, y - 5, bw - 2, bh - 2, 9)
		.fill(
			gradient({ x: x - 6, y: y - 6, width: bw, height: bh }, 155, [
				[0, highlight],
				[0.28, brass],
				[0.51, muted],
				[0.84, brass],
				[1, highlight],
			]),
		);
	const edge = mix(barrel, "#000000", 0.25);
	shellInk.roundRect(x, y, width, height, 6).fill(
		gradient(drum, 90, [
			[0, edge],
			[0.18, barrel],
			[0.82, barrel],
			[1, edge],
		]),
	);

	const windowInk = glass.addChild(new Graphics());
	const row = height / 3;
	const bandY = expanded ? y : y + row;
	const bandHeight = expanded ? height : row;
	windowInk
		.rect(x, bandY, width, bandHeight)
		.fill(
			gradient({ x, y: bandY, width, height: bandHeight }, 90, [
				[0, "#ffda911c"],
				[0.3, "#ffda9100"],
				[0.7, "#ffda9100"],
				[1, "#ffda911c"],
			]),
		)
		.rect(x, bandY, width, 1)
		.fill(brass)
		.rect(x, bandY + bandHeight - 1, width, 1)
		.fill(brass);
	if (!expanded) {
		windowInk.roundRect(x, y, width, height, 6).fill(
			gradient(drum, 180, [
				[0, "#120c0ca3"],
				[0.31, "#120c0c00"],
				[0.69, "#120c0c00"],
				[1, "#120c0ca1"],
			]),
		);
	}
	const cy = y + height / 2;
	for (const direction of [1, -1]) {
		const tip = direction === 1 ? x - 10 : x + width + 10;
		windowInk.poly([tip, cy - 9, tip + direction * 17, cy, tip, cy + 9]).fill(
			gradient(
				{
					x: Math.min(tip, tip + 17 * direction),
					y: cy - 9,
					width: 17,
					height: 18,
				},
				direction === 1 ? 180 : 0,
				[
					[0, highlight],
					[0.56, brass],
					[1, muted],
				],
			),
		);
	}
	return () => {
		for (const fill of gradients) fill.destroy();
	};
}
