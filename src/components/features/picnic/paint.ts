import { Container } from "pixi.js";
import { createBoardRenderer } from "../game-art/renderer";
import { createBallots } from "./ballots";
import { drawPointer, drawRim, drawTable, drawWheel } from "./board";
import { drawDetails, observeDetails } from "./details";
import { type StageScene, stageLayout, wheelFaceRadius } from "./layout";
import { picnic } from "./palette";
import { assemblyPose, assemblyProgress } from "./resultAssembly";
import { drawCloth, drawHub, drawSound, layer, pen } from "./stationery";
import { drawTicket } from "./ticket";

const winnerHighlightMs = 300;
const winnerPauseMs = 300;

export async function createPicnicPainter(canvas: HTMLCanvasElement) {
	const renderer = await createBoardRenderer(canvas);
	const stage = new Container();
	const cloth = layer(stage),
		rim = layer(stage),
		disc = layer(stage),
		rotor = layer(disc),
		winner = pen(stage),
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
	winner.visible = false;
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

	let arrival = 0;
	let showing = false;
	let animation = 0;
	let boardWidth = 0;
	let ticketCenterY = 0;

	function pose() {
		const cx = boardWidth / 2;
		const ticketPhase = assemblyProgress(arrival, 0, 320);
		const { lift: fly, impact: settle, alpha } = assemblyPose(ticketPhase);
		ticket.pivot.set(cx, ticketCenterY);
		ticket.position.set(cx - 64 * fly, ticketCenterY - 42 * fly + 9 * settle);
		ticket.rotation = -0.16 * fly + 0.045 * settle;
		ticket.alpha = alpha;
		const sheetPhase = assemblyProgress(arrival, 150, 410);
		details.y = 38 * (1 - sheetPhase) ** 3;
		details.alpha = Math.min(1, sheetPhase * 3);
		voteCards.setArrival(
			assemblyProgress(arrival, 310, 545),
			assemblyProgress(arrival, 395, 640),
		);

		overlay.visible = arrival > 0;
	}
	function reveal(next: boolean, immediate: boolean) {
		if (showing === next && !immediate) return;
		cancelAnimationFrame(animation);
		showing = next;
		winner.visible = false;
		if (immediate) {
			const target = next ? 1 : 0;
			if (arrival !== target) dirty = true;
			arrival = target;
			pose();
			return;
		}
		const from = arrival;
		const target = next ? 1 : 0;
		const highlight = next ? winnerHighlightMs : 0;
		const delay = highlight + (next ? winnerPauseMs : 0);
		winner.visible = next;
		winner.alpha = 0;
		pose();
		const start = performance.now();
		function tick(now: number) {
			const elapsed = Math.max(0, now - start);
			winner.visible = elapsed < highlight;
			if (winner.visible)
				winner.alpha = Math.sin((Math.PI * elapsed) / highlight);
			const distance = Math.max(0, elapsed - delay) / 640;
			arrival = next
				? Math.min(1, from + distance)
				: Math.max(0, from - distance);
			pose();
			renderer.render({ container: stage });
			if (winner.visible || arrival !== target)
				animation = requestAnimationFrame(tick);
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
			const previousScene = latestScene;
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
			const result =
				scene.result ??
				(scene.continuous && showing ? previousScene?.result : null);
			const hasResult = Boolean(scene.result);
			const ballotScene =
				result === scene.result ? scene : (previousScene ?? scene);
			const layout = stageLayout(
				width,
				scene.mainHeight ?? height,
				scene.continuous,
			);
			const { wheelSide: side, wheelY } = layout;
			candidateCount = scene.wheel.count;
			update(cloth, true, () => drawCloth(cloth, { width, height }), true);
			boardWidth = width;
			ticketCenterY = layout.ticketTop + layout.heroHeight / 2;
			const showWheel = Boolean(scene.continuous || !result);
			if (rotor.visible !== showWheel || showing !== hasResult) dirty = true;
			rim.visible =
				disc.visible =
				rotor.visible =
				table.visible =
				pointer.visible =
					showWheel;
			hub.visible = showWheel && !scene.continuous;
			if (resized || initial) pose();
			if (hasResult && scene.continuous && (resized || !showing)) {
				// Landing can be off-center within its wedge. Find its actual edges under the pin.
				const step = (2 * Math.PI) / Math.max(1, candidateCount);
				const rotation = ((scene.landing ?? 0) * Math.PI) / 180;
				const start =
					-Math.PI / 2 + rotation + Math.floor(-rotation / step) * step;
				winner.position.set(width / 2, wheelY);
				winner.scale.set(side / 440);
				winner
					.clear()
					.moveTo(0, 0)
					.arc(0, 0, wheelFaceRadius - 2, start, start + step)
					.closePath()
					.fill({ color: picnic.cream, alpha: 0.46 });
				winner
					.arc(0, 0, wheelFaceRadius - 3, start, start + step)
					.stroke({ color: picnic.cream, width: 6 });
				for (const direction of [-1, 1]) {
					winner
						.star(direction * 19, -170, 4, 8, 2.5)
						.fill(picnic.cream)
						.stroke({ color: picnic.seam, width: 1 });
				}
			}
			reveal(hasResult, motionOff || initial || !scene.continuous);
			if (result || !scene.continuous) {
				if (voteCards.paint(ballotScene, resized)) dirty = true;
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
