import { CanvasRenderer, Container } from "pixi.js";
import "pixi.js/graphics";
import "pixi.js/text";
import { drawTable, drawWheel } from "./board";
import { type StageScene, stageLayout } from "./layout";
import { drawCloth, drawHub, drawToolbar, layer, pen } from "./stationery";
import { drawBallots, drawTicket } from "./ticket";

export async function createPicnicPainter(canvas: HTMLCanvasElement) {
	const renderer = new CanvasRenderer();
	try {
		await renderer.init({
			canvas,
			width: 1,
			height: 1,
			backgroundAlpha: 0,
			skipExtensionImports: true,
			gcActive: false,
		});
	} catch (error) {
		renderer.destroy();
		throw error;
	}
	const stage = new Container();
	const cloth = layer(stage),
		rotor = layer(stage),
		table = layer(stage),
		hub = layer(stage),
		ticket = layer(stage),
		ballots = layer(stage),
		toolbar = layer(stage);
	const keys = new Map<Container, string>();
	const destroyChildren = { children: true, context: true, style: true };
	let angle = 0;
	let dirty = true;
	function update(
		group: Container,
		values: unknown,
		draw: () => void,
		cache = false,
	) {
		const key = JSON.stringify(values);
		if (keys.get(group) === key) return;
		if (group.isCachedAsTexture) group.cacheAsTexture(false);
		for (const child of group.removeChildren()) child.destroy(destroyChildren);
		draw();
		if (cache && group.children.length)
			group.cacheAsTexture({ resolution: renderer.resolution });
		keys.set(group, key);
		dirty = true;
	}
	return {
		paint(scene: StageScene, width: number, height: number) {
			const resolution = Math.min(window.devicePixelRatio || 1, 2);
			if (
				width !== renderer.screen.width ||
				height !== renderer.screen.height ||
				resolution !== renderer.resolution
			) {
				renderer.resize(width, height, resolution);
				keys.clear();
				dirty = true;
			}
			const result = scene.result,
				layout = stageLayout(width, height, Boolean(result?.votes));
			const { wheelSide: side, wheelY } = layout;
			update(cloth, true, () => drawCloth(cloth, layout), true);
			if (rotor.visible !== !result) dirty = true;
			rotor.visible = table.visible = hub.visible = !result;
			ticket.visible = ballots.visible = Boolean(result);
			if (result) {
				update(
					ticket,
					[result.name, result.category, result.number, layout.ticketTop],
					() => drawTicket(ticket, layout, result),
				);
				update(ballots, [result.votes, scene.hover, scene.pressed], () =>
					drawBallots(ballots, layout, scene),
				);
			} else {
				rotor.position.set(width / 2, wheelY);
				update(
					rotor,
					[scene.wheel.count, scene.wheel.labels],
					() => {
						drawWheel(
							layer(rotor, -side / 2, -side / 2),
							side,
							scene.wheel.labels,
							scene.wheel.count,
						);
					},
					true,
				);
				update(
					table,
					scene.wheel.phase === "spinning",
					() => {
						const props = layer(table, (width - side) / 2, wheelY - side / 2);
						drawTable(props, side);
						if (scene.wheel.phase === "spinning") {
							const arcs = pen(layer(table, width / 2, wheelY));
							arcs.scale.set(side / 440);
							for (const [r, a, d] of [
								[202, 0.08, 0.41],
								[208, 0.21, 0.25],
								[202, 2.85, 0.47],
								[206, 3.26, 0.21],
								[204, 5.55, 0.41],
							])
								arcs
									.moveTo(r * Math.cos(a), r * Math.sin(a))
									.arc(0, 0, r, a, a + d)
									.stroke({
										color: 0xcb7954,
										alpha: 0.7,
										width: 2.4,
										cap: "round",
									});
						}
					},
					true,
				);
				update(
					hub,
					[
						scene.wheel.caption,
						scene.wheel.phase,
						scene.wheel.count,
						scene.wheel.disabled,
						scene.hover === "draw",
						scene.pressed === "draw",
					],
					() => drawHub(hub, layout, scene),
				);
				if (scene.wheel.phase !== "spinning") angle = 0;
				rotor.rotation = angle;
			}
			update(toolbar, [scene.toolbar, scene.hover, scene.pressed], () =>
				drawToolbar(toolbar, layout, scene),
			);
			if (dirty) {
				renderer.render({ container: stage });
				dirty = false;
			}
		},
		rotate(radians: number) {
			if (radians === angle || !rotor.visible) return;
			rotor.rotation = angle = radians;
			renderer.render({ container: stage });
		},
		destroy() {
			stage.destroy(destroyChildren);
			renderer.destroy();
		},
	};
}
