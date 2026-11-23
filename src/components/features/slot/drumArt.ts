import { CanvasRenderer, Container, Graphics } from "pixi.js";
import "pixi.js/graphics";

// Brass perforations and light trails move with the same drum as the accessible text strip.
export async function createDrumArt(canvas: HTMLCanvasElement) {
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
	const marks = stage.addChild(new Graphics());
	return {
		paint(width: number, height: number, position: number, speed: number) {
			if (!width || !height) return;
			const resolution = Math.min(2, window.devicePixelRatio || 1);
			if (
				renderer.screen.width !== width ||
				renderer.screen.height !== height ||
				renderer.resolution !== resolution
			)
				renderer.resize(width, height, resolution);
			marks.clear();
			const row = height / 3;
			const pitch = row / 4;
			const offset = (position * row) % pitch;
			for (let y = -offset; y < height; y += pitch) {
				for (const x of [5, width - 8]) {
					marks
						.roundRect(x, y, 3, 3 + 5 * speed, 1.5)
						.fill({ color: 0xe8be74, alpha: 0.42 });
				}
			}
			if (speed > 0.02) {
				for (let i = 0; i < 18; i++) {
					const x = width * ((i * 0.618 + 0.12) % 1);
					const y = (((i * 43 - position * row) % height) + height) % height;
					marks
						.moveTo(x, y)
						.lineTo(x, y + speed * 23)
						.stroke({ color: 0xffedc3, width: 1, alpha: speed * 0.24 });
				}
			}
			renderer.render({ container: stage });
		},
		destroy() {
			stage.destroy({ children: true, context: true });
			renderer.destroy();
		},
	};
}
