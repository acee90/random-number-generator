// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StageScene } from "../src/components/features/picnic/layout";
import { PicnicArt } from "../src/components/features/picnic/PicnicArt";
import { createPicnicPainter } from "../src/components/features/picnic/paint";

vi.mock("../src/components/features/picnic/paint", () => ({
	createPicnicPainter: vi.fn(),
}));
const painter = { paint: vi.fn(), rotate: vi.fn(), destroy: vi.fn() };
const waiting: StageScene = {
	wheel: {
		labels: [],
		count: 6,
		caption: "돌리기",
		disabled: false,
		phase: "idle",
	},
	result: null,
	hover: null,
	pressed: null,
};
const result: StageScene = {
	...waiting,
	result: {
		name: "제이돈까스",
		number: 84,
		category: "일식",
		votes: { up: 10, down: 5, enabled: false, selected: "up" },
	},
};
beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal("CanvasRenderingContext2D", class {});
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});
it("keeps one canvas and uses the latest round and counts after loading and resizing", async () => {
	let ready!: (value: typeof painter) => void;
	vi.mocked(createPicnicPainter).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				ready = resolve;
			}),
	);
	const view = render(<PicnicArt scene={waiting} width={296} height={352} />);
	const canvas = view.container.querySelector("canvas");
	await waitFor(() => expect(createPicnicPainter).toHaveBeenCalledOnce());
	view.rerender(<PicnicArt scene={result} width={296} height={352} />);
	await act(async () => ready(painter));
	expect(painter.paint).toHaveBeenLastCalledWith(result, 296, 352);
	view.rerender(<PicnicArt scene={result} width={720} height={448} />);
	expect(painter.paint).toHaveBeenLastCalledWith(result, 720, 448);
	expect(view.container.querySelector("canvas")).toBe(canvas);
	expect(canvas?.dataset.painted).toBe("true");
	view.unmount();
	expect(painter.destroy).toHaveBeenCalledOnce();
});
it("releases a renderer that finished loading after navigation", async () => {
	let ready!: (value: typeof painter) => void;
	vi.mocked(createPicnicPainter).mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				ready = resolve;
			}),
	);
	const view = render(<PicnicArt scene={waiting} width={296} height={352} />);
	await waitFor(() => expect(createPicnicPainter).toHaveBeenCalledOnce());
	view.unmount();
	await act(async () => ready(painter));
	expect(painter.paint).not.toHaveBeenCalled();
	expect(painter.destroy).toHaveBeenCalledOnce();
});
it("leaves the native content visible when drawing fails", async () => {
	painter.paint.mockImplementationOnce(() => {
		throw Error("Unavailable");
	});
	vi.mocked(createPicnicPainter).mockResolvedValueOnce(painter);
	const view = render(<PicnicArt scene={result} width={296} height={352} />);
	await waitFor(() => expect(painter.paint).toHaveBeenCalledOnce());
	expect(
		view.container.querySelector("canvas")?.hasAttribute("data-painted"),
	).toBe(false);
});
