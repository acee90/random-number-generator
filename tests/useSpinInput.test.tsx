// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSpinInput } from "@/hooks/useSpinInput";

function Control({
	onPress,
	onRelease,
	enabled = true,
	showButton = true,
}: {
	onPress: (focus: boolean) => boolean;
	onRelease: () => void;
	enabled?: boolean;
	showButton?: boolean;
}) {
	const buttonProps = useSpinInput({ enabled, onPress, onRelease });
	return (
		showButton && (
			<button type="button" {...buttonProps} disabled={!enabled}>
				추첨 시작
			</button>
		)
	);
}

function button() {
	return screen.getByRole("button", { name: "추첨 시작" });
}

const primary = {
	pointerId: 1,
	pointerType: "touch",
	isPrimary: true,
	button: 0,
};

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("continuous spin input", () => {
	it("starts immediately and holds without a deadline, including release outside the button", () => {
		vi.useFakeTimers();
		const onPress = vi.fn(() => true);
		const onRelease = vi.fn();
		render(<Control onPress={onPress} onRelease={onRelease} />);
		fireEvent.pointerDown(button(), primary);
		expect(onPress).toHaveBeenCalledExactlyOnceWith(false);
		act(() => vi.advanceTimersByTime(60000));
		expect(onRelease).not.toHaveBeenCalled();
		const secondary = { ...primary, pointerId: 2, isPrimary: false };
		fireEvent.pointerDown(button(), secondary);
		fireEvent.pointerUp(document.body, secondary);
		expect(onRelease).not.toHaveBeenCalled();
		fireEvent.pointerUp(document.body, primary);
		fireEvent.click(button(), { detail: 1 });
		expect(onPress).toHaveBeenCalledTimes(1);
		expect(onRelease).toHaveBeenCalledTimes(1);
		fireEvent.pointerDown(button(), primary);
		expect(onPress).toHaveBeenCalledTimes(2);
	});

	it.each([
		" ",
		"Enter",
	])("keeps %j held and handles keyup after button removal", (key) => {
		const onPress = vi.fn(() => true);
		const onRelease = vi.fn();
		const view = render(<Control onPress={onPress} onRelease={onRelease} />);
		expect(fireEvent.keyDown(button(), { key })).toBe(false);
		fireEvent.keyDown(button(), { key, repeat: true });
		expect(onPress).toHaveBeenCalledExactlyOnceWith(true);
		expect(onRelease).not.toHaveBeenCalled();
		view.rerender(
			<Control onPress={onPress} onRelease={onRelease} showButton={false} />,
		);
		expect(onRelease).not.toHaveBeenCalled();
		expect(fireEvent.keyUp(document.body, { key })).toBe(false);
		fireEvent.keyUp(document.body, { key });
		expect(onRelease).toHaveBeenCalledTimes(1);
	});

	it("releases a keyboard press when the focused control blurs", async () => {
		const onPress = vi.fn(() => true);
		const onRelease = vi.fn();
		render(<Control onPress={onPress} onRelease={onRelease} />);
		act(() => button().focus());
		fireEvent.keyDown(button(), { key: " " });
		await act(async () => button().blur());
		expect(onRelease).toHaveBeenCalledTimes(1);
		fireEvent.keyUp(document.body, { key: " " });
		expect(onRelease).toHaveBeenCalledTimes(1);
	});

	it.each([
		0, 1,
	])("handles a click-only activation with detail %i", (detail) => {
		const onPress = vi.fn(() => true);
		const onRelease = vi.fn();
		render(<Control onPress={onPress} onRelease={onRelease} />);
		fireEvent.click(button(), { detail });
		expect(onPress).toHaveBeenCalledExactlyOnceWith(!detail);
		expect(onRelease).toHaveBeenCalledTimes(1);
	});

	it.each([
		"blur",
		"hidden",
		"disabled",
		"cancel",
		"pagehide",
	])("releases once on %s", (reason) => {
		const onPress = vi.fn(() => true);
		const onRelease = vi.fn();
		const view = render(<Control onPress={onPress} onRelease={onRelease} />);
		fireEvent.pointerDown(button(), primary);
		switch (reason) {
			case "blur":
				fireEvent.blur(window);
				break;
			case "hidden":
				vi.spyOn(document, "hidden", "get").mockReturnValue(true);
				fireEvent(document, new Event("visibilitychange"));
				break;
			case "disabled":
				view.rerender(
					<Control onPress={onPress} onRelease={onRelease} enabled={false} />,
				);
				break;
			case "cancel":
				fireEvent.pointerCancel(button(), primary);
				break;
			case "pagehide":
				fireEvent(window, new Event("pagehide"));
				break;
		}
		fireEvent.pointerUp(button(), primary);
		expect(onRelease).toHaveBeenCalledTimes(1);
	});
});
