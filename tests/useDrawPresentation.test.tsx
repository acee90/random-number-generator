// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDrawFullscreen, useDrawSound } from "@/hooks/useDrawPresentation";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function mockAudio() {
	const gain = {
		connect: vi.fn(),
		disconnect: vi.fn(),
		gain: {
			setValueAtTime: vi.fn(),
			linearRampToValueAtTime: vi.fn(),
			exponentialRampToValueAtTime: vi.fn(),
		},
	};
	const note = {
		connect: vi.fn(() => gain),
		disconnect: vi.fn(),
		frequency: { setValueAtTime: vi.fn() },
		onended: null,
		start: vi.fn(),
		stop: vi.fn(),
	};
	const context = {
		state: "running",
		currentTime: 0,
		destination: {},
		createOscillator: vi.fn(() => note),
		createGain: vi.fn(() => gain),
		resume: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
	};
	const createContext = vi.fn();
	class MockAudioContext {
		constructor() {
			createContext();
			Object.assign(this, context);
		}
	}
	vi.stubGlobal("AudioContext", MockAudioContext);
	return { context, createContext, note };
}

describe("draw presentation", () => {
	it("uses a focus view without native fullscreen and honors dialog Escape first", async () => {
		const button = document.createElement("button");
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		document.body.appendChild(button);
		document.body.appendChild(dialog);
		try {
			const trigger = { current: button };
			const { result } = renderHook(() => useDrawFullscreen("room", trigger));
			expect(result.current.label).toBe("집중 화면");
			await act(() => result.current.toggle());
			expect(result.current.label).toBe("집중 화면 끝내기");

			function pressEscape(target: EventTarget) {
				act(() => {
					target.dispatchEvent(
						new KeyboardEvent("keydown", {
							key: "Escape",
							bubbles: true,
							cancelable: true,
						}),
					);
				});
			}
			pressEscape(dialog);
			expect(result.current.active).toBe(true);
			pressEscape(document.body);
			expect(result.current.active).toBe(false);
			expect(document.activeElement).toBe(button);
		} finally {
			dialog.remove();
			button.remove();
		}
	});

	it("plays once after a visible round only when enabled and stops on disconnect", () => {
		vi.spyOn(document, "hidden", "get").mockReturnValue(false);
		const { context, createContext, note } = mockAudio();
		const { result, rerender, unmount } = renderHook(
			({
				drawId,
				phase,
				audible,
			}: {
				drawId: string;
				phase: "spinning" | "result";
				audible: boolean;
			}) => useDrawSound("room", audible, drawId, phase),
			{ initialProps: { drawId: "old", phase: "result", audible: true } },
		);
		expect(result.current.enabled).toBe(false);
		expect(createContext).not.toHaveBeenCalled();
		act(() => result.current.toggle());
		expect(context.resume).toHaveBeenCalledOnce();
		expect(note.start).not.toHaveBeenCalled();

		rerender({ drawId: "next", phase: "spinning", audible: true });
		rerender({ drawId: "next", phase: "result", audible: true });
		expect(note.start).toHaveBeenCalledOnce();
		rerender({ drawId: "next", phase: "result", audible: false });
		expect(note.disconnect).toHaveBeenCalledOnce();
		rerender({ drawId: "next", phase: "result", audible: true });
		expect(note.start).toHaveBeenCalledOnce();
		unmount();
		expect(context.close).toHaveBeenCalledOnce();
	});

	it("drops the pending result chime when the document is hidden mid-draw", () => {
		const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
		const { context, note } = mockAudio();
		const { result, rerender } = renderHook(
			(phase: "spinning" | "result") =>
				useDrawSound("room", true, "draw", phase),
			{ initialProps: "spinning" as "spinning" | "result" },
		);
		act(() => result.current.toggle());
		expect(context.resume).toHaveBeenCalledOnce();
		hidden.mockReturnValue(true);
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		hidden.mockReturnValue(false);
		rerender("result");
		expect(note.start).not.toHaveBeenCalled();
	});
});
