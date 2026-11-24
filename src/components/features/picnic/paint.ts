import { Container } from "pixi.js";
import { createBoardRenderer } from "../game-art/renderer";
import { drawRim, drawTable, drawWheel } from "./board";
import { drawDetails, observeDetails } from "./details";
import { type StageScene, stageLayout } from "./layout";
import { drawCloth, drawHub, drawSound, layer, pen } from "./stationery";
import { drawBallot, drawTicket } from "./ticket";

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
	const choices = ["up", "down"] as const;
	const cards = { up: layer(ballots), down: layer(ballots) };
	const ink: Partial<
		Record<(typeof choices)[number], ReturnType<typeof drawBallot>>
	> = {};
	const pulses = new Map<(typeof choices)[number], number>();
	let previousVotes: { round: string; up: number; down: number } | undefined;
	let motionFrame = 0;
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

	function paintBallots(scene: StageScene) {
		const votes = scene.result?.votes;
		if (!votes || !detailsRoot) return;
		const origin = canvas.getBoundingClientRect();
		for (const choice of choices) {
			const el = detailsRoot.querySelector<HTMLElement>(
				`[data-hit="${choice}"]`,
			);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			const box = {
				x: rect.left - origin.left,
				y: rect.top - origin.top,
				width: rect.width,
				height: rect.height,
			};
			const focused = Boolean(el.querySelector(":focus-visible"));
			const rtl = el.matches(":dir(rtl)");
			update(
				cards[choice],
				[
					box,
					votes[choice],
					votes.enabled,
					votes.selected === choice,
					scene.hover === choice,
					scene.pressed === choice,
					focused,
					rtl,
				],
				() => {
					ink[choice] = drawBallot(
						cards[choice],
						box,
						scene,
						choice,
						focused,
						rtl,
					);
				},
			);
		}
	}

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
		if (latestScene) paintBallots(latestScene);
	});
	const disconnectOptions = observeLayer(options, optionsRoot);
	const disconnectPopup = observeLayer(popup, popupRoot);
	function animateVotes(now: number) {
		for (const [choice, start] of pulses) {
			const glyph = ink[choice];
			if (!glyph) continue;
			const progress = Math.min(1, Math.max(0, (now - start) / 420));
			const remaining = (1 - progress) ** 3;
			cards[choice].scale.set(1 - 0.04 * remaining);
			glyph.number.scale.set(glyph.numberScale * (1 + 0.42 * remaining));
			glyph.stamp.scale.set(0.8 + 0.9 * (1 - remaining));
			glyph.stamp.alpha = 0.85 * (1 - progress);
			if (progress === 1) pulses.delete(choice);
		}
		renderer.render({ container: stage });
		motionFrame = pulses.size ? requestAnimationFrame(animateVotes) : 0;
	}
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
			if (
				width !== renderer.screen.width ||
				height !== renderer.screen.height ||
				resolution !== renderer.resolution
			) {
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
			ballots.visible = Boolean(result?.votes);
			const round = scene.voteMotionRound;
			if (!round || round !== previousVotes?.round) {
				if (pulses.size) dirty = true;
				pulses.clear();
				cancelAnimationFrame(motionFrame);
				motionFrame = 0;
				for (const choice of choices) {
					cards[choice].scale.set(1);
					const art = ink[choice];
					if (art) {
						art.stamp.alpha = 0;
						art.number.scale.set(art.numberScale);
					}
				}
			}
			if (result) {
				update(
					ticket,
					[result.name, result.category, result.number, layout.ticketTop],
					() => drawTicket(ticket, layout, result),
				);
				const votes = result.votes;
				if (votes) {
					paintBallots(scene);
					for (const choice of choices) {
						if (
							round &&
							previousVotes?.round === round &&
							votes[choice] > previousVotes[choice]
						) {
							pulses.set(choice, performance.now());
						}
					}
					if (pulses.size && !motionFrame) animateVotes(performance.now());
				}
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
			previousVotes =
				round && result?.votes
					? { round, up: result.votes.up, down: result.votes.down }
					: undefined;
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
			cancelAnimationFrame(motionFrame);
			stage.destroy(destroyChildren);
			renderer.destroy();
		},
	};
}
