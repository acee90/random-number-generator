import { Container } from "pixi.js";
import { createBoardRenderer } from "../game-art/renderer";
import { createBallots } from "./ballots";
import { drawRim, drawTable, drawWheel } from "./board";
import { drawDetails, observeDetails } from "./details";
import { type StageScene, stageLayout } from "./layout";
import { drawCloth, drawHub, drawSound, layer, pen } from "./stationery";
import { drawTicket } from "./ticket";

export async function createPicnicPainter(canvas: HTMLCanvasElement) {
	const renderer = await createBoardRenderer(canvas);
	const stage = new Container();
	const cloth = layer(stage),
		rim = layer(stage),
		disc = layer(stage),
		rotor = layer(disc),
		table = layer(stage),
		hub = layer(stage),
		ticket = layer(stage),
		details = layer(stage),
		ballots = layer(stage),
		sound = layer(stage),
		options = layer(stage),
		popup = layer(stage);
	// Clip the cached square texture to the disc, including its antialiased edge.
	const discMask = pen(stage).circle(0, 0, 174.5).fill(0xffffff);
	disc.mask = discMask;
	const keys = new Map<Container, string>();
	const destroyChildren = { children: true, context: true, style: true };
	let angle = 0;
	let dirty = true;
	const detailsRoot =
		canvas.parentElement?.querySelector<HTMLElement>(".picnic-details");
	const optionsRoot =
		canvas.parentElement?.querySelector<HTMLElement>(".picnic-options");
	const popupRoot = canvas.parentElement?.querySelector<HTMLElement>(
		".picnic-popup-layer",
	);
	let latestScene: StageScene | undefined;

	const voteCards = createBallots(ballots, canvas, detailsRoot, () =>
		renderer.render({ container: stage }),
	);

	function refreshLayer(group: Container, root?: HTMLElement | null) {
		for (const child of group.removeChildren()) child.destroy(destroyChildren);
		if (root) drawDetails(group, root, canvas);
	}
	function observeLayer(
		group: Container,
		root?: HTMLElement | null,
		after?: () => void,
	) {
		if (!root) return;
		return observeDetails(root, () => {
			refreshLayer(group, root);
			after?.();
			renderer.render({ container: stage });
		});
	}
	const disconnectDetails = observeLayer(details, detailsRoot, () => {
		if (latestScene) voteCards.paint(latestScene);
	});
	const disconnectOptions = observeLayer(options, optionsRoot);
	const disconnectPopup = observeLayer(popup, popupRoot);
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
			latestScene = scene;
			const resolution = Math.min(window.devicePixelRatio || 1, 2);
			const resized =
				width !== renderer.screen.width ||
				height !== renderer.screen.height ||
				resolution !== renderer.resolution;
			if (resized) {
				renderer.resize(width, height, resolution);
				keys.clear();
				dirty = true;
				refreshLayer(details, detailsRoot);
				refreshLayer(options, optionsRoot);
				refreshLayer(popup, popupRoot);
			}
			const result = scene.result,
				layout = stageLayout(width, scene.mainHeight ?? height);
			const { wheelSide: side, wheelY } = layout;
			update(cloth, true, () => drawCloth(cloth, { width, height }), true);
			if (rotor.visible !== !result) dirty = true;
			rim.visible =
				disc.visible =
				rotor.visible =
				table.visible =
				hub.visible =
					!result;
			ticket.visible = Boolean(result);
			if (voteCards.paint(scene, resized)) dirty = true;
			if (result) {
				update(
					ticket,
					[result.name, result.category, result.number, layout.ticketTop],
					() => drawTicket(ticket, layout, result),
				);
			} else {
				update(
					rim,
					[side, wheelY],
					() =>
						drawRim(layer(rim, (width - side) / 2, wheelY - side / 2), side),
					true,
				);
				rotor.position.set(width / 2, wheelY);
				discMask.position.copyFrom(rotor.position);
				discMask.scale.set(side / 440);
				update(
					rotor,
					[side, scene.wheel.count, scene.wheel.labels],
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
					[side, wheelY],
					() => {
						const props = layer(table, (width - side) / 2, wheelY - side / 2);
						drawTable(props, side);
					},
					true,
				);
				update(
					hub,
					[
						side,
						wheelY,
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
			const rtl = canvas.matches(":dir(rtl)");
			update(
				sound,
				[scene.sound, scene.hover === "sound", scene.pressed === "sound", rtl],
				() => drawSound(sound, layout, scene, rtl),
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
			disconnectDetails?.();
			disconnectOptions?.();
			disconnectPopup?.();
			voteCards.destroy();
			stage.destroy(destroyChildren);
			renderer.destroy();
		},
	};
}
