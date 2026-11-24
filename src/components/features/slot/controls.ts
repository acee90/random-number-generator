import { Container, Graphics } from "pixi.js";
import { createTextPrinter } from "../game-art/text";
import { relativeBox } from "./cabinet";

// Keep shadcn in charge of layout, state colors, icons and hit targets.
export function drawControls(
	group: Container,
	root: HTMLElement,
	origin: DOMRect,
) {
	const print = createTextPrinter(origin, 2);
	const faces: (() => void)[] = [];
	let spinner: Graphics | undefined;
	for (const el of root.querySelectorAll<HTMLElement>("button, .slot-wait")) {
		const style = getComputedStyle(el);
		const control = group.addChild(new Container());
		control.alpha = Number(style.opacity);
		if (el instanceof HTMLButtonElement) {
			const face = control.addChild(new Graphics());
			const { x, y, width, height } = relativeBox(el, origin);
			function restyle() {
				face.clear();
				const r = Number.parseFloat(style.borderRadius);
				const border = Number.parseFloat(style.borderTopWidth);
				face
					.roundRect(x, y, width, height, r)
					.fill(style.borderTopColor)
					.roundRect(
						x + border,
						y + border,
						width - 2 * border,
						height - 2 * border,
						Math.max(0, r - border),
					)
					.fill(style.backgroundColor);
				if (el.matches(":enabled:active"))
					face
						.roundRect(
							x + border + 0.5,
							y + border + 0.5,
							width - 2 * border - 1,
							height - 2 * border - 1,
							r - 1,
						)
						.stroke({ color: style.color, width: 1 });
				if (el.matches(":focus-visible")) {
					const thickness = Number.parseFloat(style.outlineWidth);
					const margin = Number.parseFloat(style.outlineOffset) + thickness / 2;
					face
						.roundRect(
							x - margin,
							y - margin,
							width + 2 * margin,
							height + 2 * margin,
							r + margin,
						)
						.stroke({ color: style.outlineColor, width: thickness });
				}
			}
			restyle();
			faces.push(restyle);
		}
		const svg = el.querySelector("svg");
		if (svg) {
			const source = svg.cloneNode(true) as SVGSVGElement;
			const iconStyle = getComputedStyle(svg);
			source.setAttribute("stroke", iconStyle.color);
			source.setAttribute("width", "24");
			source.setAttribute("height", "24");
			const icon = control.addChild(new Graphics().svg(source.outerHTML));
			const box = relativeBox(svg, origin);
			icon.pivot.set(12, 12);
			icon.scale.set(
				Number.parseFloat(iconStyle.width) / 24,
				Number.parseFloat(iconStyle.height) / 24,
			);
			icon.position.set(box.x + box.width / 2, box.y + box.height / 2);
			if (svg.classList.contains("lucide-loader-circle")) spinner = icon;
		}
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node.parentElement && !node.parentElement.closest("svg"))
				print(control, node, getComputedStyle(node.parentElement));
		}
	}
	return {
		spinner,
		restyle: () => {
			for (const face of faces) face();
		},
	};
}
