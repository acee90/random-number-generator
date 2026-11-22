import { Container, Graphics, Text } from "pixi.js";
import type { WheelLabel } from "./layout";
import { picnic } from "./palette";

const turn = 2 * Math.PI;
const top = -Math.PI / 2;
const fontFamily = [
	"Pretendard",
	"Apple SD Gothic Neo",
	"Malgun Gothic",
	"sans-serif",
];

export function rosette(radius: number, depth: number, petals: number) {
	const points: number[] = [];
	const steps = petals * 12;
	for (let i = 0; i < steps; i++) {
		const angle = (turn * i) / steps;
		const r = radius + depth * Math.cos(petals * angle);
		points.push(r * Math.cos(angle), r * Math.sin(angle));
	}
	return points;
}

// The rotating face and stationery share a 440-unit coordinate system.
function boardLayer(stage: Container, side: number) {
	const board = stage.addChild(new Container());
	board.position.set(side / 2, side / 2);
	board.scale.set(side / 440);
	return board;
}

function lettering(
	parent: Container,
	value: string,
	x: number,
	y: number,
	fontSize: number,
	numeral = false,
) {
	const text = new Text({
		text: value,
		style: {
			fontFamily: numeral ? "Georgia, serif" : fontFamily,
			fontSize,
			fontWeight: "700",
			fill: picnic.ink,
			padding: 2,
		},
		resolution: 3,
	});
	text.anchor.set(0.5);
	text.position.set(x, y);
	return parent.addChild(text);
}

function drawLabels(
	board: Container,
	labels: readonly WheelLabel[],
	scale: number,
) {
	const step = turn / Math.max(1, labels.length);
	const roomy = labels.length <= 6;
	// In a dense wheel, print evenly spaced original numbers at a readable size.
	// Every candidate still owns its full sector and appears in the room's candidate list.
	const numberOnly = !roomy && step * 115 * scale < 12;
	const visible = numberOnly
		? Math.min(
				labels.length,
				Math.max(1, Math.floor((turn * 145 * scale) / 15)),
			)
		: labels.length;
	for (let slot = 0; slot < visible; slot++) {
		const index = Math.floor((slot * labels.length) / visible);
		const { name, number } = labels[index];
		const angle = top + (index + 0.5) * step;
		const radius = roomy
			? Math.abs(Math.sin(angle)) < 0.1
				? 111
				: 119
			: numberOnly
				? 145
				: 116;
		const x = radius * Math.cos(angle);
		const y = radius * Math.sin(angle);
		if (roomy) {
			const badgeY = y - Math.max(14, 8 / scale);
			const badgeRadius = Math.max(10.5, 6.5 / scale);
			const badge = board.addChild(new Graphics());
			badge
				.circle(x, badgeY + 1.5, badgeRadius)
				.fill(picnic.seam)
				.circle(x, badgeY, badgeRadius)
				.fill(0xfff5d7)
				.stroke({ color: picnic.seam, width: 1.2 });
			const token = lettering(
				board,
				String(number),
				x,
				badgeY,
				badgeRadius * 1.32,
				true,
			);
			if (token.width > badgeRadius * 1.65)
				token.scale.set((badgeRadius * 1.65) / token.width);
			const text = lettering(
				board,
				name,
				x,
				y + Math.max(14, 6 / scale),
				Math.max(22, 12 / scale),
			);
			const maxWidth = Math.abs(Math.sin(angle)) < 0.1 ? 110 : 120;
			if (text.width > maxWidth) text.scale.set(maxWidth / text.width);
		} else {
			const size = numberOnly
				? Math.max(12, 10 / scale)
				: Math.min(18, step * 92);
			const text = lettering(
				board,
				numberOnly ? String(number) : `${number} ${name}`,
				x,
				y,
				size,
			);
			if (text.width > 106) text.scale.set(106 / text.width);
			text.rotation = angle + (Math.cos(angle) < 0 ? Math.PI : 0);
		}
	}
}

export function drawRim(stage: Container, side: number) {
	const board = boardLayer(stage, side);
	const face = board.addChild(new Graphics());
	const rim = rosette(195.5, 3.5, 24);
	const shadow = board.addChildAt(new Graphics(), 0);
	shadow.position.set(2, 5);
	shadow.poly(rim).fill(0xb56b50).stroke({ color: picnic.ink, width: 2.3 });
	face
		.poly(rim)
		.fill(0xffbba2)
		.stroke({ color: picnic.ink, width: 2.5 })
		.circle(0, 0, 188)
		.stroke({ color: 0xb7503d, width: 1.5 })
		.circle(0, 0, 184.5)
		.fill(picnic.coral)
		.circle(0, 0, 178)
		.fill(picnic.cream);
	for (let i = 0; i < 60; i++) {
		const angle = (i * turn) / 60 + 0.018;
		face
			.moveTo(181.6 * Math.cos(angle), 181.6 * Math.sin(angle))
			.arc(0, 0, 181.6, angle, angle + 0.05)
			.stroke({ color: picnic.cream, width: 1.8, cap: "round" });
	}
}

export function drawWheel(
	stage: Container,
	side: number,
	labels: readonly WheelLabel[],
	count: number,
) {
	const board = boardLayer(stage, side);
	const face = board.addChild(new Graphics());
	// Beyond the circumference in screen pixels adjacent sectors share pixels.
	const sectors = Math.min(count, Math.max(360, Math.ceil(side * Math.PI)));
	const step = turn / Math.max(1, sectors);
	for (let i = 0; i < sectors; i++) {
		const angle = top + i * step;
		const color = picnic.slices[i % picnic.slices.length];
		if (sectors === 1) face.circle(0, 0, 173).fill(color);
		else
			face
				.moveTo(0, 0)
				.lineTo(173 * Math.cos(angle), 173 * Math.sin(angle))
				.arc(0, 0, 173, angle, angle + step)
				.closePath()
				.fill(color);
	}
	for (let i = 0; i < sectors && sectors > 1; i++) {
		const angle = top + i * step;
		const x = Math.cos(angle),
			y = Math.sin(angle);
		face
			.moveTo(0, 0)
			.lineTo(173 * x, 173 * y)
			.stroke({ color: picnic.seam, width: sectors > 30 ? 0.65 : 1.4 });
		if (sectors <= 12)
			face
				.circle(165 * x, 165 * y, 3.2)
				.fill(picnic.cream)
				.stroke({ color: picnic.seam, width: 1 });
	}
	face.circle(0, 0, 173).stroke({ color: picnic.ink, width: 1.8 });
	drawLabels(board, labels, side / 440);
}

export function drawTable(stage: Container, side: number) {
	const board = boardLayer(stage, side);
	const die = board.addChild(new Graphics());
	die.position.set(-184, -126);
	die.rotation = -0.21;
	die
		.roundRect(-16, -12, 32, 31, 5)
		.fill(0x486a82)
		.stroke({ color: picnic.ink, width: 1.6 })
		.roundRect(-17, -16, 32, 30, 5)
		.fill(0xaedce2)
		.stroke({ color: picnic.ink, width: 1.6 });
	for (const [x, y] of [
		[-8, -8],
		[6, -8],
		[-1, -1],
		[-8, 6],
		[6, 6],
	])
		die.circle(x, y, 2.4).fill(picnic.ink);
	const pawn = board.addChild(new Graphics());
	pawn.position.set(182, 126);
	pawn.rotation = 0.22;
	pawn
		.poly([
			-7, -6, -17, 2, -19, 8, -13, 12, -7, 7, -5, 10, -10, 23, -2, 25, 2, 17, 7,
			24, 15, 20, 9, 8, 14, 11, 19, 5, 11, -4, 5, -7,
		])
		.fill(0xf3a17f)
		.stroke({ color: picnic.ink, width: 1.7, join: "round" })
		.circle(-1, -10, 8.5)
		.fill(0xffb59a)
		.stroke({ color: picnic.ink, width: 1.7 });

	const hub = board.addChild(new Graphics());
	hub.scale.set(Math.max(1, 48 / ((92 * side) / 440)));
	hub
		.poly(rosette(55, 2.5, 12))
		.fill(0xffe9b6)
		.stroke({ color: picnic.ink, width: 2 })
		.circle(0, 1, 47)
		.fill(0xb74334);
	const pin = board.addChild(new Graphics());
	pin
		.moveTo(-15, -199)
		.bezierCurveTo(-16, -222, 16, -222, 15, -199)
		.quadraticCurveTo(14, -188, 0, -164)
		.quadraticCurveTo(-14, -187, -15, -199)
		.closePath()
		.fill(0xf77958)
		.stroke({ color: picnic.ink, width: 2.5, join: "round" })
		.moveTo(-11, -198)
		.quadraticCurveTo(-11, -211, -4, -211)
		.stroke({ color: 0xffc8a0, width: 2.5, cap: "round" })
		.circle(0, -201, 5)
		.fill(0xffdf8a)
		.stroke({ color: picnic.ink, width: 1.5 });
}
