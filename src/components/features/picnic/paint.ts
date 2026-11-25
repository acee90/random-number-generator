import { Container } from "pixi.js";
import { createBoardRenderer } from "../game-art/renderer";
import { createBallots } from "./ballots";
import { drawPointer, drawRim, drawTable, drawWheel } from "./board";
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
		pointer = layer(stage),
		hub = layer(stage),
		overlay = layer(stage),
		ticket = layer(overlay),
		details = layer(overlay),
		ballots = layer(overlay),
		sound = layer(stage),
		options = layer(stage),
		popup = layer(stage);
	// Clip the cached square texture to the disc, including its antialiased edge.
	const discMask = pen(stage).circle(0, 0, 174.5).fill(0xffffff);
	disc.mask = discMask;
	const keys = new Map<Container, string>();
	const destroyChildren = { children: true, context: true, style: true };
	let angle = 0;
	let pin: ReturnType<typeof drawPointer> | undefined;
	let candidateCount = 0;
	let dirty = true;
	const detailsRoot =
		canvas.parentElement?.querySelector<HTMLElement>(".picnic-details");
	const optionsRoot =
		canvas.parentElement?.querySelector<HTMLElement>(".picnic-options");
	const popupRoot = canvas.parentElement?.querySelector<HTMLElement>(
		".picnic-popup-layer",
	);
	let latestScene: StageScene | undefined;

	// Sweep the assembled result away from the pointer on exit. Keep the last painted sheet
	// through release so its exit can overlap the next live rotor frames.
	const paperMask = pen(stage);

	let arrival = 0;
	let remaining = 0;
	let showing = false;
	let animation = 0;
	let boardWidth = 0;
	let boardHeight = 0;
	let ticketCenterY = 0;

	function pose() {
		const time = arrival * 640;
		const phase = (delay: number, duration: number) =>
			Math.min(1, Math.max(0, (time - delay) / duration));
		const cx = boardWidth / 2;
		const ticketPhase = phase(0, 320);
		const fly = (1 - ticketPhase) ** 3;
		const settle = Math.sin(2 * Math.PI * ticketPhase) * (1 - ticketPhase);
		ticket.pivot.set(cx, ticketCenterY);
		ticket.position.set(cx - 64 * fly, ticketCenterY - 42 * fly + 9 * settle);
		ticket.rotation = -0.16 * fly + 0.045 * settle;
		ticket.alpha = Math.min(1, ticketPhase * 5);
		const sheetPhase = phase(150, 260);
		details.y = 38 * (1 - sheetPhase) ** 3;
		details.alpha = Math.min(1, sheetPhase * 3);
		voteCards.setArrival(phase(310, 235), phase(395, 245));

		overlay.visible = remaining > 0 && arrival > 0;
		const lift = 1 - remaining;
		const cy = rotor.position.y || boardHeight / 2;
		overlay.pivot.set(cx, cy);
		overlay.position.set(cx + 32 * lift, cy - 16 * lift);
		overlay.rotation = 0.08 * lift;
		overlay.scale.set(1 - 0.05 * lift);
		overlay.mask = remaining > 0 && remaining < 1 ? paperMask : null;
		paperMask.clear();
		if (overlay.mask) {
			const top = -Math.PI / 2;
			const radius = Math.hypot(boardWidth, boardHeight);
			paperMask
				.moveTo(cx, cy)
				.arc(cx, cy, radius, top + 2 * Math.PI * lift, top + 2 * Math.PI)
				.closePath()
				.fill(0xffffff);
		}
	}
	function reveal(next: boolean, immediate: boolean) {
		if (showing === next && !immediate) return;
		cancelAnimationFrame(animation);
		showing = next;
		if (immediate) {
			const target = next ? 1 : 0;
			if (arrival !== target || remaining !== target) dirty = true;
			arrival = remaining = target;
			pose();
			return;
		}
		if (next) {
			arrival = 0;
			remaining = 1;
		}
		pose();
		const start = performance.now();
		function tick(now: number) {
			const t = Math.min(1, (now - start) / (next ? 640 : 190));
			if (next) arrival = t;
			else remaining = 1 - t * t;
			pose();
			renderer.render({ container: stage });
			if (t < 1) animation = requestAnimationFrame(tick);
		}
		animation = requestAnimationFrame(tick);
	}

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
			if (group === details && latestScene?.continuous && !latestScene.result)
				return;
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
		paint(
			scene: StageScene,
			width: number,
			height: number,
			motionOff: boolean,
		) {
			const initial = !latestScene;
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
				layout = stageLayout(
					width,
					scene.mainHeight ?? height,
					scene.continuous,
				);
			const { wheelSide: side, wheelY } = layout;
			candidateCount = scene.wheel.count;
			update(cloth, true, () => drawCloth(cloth, { width, height }), true);
			boardWidth = width;
			boardHeight = height;
			ticketCenterY = layout.ticketTop + layout.heroHeight / 2;
			const showWheel = Boolean(scene.continuous || !result);
			if (rotor.visible !== showWheel || showing !== Boolean(result))
				dirty = true;
			rim.visible =
				disc.visible =
				rotor.visible =
				table.visible =
				pointer.visible =
					showWheel;
			hub.visible = showWheel && !scene.continuous;
			if (resized || initial) pose();
			reveal(Boolean(result), motionOff || initial || !scene.continuous);
			if (result || !scene.continuous) {
				if (voteCards.paint(scene, resized)) dirty = true;
			}
			if (result) {
				update(
					ticket,
					[result.name, result.category, result.number, layout.ticketTop],
					() => drawTicket(ticket, layout, result),
				);
			}
			if (showWheel) {
				update(pointer, [side, wheelY], () => {
					pin = drawPointer(
						layer(pointer, (width - side) / 2, wheelY - side / 2),
						side,
					);
				});
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
						scene.wheel.busy,
						scene.wheel.count,
						scene.wheel.disabled,
						scene.hover === "draw",
						scene.pressed === "draw",
					],
					() => drawHub(hub, layout, scene),
				);
				if (result || motionOff || scene.wheel.phase === "idle") {
					const rest = result ? ((scene.landing ?? 0) * Math.PI) / 180 : 0;
					if (angle !== rest) dirty = true;
					angle = rest;
					if (pin) pin.rotation = 0;
				}
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
			if (!rotor.visible) return;
			const difference = radians - angle;
			const delta = Math.atan2(Math.sin(difference), Math.cos(difference));
			const notch =
				(radians * Math.min(24, Math.max(8, candidateCount))) / (2 * Math.PI);
			const step = notch - Math.floor(notch);
			const bend = Math.min(0.15, Math.abs(delta) * 4) * (1 - step) ** 3;
			if (radians === angle && pin?.rotation === bend) return;
			if (pin) pin.rotation = bend;
			rotor.rotation = angle = radians;
			renderer.render({ container: stage });
		},
		destroy() {
			cancelAnimationFrame(animation);
			disconnectDetails?.();
			disconnectOptions?.();
			disconnectPopup?.();
			voteCards.destroy();
			stage.destroy(destroyChildren);
			renderer.destroy();
		},
	};
}
