import { type Container, Text, type TextStyleFontWeight } from "pixi.js";

// Use the same line breaks and character positions as the accessible HTML.
export function createTextPrinter(
	origin: Pick<DOMRect, "left" | "top">,
	resolution = Math.min(window.devicePixelRatio || 1, 2),
) {
	const range = document.createRange();
	return function print(
		group: Container,
		node: Node,
		style: CSSStyleDeclaration,
		limit?: { width: number; lines: number },
	) {
		const value = node.textContent ?? "";
		if (!value.trim()) return;
		range.selectNodeContents(node);
		const rects = range.getClientRects();
		if (!rects.length) return;
		let line = 0;
		function run(text: string, box: DOMRect, continued = false) {
			if (limit && ++line > limit.lines) return;
			if (!text.trim() || !box.width) return;
			const label = new Text({
				text,
				style: {
					fontFamily: style.fontFamily,
					fontSize: Number.parseFloat(style.fontSize),
					fontWeight: style.fontWeight as TextStyleFontWeight,
					fill: style.color,
					letterSpacing: Number.parseFloat(style.letterSpacing) || 0,
					padding: 1,
				},
				resolution,
			});
			label.anchor.set(0, 0.5);
			label.position.set(
				box.left - origin.left,
				box.top - origin.top + box.height / 2,
			);
			if (
				limit &&
				(box.width > limit.width + 1 || (continued && line === limit.lines))
			) {
				const characters = Array.from(text.trimEnd());
				label.text = `${characters.join("")}…`;
				while (characters.length && label.width > limit.width) {
					characters.pop();
					label.text = `${characters.join("")}…`;
				}
			} else {
				label.width = box.width;
			}
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
				run(value.slice(start, offset), range.getBoundingClientRect(), true);
				start = offset;
			}
			lastY = top;
			offset += char.length;
		}
		range.setStart(node, start);
		range.setEnd(node, offset);
		run(value.slice(start), range.getBoundingClientRect());
	};
}
