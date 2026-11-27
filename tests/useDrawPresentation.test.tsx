// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDrawSound } from "@/hooks/useDrawPresentation";

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

describe("draw sound presentation", () => {
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
