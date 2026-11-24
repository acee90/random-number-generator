import type { Container } from "pixi.js";
import type { StageScene, VoteChoice } from "./layout";
import { layer } from "./stationery";
import { drawBallot } from "./ticket";

export type BallotScene = Pick<
	StageScene,
	"result" | "voteMotionRound" | "hover" | "pressed"
>;

/** The same ballot cards, native hit targets, and vote animation for both boards. */
export function createBallots(
	group: Container,
	canvas: HTMLCanvasElement,
	root: HTMLElement | null | undefined,
	render: () => void,
) {
	const choices = ["up", "down"] as const;
	const cards = { up: layer(group), down: layer(group) };
	const keys = new Map<VoteChoice, string>();
	const ink: Partial<Record<VoteChoice, ReturnType<typeof drawBallot>>> = {};
	const pulses = new Map<VoteChoice, number>();
	let previous: { round: string; up: number; down: number } | undefined;
	let frame = 0;

	function animate(now: number) {
		frame = 0;
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
		render();
		if (pulses.size) frame = requestAnimationFrame(animate);
	}

	return {
		paint(scene: BallotScene, resized = false) {
			const votes = scene.result?.votes;
			const round = scene.voteMotionRound;
			let changed = group.visible !== Boolean(votes);
			group.visible = Boolean(votes);
			if (!round || round !== previous?.round) {
				cancelAnimationFrame(frame);
				frame = 0;
				if (pulses.size) changed = true;
				pulses.clear();
				for (const choice of choices) {
					cards[choice].scale.set(1);
					const art = ink[choice];
					if (art) {
						art.stamp.alpha = 0;
						art.number.scale.set(art.numberScale);
					}
				}
			}
			if (root && votes) {
				const origin = canvas.getBoundingClientRect();
				for (const choice of choices) {
					const el = root.querySelector<HTMLElement>(`[data-hit="${choice}"]`);
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
					const key = JSON.stringify([
						box,
						votes[choice],
						votes.enabled,
						votes.selected === choice,
						scene.hover === choice,
						scene.pressed === choice,
						focused,
						rtl,
					]);
					if (resized || key !== keys.get(choice)) {
						const card = cards[choice];
						for (const child of card.removeChildren())
							child.destroy({ children: true, context: true, style: true });
						ink[choice] = drawBallot(card, box, scene, choice, focused, rtl);
						keys.set(choice, key);
						changed = true;
					}
					if (
						round &&
						round === previous?.round &&
						votes[choice] > previous[choice]
					)
						pulses.set(choice, performance.now());
				}
				if (pulses.size && !frame) frame = requestAnimationFrame(animate);
			}
			previous =
				round && votes ? { round, up: votes.up, down: votes.down } : undefined;
			return changed;
		},
		destroy() {
			cancelAnimationFrame(frame);
		},
	};
}
