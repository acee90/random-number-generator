import {
	type ButtonHTMLAttributes,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";

export type SpinButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

type SpinKey = " " | "Enter";
type Gesture =
	| { kind: "pointer"; pointerId: number }
	| { kind: "keyboard"; key: SpinKey; button: HTMLButtonElement };

export function useSpinInput({
	enabled,
	onPress,
	onRelease,
}: {
	enabled: boolean;
	onPress: (focus: boolean) => boolean;
	onRelease: () => void;
}): SpinButtonProps {
	const gesture = useRef<Gesture | null>(null);
	const release = useRef(onRelease);
	const pointer = useRef<number | null>(null);
	const lastPointerRelease = useRef(-Infinity);

	const finish = useCallback(() => {
		if (!gesture.current) return;
		gesture.current = null;
		release.current();
	}, []);

	useLayoutEffect(() => {
		release.current = onRelease;
	}, [onRelease]);
	useLayoutEffect(() => {
		function finishPointer(event: PointerEvent) {
			if (pointer.current === event.pointerId) {
				pointer.current = null;
				lastPointerRelease.current = performance.now();
			}
			if (
				gesture.current?.kind === "pointer" &&
				gesture.current.pointerId === event.pointerId
			)
				finish();
		}
		function finishKey(event: KeyboardEvent) {
			if (
				gesture.current?.kind === "keyboard" &&
				gesture.current.key === event.key
			) {
				event.preventDefault();
				finish();
			}
		}
		function finishOnEscape(event: KeyboardEvent) {
			if (event.key === "Escape") finish();
		}
		function hide() {
			if (document.hidden) finish();
		}
		window.addEventListener("pointerup", finishPointer, true);
		window.addEventListener("pointercancel", finishPointer, true);
		window.addEventListener("keyup", finishKey, true);
		window.addEventListener("keydown", finishOnEscape, true);
		window.addEventListener("blur", finish);
		window.addEventListener("pagehide", finish);
		document.addEventListener("visibilitychange", hide);
		return () => {
			finish();
			window.removeEventListener("pointerup", finishPointer, true);
			window.removeEventListener("pointercancel", finishPointer, true);
			window.removeEventListener("keyup", finishKey, true);
			window.removeEventListener("keydown", finishOnEscape, true);
			window.removeEventListener("blur", finish);
			window.removeEventListener("pagehide", finish);
			document.removeEventListener("visibilitychange", hide);
		};
	}, [finish]);
	useEffect(() => {
		if (!enabled) finish();
	}, [enabled, finish]);

	return {
		onPointerDown(event) {
			if (!enabled || event.button !== 0 || !event.isPrimary || gesture.current)
				return;
			pointer.current = event.pointerId;
			if (onPress(false))
				gesture.current = { kind: "pointer", pointerId: event.pointerId };
		},
		onContextMenu(event) {
			if (gesture.current?.kind === "pointer") event.preventDefault();
		},
		onKeyDown(event) {
			if (!enabled || (event.key !== " " && event.key !== "Enter")) return;
			event.preventDefault();
			if (!event.repeat && !gesture.current && onPress(true))
				gesture.current = {
					kind: "keyboard",
					key: event.key,
					button: event.currentTarget,
				};
		},
		onFocus(event) {
			const current = gesture.current;
			if (current?.kind === "keyboard" && !current.button.isConnected)
				current.button = event.currentTarget;
		},
		onBlur(event) {
			const current = gesture.current;
			if (
				current?.kind !== "keyboard" ||
				current.button !== event.currentTarget
			)
				return;
			// A redraw can replace this control and move focus to the new one.
			// The same key still owns that gesture until keyup.
			queueMicrotask(() => {
				if (
					gesture.current === current &&
					current.button.isConnected &&
					current.button.ownerDocument.activeElement !== current.button
				)
					finish();
			});
		},
		onClick(event) {
			// Let virtual clicks start and release in one activation. A native
			// pointer click after pointerup already drove the same round.
			if (
				event.detail > 0 &&
				performance.now() - lastPointerRelease.current < 500
			)
				return;
			if (enabled && !gesture.current && onPress(event.detail === 0))
				onRelease();
		},
	};
}
