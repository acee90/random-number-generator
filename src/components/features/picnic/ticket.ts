import type { ColorSource, Container, Graphics } from "pixi.js";
import { rosette } from "./board";
import type { StageLayout, StageScene, VoteChoice } from "./layout";
import { picnic } from "./palette";
import { layer, lettering, line, pen, stateFill } from "./stationery";

export function coupon(
	g: Graphics,
	w: number,
	h: number,
	fill: ColorSource,
	edge: ColorSource,
	stroke = 1.7,
	notches = 5,
) {
	const l = -w / 2,
		r = w / 2,
		t = -h / 2,
		b = h / 2,
		rad = 7;
	g.moveTo(l + rad, t)
		.lineTo(r - rad, t)
		.quadraticCurveTo(r, t, r, t + rad);
	for (let i = 0; i < notches; i++) {
		const y = t + rad + ((i + 0.5) * (h - 2 * rad)) / notches;
		g.lineTo(r, y - 3.8).quadraticCurveTo(r - 7.8, y, r, y + 3.8);
	}
	g.lineTo(r, b - rad)
		.quadraticCurveTo(r, b, r - rad, b)
		.lineTo(l + rad, b)
		.quadraticCurveTo(l, b, l, b - rad);
	for (let i = notches - 1; i >= 0; i--) {
		const y = t + rad + ((i + 0.5) * (h - 2 * rad)) / notches;
		g.lineTo(l, y + 3.8).quadraticCurveTo(l + 7.8, y, l, y - 3.8);
	}
	g.lineTo(l, t + rad)
		.quadraticCurveTo(l, t, l + rad, t)
		.closePath()
		.fill(fill)
		.stroke({ color: edge, width: stroke, join: "round" });
}

export function drawTicket(
	parent: Container,
	layout: StageLayout,
	result: NonNullable<StageScene["result"]>,
) {
	const { heroWidth: w, heroHeight: h } = layout;
	const hero = layer(parent, layout.width / 2, layout.ticketTop + h / 2);
	const fg = picnic.ink,
		l = -w / 2,
		r = w / 2,
		t = -h / 2,
		b = h / 2,
		stub = Math.min(83, w * 0.22),
		divide = r - stub,
		cx = (l + divide) / 2;
	const behind = layer(hero, 2, 6);
	behind.angle = 1;
	coupon(pen(behind), w * 0.985, h, 0xdba58a, 0xb38370, 1.1);
	const card = layer(hero);
	card.angle = -1.2;
	const g = pen(card);
	coupon(g, w, h, 0xfff6de, fg);
	g.roundRect(l + 9, t + 8, w - 18, h - 16, 5).stroke({
		color: 0xd9b68f,
		width: 1.05,
	});
	for (let y = t + 10; y < b - 9; y += 8)
		line(g, divide, y, divide, Math.min(y + 4, b - 9), 0xa77e62, 1.25);
	for (let x = l + 17; x < divide - 14; x += 7)
		line(g, x, b - 12, x + 2, b - 12, 0xba8b6d, 0.95);
	const stamp = pen(layer(card, cx, t + 19));
	stamp
		.poly(rosette(8.8, 1, 10))
		.fill(0xffaf92)
		.stroke({ color: fg, width: 1.15 })
		.star(0, 0, 5, 4.3, 1.8)
		.fill(fg);
	lettering(
		card,
		"당첨 메뉴",
		cx,
		t + h * 0.31,
		Math.min(15, h * 0.112),
		0x984933,
	);
	const chars = Array.from(result.name);
	const split = chars.length > 11 ? Math.ceil(chars.length / 2) : 0;
	const name = result.name.includes("(")
		? result.name.replace("(", "\n(")
		: split
			? `${chars.slice(0, split).join("")}\n${chars.slice(split).join("")}`
			: result.name;
	lettering(card, name, cx, h * 0.055, Math.min(42, w * 0.107, h * 0.24), fg, {
		maxWidth: w - stub - 24,
		maxHeight: h * 0.35,
	});
	lettering(
		card,
		result.category,
		cx,
		b - 26,
		Math.min(14.5, h * 0.107),
		0x725f50,
		{ maxWidth: w - stub - 28 },
	);
	const stubX = (divide + r) / 2;
	lettering(
		card,
		"후보",
		stubX,
		-h * 0.24,
		Math.min(13, stub * 0.22),
		0x894a3c,
	);
	lettering(
		card,
		String(result.number),
		stubX,
		0,
		Math.min(36, stub * 0.49),
		fg,
		{ serif: true, maxWidth: stub - 14 },
	);
	for (let i = 0; i < 8; i++) {
		const x = stubX - stub * 0.24 + i * stub * 0.067;
		line(g, x, h * 0.17, x, h * 0.31, 0xbc8d70, i % 3 === 0 ? 2.2 : 1);
	}
	const tape = layer(card, l + w * 0.12, t + 1);
	tape.angle = -13;
	const tapeWidth = Math.min(51, w * 0.14),
		half = tapeWidth / 2,
		strip = pen(tape);
	strip
		.poly([
			-half,
			-6.5,
			half - 2,
			-6.5,
			half,
			-2,
			half - 2,
			2,
			half,
			6.5,
			-half,
			6.5,
			-half + 2,
			2,
			-half,
			-2,
		])
		.fill({ color: 0xf4c86e, alpha: 0.85 });
	for (let x = -half + 4; x < half - 2; x += 4)
		line(strip, x, -4.5, x + 2, 4.5, 0xedb953, 0.8);
}

function thumb(parent: Container, down: boolean, fg: number) {
	const c = layer(parent);
	c.scale.y = down ? -1 : 1;
	const g = pen(c);
	g.roundRect(-12, -3.3, 4.5, 13, 1.1).stroke({ color: fg, width: 1.9 });
	g.moveTo(-6, 8.6)
		.lineTo(-6, -2.5)
		.quadraticCurveTo(-1.2, -5, 0, -11)
		.quadraticCurveTo(2.2, -13, 3.8, -10.7)
		.quadraticCurveTo(5, -8, 3.9, -4)
		.lineTo(9.3, -4)
		.quadraticCurveTo(12, -3.6, 11.7, -0.9)
		.lineTo(9.2, 7.2)
		.quadraticCurveTo(8.5, 9.5, 6.2, 9.5)
		.lineTo(-3, 9.5)
		.closePath()
		.stroke({ color: fg, width: 1.9, join: "round", cap: "round" });
}
export type BallotBox = { x: number; y: number; width: number; height: number };
export function drawBallot(
	card: Container,
	box: BallotBox,
	scene: StageScene,
	choice: VoteChoice,
	focused: boolean,
	rtl: boolean,
) {
	const votes = scene.result?.votes;
	if (!votes) return;
	const { width: w, height: h } = box;
	const up = choice === "up",
		selected = votes.selected === choice;
	card.position.set(box.x + w / 2, box.y + h / 2);
	const g = pen(card),
		l = -w / 2,
		t = -h / 2;
	const fg = up ? 0x305d57 : 0x894536;
	const fill = stateFill(
		scene,
		choice,
		selected ? (up ? 0xc4dfce : 0xf6c6af) : up ? 0xe5efe3 : 0xfae7d9,
		up ? 0xd6e9da : 0xf8d5c1,
		up ? 0xb9d7c7 : 0xeebba3,
		votes.enabled,
	);
	g.roundRect(l + 1, t + 1, w - 2, h - 2, 7)
		.fill(fill)
		.stroke({
			color: selected ? fg : up ? 0x91ada0 : 0xd0a38d,
			width: selected ? 2 : 1,
		});
	const stacked = w < 152;
	const inset = w < 190 ? 12 : 18;
	const font = stacked ? 15 : 18;
	const direction = rtl ? -1 : 1;
	const iconX = direction * (stacked ? -(font * 3 + 6) / 2 : l + inset + 12);
	const iconY = stacked ? t + 18 : 0;
	const icon = layer(card, iconX, iconY);
	icon.scale.set(stacked ? 0.8 : 1);
	if (selected) {
		const mark = pen(icon);
		mark.circle(0, 0, 12).fill(fg);
		mark
			.moveTo(-5.4, 0)
			.lineTo(-1.2, 4.2)
			.lineTo(6, -4.6)
			.stroke({ color: 0xfff6de, width: 2.3, cap: "round", join: "round" });
	} else thumb(icon, !up, fg);
	const label = lettering(
		card,
		up ? "좋아요" : "싫어요",
		iconX + direction * (stacked ? 16 : 21),
		iconY,
		font,
		fg,
	);
	label.anchor.x = rtl ? 1 : 0;
	const number = lettering(
		card,
		String(votes[choice]),
		stacked ? 0 : direction * (w / 2 - inset),
		stacked ? h / 2 - 22 : 0,
		stacked ? 29 : 35,
		fg,
		{
			serif: true,
			maxWidth: stacked
				? w - 16
				: Math.min(w * 0.36, w - 2 * inset - 36 - font * 3),
		},
	);
	number.anchor.x = stacked ? 0.5 : rtl ? 0 : 1;
	const stamp = layer(card, iconX, iconY);
	pen(stamp)
		.circle(0, 0, stacked ? 10 : 14)
		.stroke({ color: fg, width: 1.5 });
	stamp.alpha = 0;
	if (focused)
		g.roundRect(l - 1.5, t - 1.5, w + 3, h + 3, 9).stroke({
			color: 0x284f84,
			width: 2.5,
		});
	return { number, numberScale: number.scale.x, stamp };
}
