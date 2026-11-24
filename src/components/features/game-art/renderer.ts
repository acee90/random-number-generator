import { CanvasRenderer } from "pixi.js";
import "pixi.js/graphics";
import "pixi.js/text";

export async function createBoardRenderer(canvas: HTMLCanvasElement) {
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
		return renderer;
	} catch (error) {
		renderer.destroy();
		throw error;
	}
}
