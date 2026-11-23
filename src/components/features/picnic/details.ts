import { type Container, Text, type TextStyleFontWeight } from "pixi.js";
import { layer, pen } from "./stationery";

// The native lists own wrapping, tab order and scrolling. Paint their visible
// rows at those same coordinates so names, hit targets and the printed sheet agree.
export function drawDetails(
	parent: Container,
	root: HTMLElement,
	canvas: HTMLCanvasElement,
) {
	const origin = canvas.getBoundingClientRect();
	const range = document.createRange();
	const hover = window.matchMedia("(hover: hover)").matches;
	function print(group: Container, node: Node, style: CSSStyleDeclaration) {
		const value = node.textContent ?? "";
		if (!value.trim()) return;
		range.selectNodeContents(node);
		const rects = range.getClientRects();
		if (!rects.length) return;
		function run(text: string, box: DOMRect) {
			if (!text.trim() || !box.width) return;
			const label = new Text({
				text,
				style: {
					fontFamily: style.fontFamily,
					fontSize: Number.parseFloat(style.fontSize),
					fontWeight: style.fontWeight as TextStyleFontWeight,
					fill: style.color,
					padding: 1,
				},
				resolution: Math.min(window.devicePixelRatio || 1, 2),
			});
			label.anchor.set(0, 0.5);
			label.position.set(
				box.left - origin.left,
				box.top - origin.top + box.height / 2,
			);
			label.width = box.width;
			group.addChild(label);
		}
		if (rects.length === 1) {
			run(value, rects[0]);
			return;
		}
		// Use the browser's line breaks, including Korean and surrogate pairs.
		let start = 0,
			offset = 0,
			lastY = rects[0].top;
		for (const char of value) {
			range.setStart(node, offset);
			range.setEnd(node, offset + char.length);
			const top = range.getBoundingClientRect().top;
			if (Math.abs(top - lastY) > 1) {
				range.setStart(node, start);
				range.setEnd(node, offset);
				run(value.slice(start, offset), range.getBoundingClientRect());
				start = offset;
			}
			lastY = top;
			offset += char.length;
		}
		range.setStart(node, start);
		range.setEnd(node, offset);
		run(value.slice(start), range.getBoundingClientRect());
	}
	function visit(el: Element, group: Container, clip?: DOMRect) {
		if (el.matches(".sr-only, [hidden], legend, [data-hit]")) return;
		const box = el.getBoundingClientRect();
		if (
			!box.width ||
			!box.height ||
			(clip && (box.bottom <= clip.top || box.top >= clip.bottom))
		)
			return;
		const x = box.left - origin.left,
			y = box.top - origin.top;
		const { width: w, height: h } = box;
		const style = getComputedStyle(el);
		if (el.matches(".ui-dialog-overlay")) {
			pen(group).rect(x, y, w, h).fill({ color: 0x392a28, alpha: 0.38 });
			return;
		}
		if (el.matches(".picnic-sheet, .picnic-popup")) {
			const g = pen(group);
			if (el.matches(".picnic-popup"))
				g.roundRect(x + 2, y + 4, w, h, 12).fill({
					color: 0x392a28,
					alpha: 0.22,
				});
			g.roundRect(x, y, w, h, 12)
				.fill(style.backgroundColor)
				.stroke({ color: style.borderTopColor, width: 1 });
		} else if (
			el.matches(
				".picnic-exclusion, .picnic-history-button, .picnic-options-error, .room-next-round",
			)
		) {
			const radius = Math.min(
				h / 2,
				Number.parseFloat(style.borderTopLeftRadius),
			);
			pen(group)
				.roundRect(x, y, w, h, radius)
				.fill(style.backgroundColor)
				.stroke({
					color: style.borderTopColor,
					width: Number.parseFloat(style.borderTopWidth),
				});
		} else if (el.matches('[role="switch"]')) {
			const checked = el.getAttribute("aria-checked") === "true";
			const thumbAtRight = checked !== (style.direction === "rtl");
			const g = pen(group);
			g.roundRect(x, y, w, h, h / 2)
				.fill(style.backgroundColor)
				.circle(thumbAtRight ? x + w - h / 2 : x + h / 2, y + h / 2, h / 2 - 3)
				.fill(0xfff8e9);
			if (el.matches(":disabled")) g.alpha = 0.55;
		} else if (el instanceof HTMLButtonElement) {
			const active = !el.disabled && el.matches(":active");
			const over = !el.disabled && hover && el.matches(":hover");
			if (el.matches('[data-slot="alert-dialog-action"]')) {
				pen(group)
					.roundRect(x, y, w, h, 7)
					.fill(
						el.disabled
							? 0x788779
							: active
								? 0x29483f
								: over
									? 0x2f544a
									: 0x365f53,
					);
			} else if (el.matches('[data-slot="alert-dialog-cancel"]')) {
				pen(group)
					.roundRect(x, y, w, h, 6)
					.fill(over || active ? 0xf6e6ca : 0xfff8e9)
					.stroke({ color: 0xbba48d, width: 1 });
			} else if (over || active) {
				pen(group)
					.roundRect(x, y, w, h, 6)
					.fill(active ? 0xefd9b5 : 0xf6e6ca);
			}
		} else if (el.matches("li")) {
			pen(group)
				.moveTo(x, y + h - 0.5)
				.lineTo(x + w, y + h - 0.5)
				.stroke({ color: 0xdcc9b3, width: 1 });
		} else if (el.matches(".room-feedback-voter small")) {
			pen(group).roundRect(x, y, w, h, 3).fill(0xd7e8d7);
		} else if (el instanceof SVGSVGElement) {
			const g = pen(group);
			g.position.set(x + w / 2, y + h / 2);
			g.scale.set(w / 24, h / 24);
			if (el.classList.contains("lucide-history")) {
				g.arc(0, 0, 8.5, -2.76, 2.56)
					.moveTo(-9, -7)
					.lineTo(-9, -2)
					.lineTo(-4, -2)
					.moveTo(0, -5)
					.lineTo(0, 0)
					.lineTo(3.8, 2.4);
			} else if (el.classList.contains("lucide-arrow-right")) {
				if (style.direction === "rtl") g.scale.x *= -1;
				g.moveTo(-8, 0).lineTo(8, 0).moveTo(1, -7).lineTo(8, 0).lineTo(1, 7);
			} else if (el.classList.contains("lucide-x")) {
				g.moveTo(-6, -6).lineTo(6, 6).moveTo(6, -6).lineTo(-6, 6);
			} else if (el.classList.contains("lucide-rotate-ccw")) {
				g.moveTo(-9, -8)
					.lineTo(-9, -2)
					.lineTo(-3, -2)
					.moveTo(-8, -3)
					.arc(0, 0, 8, -2.75, 2.5);
			}
			g.stroke({ color: style.color, width: 2, cap: "round", join: "round" });
			if (el.closest(":disabled")) g.alpha = 0.5;
			return;
		}
		const scrollable = el.matches(
			".room-feedback-list ul, .room-draw-exclusion-scroll, .picnic-popup",
		);
		const overflow = scrollable && el.scrollHeight > el.clientHeight + 1;
		const content = overflow ? layer(group) : group;
		if (overflow) {
			const mask = pen(group).rect(x, y, w, h).fill(0xffffff);
			content.mask = mask;
		}
		for (const child of el.childNodes) {
			if (child instanceof Element)
				visit(child, content, overflow ? box : clip);
			else if (child.nodeType === Node.TEXT_NODE) print(content, child, style);
		}
		if (overflow) {
			const thumb = Math.max(16, (h * h) / el.scrollHeight);
			const offset =
				((h - thumb) * el.scrollTop) / (el.scrollHeight - el.clientHeight);
			pen(group)
				.roundRect(x + w - 4, y + offset, 3, thumb, 1.5)
				.fill(0xa88970);
		}
		if (
			el.matches(
				'.picnic-exclusion:has(:focus-visible), :focus-visible:not([tabindex="-1"], [role="switch"])',
			)
		) {
			pen(group)
				.roundRect(
					x + 1.5,
					y + 1.5,
					w - 3,
					h - 3,
					el.matches(
						".picnic-exclusion, .picnic-history-button, .room-next-round",
					)
						? h / 2 - 1.5
						: 6,
				)
				.stroke({ color: 0x284f84, width: 3 });
		}
	}
	visit(root, parent);
}

export function observeDetails(root: HTMLElement, refresh: () => void) {
	let frame = 0;
	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			refresh();
		});
	}
	const events = [
		"scroll",
		"focusin",
		"focusout",
		"pointerover",
		"pointerout",
		"pointerdown",
		"pointerup",
		"pointercancel",
		"keydown",
		"keyup",
	];
	const mutations = new MutationObserver(schedule);
	mutations.observe(root, {
		subtree: true,
		childList: true,
		attributes: true,
		characterData: true,
	});
	const sizes = new ResizeObserver(schedule);
	sizes.observe(root);
	window.addEventListener("resize", schedule);
	for (const event of events) root.addEventListener(event, schedule, true);
	document.fonts.addEventListener("loadingdone", schedule);
	return () => {
		cancelAnimationFrame(frame);
		mutations.disconnect();
		sizes.disconnect();
		window.removeEventListener("resize", schedule);
		for (const event of events) root.removeEventListener(event, schedule, true);
		document.fonts.removeEventListener("loadingdone", schedule);
	};
}
