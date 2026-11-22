import { Container, Graphics, Text } from "pixi.js";
import type { Control, StageLayout, StageScene } from "./layout";
import { picnic } from "./palette";

export function layer(parent: Container, x = 0, y = 0) {
	const child = parent.addChild(new Container());
	child.position.set(x, y);
	return child;
}
export function pen(parent: Container) {
	return parent.addChild(new Graphics());
}
export function line(
	g: Graphics,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	color: number,
	width = 1,
) {
	g.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, width, cap: "round" });
}
export function lettering(
	parent: Container,
	value: string,
	x: number,
	y: number,
	size: number,
	fill: number,
	options: {
		serif?: boolean;
		left?: boolean;
		maxWidth?: number;
		maxHeight?: number;
	} = {},
) {
	const glyph = new Text({
		text: value,
		style: {
			fontFamily: options.serif
				? ["Georgia", "serif"]
				: ["Apple SD Gothic Neo", "Malgun Gothic", "Arial", "sans-serif"],
			fontWeight: "700",
			fontSize: size,
			lineHeight: size * 1.13,
			align: "center",
			fill,
			padding: 2,
		},
		resolution: 2.5,
	});
	glyph.anchor.set(options.left ? 0 : 0.5, 0.5);
	glyph.position.set(x, y);
	glyph.scale.set(
		Math.min(
			1,
			(options.maxWidth ?? Infinity) / Math.max(1, glyph.width),
			(options.maxHeight ?? Infinity) / Math.max(1, glyph.height),
		),
	);
	return parent.addChild(glyph);
}

export function drawCloth(parent: Container, { width, height }: StageLayout) {
	const g = pen(parent);
	const stride = width < 350 ? 18 : 22;
	g.rect(0, 0, width, height).fill(0xfff2da);
	for (let x = -1; x < width; x += stride) {
		g.rect(x, 0, stride * 0.29, height).fill({ color: 0xd18766, alpha: 0.095 });
		g.rect(x + stride * 0.36, 0, 1, height).fill({
			color: 0xd18766,
			alpha: 0.24,
		});
	}
	for (let y = -1; y < height; y += stride) {
		g.rect(0, y, width, stride * 0.29).fill({ color: 0xd18766, alpha: 0.095 });
		g.rect(0, y + stride * 0.36, width, 1).fill({
			color: 0xd18766,
			alpha: 0.24,
		});
	}
	// Keep the paper grain stationary when a vote or a control changes.
	let seed = 6673;
	const random = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296;
	};
	for (let i = 0; i < (width * height) / 350; i++)
		g.rect(
			random() * width,
			random() * height,
			0.55 + random() * 0.9,
			0.48,
		).fill({ color: i % 3 ? 0x846548 : 0xffffff, alpha: i % 3 ? 0.14 : 0.65 });
}

export function stateFill(
	scene: StageScene,
	control: Control,
	normal: number,
	hover: number,
	pressed: number,
	enabled: boolean,
) {
	if (enabled && scene.pressed === control) return pressed;
	if (enabled && scene.hover === control) return hover;
	return normal;
}

export function drawToolbar(
	parent: Container,
	layout: StageLayout,
	scene: StageScene,
) {
	const options = scene.toolbar;
	if (!options) return;
	const { width, pad, top, switchWidth } = layout;
	const ink = picnic.ink,
		group = layer(parent, pad, top),
		g = pen(group);
	const paper = 0xfff7e3;
	g.roundRect(0.8, 2.5, switchWidth, 44, 22)
		.fill({ color: ink, alpha: 0.26 })
		.roundRect(0, 0, switchWidth, 44, 22)
		.fill(
			stateFill(scene, "exclude", paper, 0xffeccc, 0xf6d9a7, !options.locked),
		)
		.stroke({ color: ink, width: 1.35 });
	lettering(group, "중복 없이 추첨", 12, 22, width < 360 ? 12 : 13, ink, {
		left: true,
	});
	const x = switchWidth - 46;
	g.roundRect(x, 11, 34, 22, 11)
		.fill(options.exclude ? 0x356959 : 0x937d72)
		.stroke({ color: ink, width: 1 });
	g.circle(x + (options.exclude ? 23 : 11), 22, 8.5).fill(0xfff6db);
	if (options.exclude) {
		line(g, x + 4.6, 21.5, x + 6.5, 24, 0xfff6db, 1.4);
		line(g, x + 6.5, 24, x + 10.3, 19.5, 0xfff6db, 1.4);
	}
	if (options.locked) group.alpha = 0.72;
	const speaker = layer(parent, width - pad - 22, top + 22),
		icon = pen(speaker);
	icon
		.circle(1, 2.5, 21.5)
		.fill({ color: ink, alpha: 0.28 })
		.circle(0, 0, 21.5)
		.fill(
			stateFill(
				scene,
				"sound",
				paper,
				0xffeccc,
				0xf6d9a7,
				options.soundSupported,
			),
		)
		.stroke({ color: ink, width: 1.35 })
		.poly([-10, -3, -6, -3, -1, -7, -1, 7, -6, 3, -10, 3])
		.fill(ink);
	if (options.sound) {
		icon
			.moveTo(3, -4)
			.quadraticCurveTo(7, 0, 3, 4)
			.moveTo(6, -7)
			.quadraticCurveTo(13, 0, 6, 7)
			.stroke({ color: ink, width: 1.7, cap: "round" });
	} else {
		line(icon, 3, -4, 9, 3, ink, 1.7);
		line(icon, 9, -4, 3, 3, ink, 1.7);
	}
	if (!options.soundSupported) speaker.alpha = 0.65;
}

export function drawHub(
	parent: Container,
	layout: StageLayout,
	scene: StageScene,
) {
	const { width, wheelY, hubSize } = layout;
	const hub = layer(parent, width / 2, wheelY);
	const scale = hubSize / 94;
	hub.scale.set(scale);
	const g = pen(hub),
		cream = 0xfff3d5,
		{ wheel } = scene;
	const busy = wheel.phase === "spinning" || wheel.phase === "fetching";
	const normal = wheel.disabled && !busy ? 0x795d54 : 0xa64235;
	g.circle(0, 0, 44)
		.fill(stateFill(scene, "draw", normal, 0x94382e, 0x792e28, !wheel.disabled))
		.stroke({ color: 0xffe2b2, width: 1.4 });
	if (busy) {
		for (const a of [-2.7, 0.5])
			g.moveTo(8 * Math.cos(a), -17 + 8 * Math.sin(a))
				.arc(0, -17, 8, a, a + 1.95)
				.stroke({ color: cream, width: 2, cap: "round" });
	} else {
		g.moveTo(-9, -18)
			.quadraticCurveTo(-2, -18, 1, -13)
			.quadraticCurveTo(4, -9, 9, -10)
			.moveTo(-9, -10)
			.quadraticCurveTo(-4, -10, -1, -15)
			.quadraticCurveTo(3, -21, 9, -20)
			.moveTo(6, -23)
			.lineTo(10, -20)
			.lineTo(7, -17)
			.moveTo(6, -13)
			.lineTo(10, -10)
			.lineTo(7, -7)
			.stroke({ color: cream, width: 1.85, cap: "round", join: "round" });
	}
	lettering(hub, wheel.caption, 0, 4, Math.max(20, 12.5 / scale), cream, {
		maxWidth: 72,
	});
	lettering(hub, `${wheel.count}곳`, 0, 24, Math.max(12, 8.5 / scale), cream, {
		maxWidth: 62,
	});
}
