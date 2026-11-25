import type { Container } from "pixi.js";
import { createTextPrinter } from "../game-art/text";
import { layer, pen } from "./stationery";

// The native lists own wrapping, tab order and scrolling. Paint their visible
// rows at those same coordinates so names, hit targets and the printed sheet agree.
export function drawDetails(
	parent: Container,
	root: HTMLElement,
	canvas: HTMLCanvasElement,
	resolution?: number,
) {
	const origin = canvas.getBoundingClientRect();
	const print = createTextPrinter(origin, resolution);
	const hover = window.matchMedia("(hover: hover)").matches;
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
		if (el.matches(".ui-dialog-overlay")) return;
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
				".picnic-exclusion-group, .picnic-exclusion, .picnic-exclusion-count, .picnic-history-button, .picnic-options-error, .room-next-round",
			)
		) {
			const radius = Math.min(
				h / 2,
				Number.parseFloat(style.borderTopLeftRadius),
			);
			const shape = pen(group)
				.roundRect(x, y, w, h, radius)
				.fill(style.backgroundColor);
			const border = Number.parseFloat(style.borderTopWidth);
			if (border > 0)
				shape.stroke({ color: style.borderTopColor, width: border });
			if (el.matches(".picnic-exclusion-count")) {
				const start = style.direction === "rtl" ? x + w - 1 : x;
				pen(group)
					.moveTo(start, y + 12)
					.lineTo(start, y + h - 12)
					.stroke({
						color: style.getPropertyValue("--paper-edge").trim(),
						width: 1,
					});
			}
		} else if (el.matches(".room-win-filter")) {
			if (el.matches(":active") || (hover && el.matches(":hover"))) {
				pen(group)
					.roundRect(x, y, w, h, Number.parseFloat(style.borderTopLeftRadius))
					.fill(style.backgroundColor);
			}
		} else if (el instanceof HTMLInputElement && el.type === "checkbox") {
			const paper = style.getPropertyValue("--paper-sheet").trim();
			const border = el.checked
				? style.accentColor
				: style.getPropertyValue("--paper-muted").trim();
			const g = pen(group);
			g.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 3)
				.fill(el.checked ? border : paper)
				.stroke({ color: border, width: 1.5 });
			if (el.checked) {
				g.moveTo(x + w * 0.24, y + h * 0.5)
					.lineTo(x + w * 0.43, y + h * 0.69)
					.lineTo(x + w * 0.77, y + h * 0.31)
					.stroke({ color: paper, width: 2, cap: "round", join: "round" });
			}
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
			const winHistory = el.closest(".room-win-history");
			if (!winHistory || Number.parseFloat(style.borderBlockEndWidth) > 0) {
				pen(group)
					.moveTo(x, y + h - 0.5)
					.lineTo(x + w, y + h - 0.5)
					.stroke({
						color: winHistory ? style.borderBlockEndColor : 0xdcc9b3,
						width: 1,
					});
			}
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
			} else if (el.classList.contains("lucide-chevron-right")) {
				if (style.direction === "rtl") g.scale.x *= -1;
				g.moveTo(-3, -6).lineTo(3, 0).lineTo(-3, 6);
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
				.roundRect(
					style.direction === "rtl" ? x + 1 : x + w - 4,
					y + offset,
					3,
					thumb,
					1.5,
				)
				.fill(0xa88970);
		}
		if (
			el.matches(
				':is(.picnic-exclusion, .room-win-filter):has(:focus-visible), :focus-visible:not([tabindex="-1"], [role="switch"], input[type="checkbox"])',
			)
		) {
			pen(group)
				.roundRect(
					x + 1.5,
					y + 1.5,
					w - 3,
					h - 3,
					el.matches(
						".picnic-exclusion, .picnic-exclusion-count, .picnic-history-button, .room-next-round",
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
		"change",
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
