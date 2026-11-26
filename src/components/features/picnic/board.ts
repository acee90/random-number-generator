import { Container, Graphics, Text } from "pixi.js";
import { layoutWheelLabels, type WheelLabel, wheelFaceRadius } from "./layout";
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
	fontSize: number,
	x = 0,
	anchorX = 0.5,
) {
	const text = new Text({
		text: value,
		style: {
			fontFamily,
			fontSize,
			fontWeight: "700",
			fill: picnic.ink,
			padding: 1,
		},
		resolution: 3,
	});
	text.anchor.set(anchorX, 0.5);
	text.x = x;
	parent.addChild(text);
}

function drawLabels(
	board: Container,
	labels: readonly WheelLabel[],
	side: number,
) {
	const {
		items,
		badgeWidth,
		badgeHeight,
		numberSize,
		showNames,
		nameOffset,
		nameSize,
	} = layoutWheelLabels(labels, side);
	for (const { label, x, y, rotation, nameOnRight } of items) {
		const row = board.addChild(new Container());
		row.position.set(x, y);
		row.angle = rotation;
		if (showNames) {
			row
				.addChild(new Graphics())
				.roundRect(
					-badgeWidth / 2,
					-badgeHeight / 2,
					badgeWidth,
					badgeHeight,
					badgeHeight / 2,
				)
				.fill(picnic.cream)
				.stroke({ color: picnic.seam, width: 0.8 });
			lettering(
				row,
				label.name,
				nameSize,
				nameOnRight ? nameOffset : -nameOffset,
				nameOnRight ? 0 : 1,
			);
		}
		lettering(row, String(label.number), numberSize);
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
		if (sectors === 1) face.circle(0, 0, wheelFaceRadius).fill(color);
		else
			face
				.moveTo(0, 0)
				.lineTo(
					wheelFaceRadius * Math.cos(angle),
					wheelFaceRadius * Math.sin(angle),
				)
				.arc(0, 0, wheelFaceRadius, angle, angle + step)
				.closePath()
				.fill(color);
	}
	for (let i = 0; i < sectors && sectors > 1; i++) {
		const angle = top + i * step;
		const x = Math.cos(angle),
			y = Math.sin(angle);
		face
			.moveTo(0, 0)
			.lineTo(wheelFaceRadius * x, wheelFaceRadius * y)
			.stroke({ color: picnic.seam, width: sectors > 30 ? 0.65 : 1.4 });
		if (sectors <= 12)
			face
				.circle(165 * x, 165 * y, 3.2)
				.fill(picnic.cream)
				.stroke({ color: picnic.seam, width: 1 });
	}
	face.circle(0, 0, wheelFaceRadius).stroke({ color: picnic.ink, width: 1.8 });
	drawLabels(board, labels, side);
}

export function drawWinnerFocus(
	graphic: Graphics,
	rotationDegrees: number,
	count: number,
) {
	const sectors = Math.max(1, Math.floor(count));
	const step = turn / sectors;
	const rotation = (((rotationDegrees % 360) + 360) % 360) * (Math.PI / 180);
	const start = top + rotation + Math.floor(-rotation / step) * step;
	graphic.clear();
	for (let sector = 1; sector < sectors; sector++) {
		const angle = start + sector * step;
		graphic
			.moveTo(0, 0)
			.lineTo(
				wheelFaceRadius * Math.cos(angle),
				wheelFaceRadius * Math.sin(angle),
			)
			.arc(0, 0, wheelFaceRadius, angle, angle + step)
			.closePath()
			.fill({ color: picnic.ink, alpha: 0.38 });
	}
	if (sectors === 1) {
		graphic
			.circle(0, 0, wheelFaceRadius - 2)
			.stroke({ color: picnic.ink, width: 5 });
		return;
	}
	graphic
		.moveTo(0, 0)
		.lineTo(
			wheelFaceRadius * Math.cos(start),
			wheelFaceRadius * Math.sin(start),
		)
		.arc(0, 0, wheelFaceRadius, start, start + step)
		.lineTo(0, 0)
		.closePath()
		.stroke({ color: picnic.ink, width: 5, join: "round" });
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
		.fill(0xb74334)
		.star(0, 1, 8, 25, 9, Math.PI / 8)
		.fill(0xffe9b6);
}

export function drawPointer(stage: Container, side: number) {
	const board = boardLayer(stage, side);
	const pin = board.addChild(new Graphics());
	pin.pivot.y = pin.y = -201;
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
	return pin;
}
